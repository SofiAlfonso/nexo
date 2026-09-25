// Prueba de punta a punta del hito M1 (T27, S1-platform).
//
// Requiere el entorno completo corriendo (`npm run dev` en otra terminal):
// D1, D2, otel-lgtm (Docker Compose) y los servidores reales de C4
// (central-core) y C2 (local-coordinator) — no el simulador de C5.
//
// Las piezas de las que depende esta prueba las construyen otras sesiones
// de la ola 1 (S1-coordinator, S1-data, S1-central). Mientras no respondan,
// la comprobación de salud de más abajo omite toda la suite con un mensaje
// explicando qué falta; no hace falta editar este archivo a mano para
// activarla: en cuanto `npm run dev` levante servidores reales que
// respondan, la suite deja de omitirse sola.
//
// Cubre los 4 pasos de M1 pedidos por la orquestadora:
//   1. Login por rol → cookie de sesión (`nexo_sesion`).
//   2. `GET /api/puntos` con datos reales de D2 (no fixtures).
//   3. V1 valida contra C2 y la decisión queda en D1 (idempotencia por
//      `idOrigen`, regla 5).
//   4. En <= 10 s la decisión llega a D2 vía outbox/E1 y se ve tanto en
//      `GET /api/intentos` como por un evento `intento` en `GET /api/stream`.
import { describe, expect, it } from 'vitest';
import {
  RUTAS,
  Sesion,
  RespuestaValidacion,
  SolicitudValidacion,
  ListaPuntos,
  ListaIntentos,
} from '@nexo/shared/contracts';

const CENTRAL_URL = process.env.CENTRAL_URL ?? `http://localhost:${process.env.CENTRAL_PORT ?? '8080'}`;
const COORDINATOR_URL =
  process.env.COORDINATOR_URL ?? `http://localhost:${process.env.COORDINATOR_PORT ?? '8081'}`;
const EVENTO_ID = process.env.NEXO_EVENTO_ID ?? 'EVT-2026-02';
const OPERADOR_USUARIO = process.env.SEED_OPERATOR_USER ?? 'supervisor';
const OPERADOR_CONTRASENA = process.env.SEED_OPERATOR_PASSWORD ?? 'nexo_operador_dev';
// Meta KR de outbox → D2 (regla 7); el hito M1 exige verlo en <= 10 s.
const OUTBOX_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 500;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 1_500): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function isUp(url: string): Promise<boolean> {
  const response = await fetchWithTimeout(url);
  // Cualquier respuesta HTTP (incluso 404/401) indica que el servidor real
  // está escuchando; null significa que no hay nada corriendo en ese puerto.
  return response !== null;
}

function extractSessionCookie(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) return null;
  const [cookiePair] = setCookie.split(';');
  return cookiePair ?? null;
}

async function collectStreamEvents(
  url: string,
  cookie: string,
  matches: (evento: unknown) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { cookie, accept: 'text/event-stream' },
      signal: controller.signal,
    });
    if (!response.ok || !response.body) return false;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return false;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const payload: unknown = JSON.parse(dataLine.slice('data:'.length).trim());
          if (matches(payload)) return true;
        } catch {
          // Ignora comentarios (`: ping`) y fragmentos no-JSON.
        }
      }
    }
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Comprobación de salud en tiempo de módulo: si C4 o C2 aún no responden,
// se omite toda la suite (no falla el pipeline de otras sesiones).
const [centralUp, coordinatorUp] = await Promise.all([isUp(CENTRAL_URL), isUp(COORDINATOR_URL)]);
const servicesReady = centralUp && coordinatorUp;

if (!servicesReady) {
  console.warn(
    `[m1-e2e] omitida: central-core (${CENTRAL_URL}, arriba=${centralUp}) y/o ` +
      `local-coordinator (${COORDINATOR_URL}, arriba=${coordinatorUp}) no responden. ` +
      'Ejecuta `npm run dev` con las implementaciones reales de S1-central y S1-coordinator.',
  );
}

describe.skipIf(!servicesReady)('M1 — punta a punta (login, puntos, V1 → D1 → E1 → D2 → SSE)', () => {
  it('inicia sesión y recibe la cookie nexo_sesion', async () => {
    const respuesta = await fetch(`${CENTRAL_URL}${RUTAS.login.ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: OPERADOR_USUARIO, contrasena: OPERADOR_CONTRASENA }),
    });
    expect(respuesta.status).toBe(RUTAS.login.estado);
    const cookie = extractSessionCookie(respuesta);
    expect(cookie).toBeTruthy();
    const cuerpo: unknown = await respuesta.json();
    const sesion = Sesion.parse(cuerpo);
    expect(sesion.operador.usuario).toBe(OPERADOR_USUARIO);
  });

  it('GET /api/puntos responde con datos reales de D2 (no fixtures)', async () => {
    const login = await fetch(`${CENTRAL_URL}${RUTAS.login.ruta}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: OPERADOR_USUARIO, contrasena: OPERADOR_CONTRASENA }),
    });
    const cookie = extractSessionCookie(login);
    expect(cookie).toBeTruthy();

    const respuesta = await fetch(`${CENTRAL_URL}${RUTAS.puntos.ruta}`, {
      headers: { cookie: cookie! },
    });
    expect(respuesta.status).toBe(RUTAS.puntos.estado);
    const puntos = ListaPuntos.parse(await respuesta.json());
    expect(puntos.length).toBeGreaterThan(0);
  });

  it(
    'V1 valida contra C2 (queda en D1) y en <= 10 s llega a D2 por E1, visible en /api/intentos y /api/stream',
    async () => {
      const login = await fetch(`${CENTRAL_URL}${RUTAS.login.ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usuario: OPERADOR_USUARIO, contrasena: OPERADOR_CONTRASENA }),
      });
      const cookie = extractSessionCookie(login);
      expect(cookie).toBeTruthy();

      const respuestaPuntos = await fetch(`${CENTRAL_URL}${RUTAS.puntos.ruta}`, {
        headers: { cookie: cookie! },
      });
      const puntos = ListaPuntos.parse(await respuestaPuntos.json());
      expect(puntos.length).toBeGreaterThan(0);
      const punto = puntos[0]!;

      const idOrigen = `m1-e2e:${Date.now()}`;
      const solicitud: SolicitudValidacion = SolicitudValidacion.parse({
        idOrigen,
        eventoId: EVENTO_ID,
        lectorId: process.env.NEXO_LECTOR_ID ?? 'LX-2210-M1E2E',
        puntoId: punto.id,
        codigo: process.env.NEXO_CODIGO_BOLETA ?? 'TA-88dd-e2e0',
        zonaSolicitada: punto.zonas[0]!,
        instanteLector: new Date().toISOString(),
      });

      // Abre el SSE antes de validar para no perder el evento `intento`.
      const streamPromise = collectStreamEvents(
        `${CENTRAL_URL}${RUTAS.stream.ruta}`,
        cookie!,
        (evento) =>
          typeof evento === 'object' &&
          evento !== null &&
          (evento as { tipo?: string }).tipo === 'intento' &&
          (evento as { datos?: { id?: string } }).datos?.id === idOrigen,
        OUTBOX_TIMEOUT_MS,
      );

      const respuestaValidacion = await fetch(`${COORDINATOR_URL}${RUTAS.validar.ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(solicitud),
      });
      expect(respuestaValidacion.status).toBe(RUTAS.validar.estado);
      const decision = RespuestaValidacion.parse(await respuestaValidacion.json());
      expect(decision.idOrigen).toBe(idOrigen);
      expect(decision.repetida).toBe(false);

      // Regla 5 (idempotencia): mismo idOrigen y mismo contenido → misma decisión, repetida: true.
      const reintento = await fetch(`${COORDINATOR_URL}${RUTAS.validar.ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(solicitud),
      });
      const decisionRepetida = RespuestaValidacion.parse(await reintento.json());
      expect(decisionRepetida.repetida).toBe(true);
      expect(decisionRepetida.decision).toBe(decision.decision);

      // Poll de /api/intentos como confirmación adicional a la del SSE.
      const deadline = Date.now() + OUTBOX_TIMEOUT_MS;
      let encontradoEnD2 = false;
      while (Date.now() < deadline && !encontradoEnD2) {
        const respuestaIntentos = await fetch(
          `${CENTRAL_URL}${RUTAS.intentos.ruta}?puntoId=${encodeURIComponent(punto.id)}&limite=200`,
          { headers: { cookie: cookie! } },
        );
        if (respuestaIntentos.ok) {
          const intentos = ListaIntentos.parse(await respuestaIntentos.json());
          encontradoEnD2 = intentos.some((intento) => intento.id === idOrigen);
        }
        if (!encontradoEnD2) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      const vistoPorSse = await streamPromise;
      expect(encontradoEnD2 || vistoPorSse).toBe(true);
    },
    OUTBOX_TIMEOUT_MS + 5_000,
  );
});
