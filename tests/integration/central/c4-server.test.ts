import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRE_COOKIE_SESION } from '@nexo/shared/contracts';
import { createD2Pool, migrate } from '../../../src/central-core/infrastructure/db/index.ts';
import { crearApp, type AppC4 } from '../../../src/central-core/api/server.ts';

const EVENTO_ID = 'EVT-2025-01';
const RECINTO_ID = 'REC-01';
const CLIENTE_ID = 'cli-1';
const CANTIDAD_PUNTOS = 20;

const puntoId = (i: number): string => `P-${String(i).padStart(2, '0')}`;

describe('C4 - composición Fastify (login, O2, M2 E1, incidentes)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: AppC4;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = createD2Pool({ ...process.env, D2_DATABASE_URL: contenedor.getConnectionUri() });
    await migrate(pool);
    await sembrarDatos(pool);
    app = crearApp(pool);
    await app.fastify.ready();
  }, 180_000);

  afterAll(async () => {
    app.cerrar();
    await app.fastify.close();
    await pool.end();
    await contenedor.stop();
  });

  it('rechaza rutas /api/* sin sesión', async () => {
    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/puntos' });
    expect(respuesta.statusCode).toBe(401);
  });

  it('login válido devuelve la cookie de sesión firmada', async () => {
    const respuesta = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { usuario: 'supervisor1', contrasena: 'clave-prueba-123' },
    });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.operador.usuario).toBe('supervisor1');
    expect(cuerpo.operador.rol).toBe('SUPERVISOR');
    const cookies = respuesta.cookies;
    expect(cookies.some((c) => c.name === NOMBRE_COOKIE_SESION)).toBe(true);
  });

  it('login inválido devuelve 401', async () => {
    const respuesta = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { usuario: 'supervisor1', contrasena: 'incorrecta' },
    });
    expect(respuesta.statusCode).toBe(401);
  });

  it('/api/puntos devuelve los 20 puntos sembrados con una sesión válida', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/puntos', cookies: cookie });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo).toHaveLength(CANTIDAD_PUNTOS);
  });

  it('un lote E1 aceptado por curl/HTTP se refleja en /api/eventos/actual/estado y en /api/intentos', async () => {
    const cookie = await iniciarSesion(app);
    const idOrigen = 'decision-prueba-1';
    const lote = {
      idLote: 'lote-prueba-1',
      recintoId: RECINTO_ID,
      eventoId: EVENTO_ID,
      coordinadorId: 'coord-1',
      emitidoEn: new Date().toISOString(),
      registros: [
        {
          tipo: 'decision',
          idOrigen,
          lectorId: 'lector-01',
          puntoId: puntoId(1),
          codigo: 'BOL-0001',
          zona: 'GENERAL',
          zonaSolicitada: 'GENERAL',
          decision: 'aceptado',
          motivo: 'PERMISO_VIGENTE',
          proposito: 'ingreso',
          admision: true,
          concurrente: false,
          anulacionEnTransito: false,
          evidencia: {
            via: 'Coordinador COORD-1', versionPermisos: 1, versionPoliticas: 1, antiguedadPermisosS: 0,
          },
          instanteLector: new Date().toISOString(),
          instanteDecision: new Date().toISOString(),
        },
      ],
    };

    const respuestaLote = await app.fastify.inject({ method: 'POST', url: '/v1/lotes-evidencia', payload: lote });
    expect(respuestaLote.statusCode).toBe(200);
    expect(respuestaLote.json().aceptados).toBe(1);

    const respuestaEstado = await app.fastify.inject({
      method: 'GET', url: '/api/eventos/actual/estado', cookies: cookie,
    });
    expect(respuestaEstado.statusCode).toBe(200);
    expect(respuestaEstado.json().evento.id).toBe(EVENTO_ID);

    const respuestaIntentos = await app.fastify.inject({
      method: 'GET', url: `/api/intentos?puntoId=${puntoId(1)}&limite=10`, cookies: cookie,
    });
    expect(respuestaIntentos.statusCode).toBe(200);
    const intentos = respuestaIntentos.json() as Array<{ id: string; zona: string | null; admision: boolean }>;
    const intento = intentos.find((i) => i.id === idOrigen);
    expect(intento).toBeDefined();
    expect(intento?.zona).toBe('General');
    expect(intento?.admision).toBe(true);
  });

  it('un punto sin latido > 60 s genera un incidente SIN_COMUNICACION', async () => {
    const cookie = await iniciarSesion(app);
    // punto-02 se sembró con `ultima_comunicacion` hace más de 60 s (ver sembrarDatos).
    const servicio = await import('../../../src/central-core/modules/evidence-ingestion/api/index.ts');
    const vigilancia = servicio.crearServicioVigilanciaLatidos(pool);
    await vigilancia.revisarPuntosSinComunicacion();

    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/incidentes', cookies: cookie });
    expect(respuesta.statusCode).toBe(200);
    const incidentes = respuesta.json() as Array<{ clasificacion: string; puntoId: string | null }>;
    expect(incidentes.some((i) => i.clasificacion === 'SIN_COMUNICACION' && i.puntoId === puntoId(2))).toBe(true);
  });

  it('GET /api/boletas/:ref devuelve la boleta sembrada', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/boletas/BOL-0001', cookies: cookie });
    expect(respuesta.statusCode).toBe(200);
    const boleta = respuesta.json() as { ref: string; zona: string; excluida: boolean };
    expect(boleta.ref).toBe('BOL-0001');
    expect(boleta.zona).toBe('General');
  });

  it('GET /api/boletas/:ref responde 404 si no existe', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/boletas/NO-EXISTE', cookies: cookie });
    expect(respuesta.statusCode).toBe(404);
  });

  it('GET /api/acciones y POST /api/acciones/:id deciden una acción pendiente', async () => {
    const cookie = await iniciarSesion(app);
    const respuestaLista = await app.fastify.inject({ method: 'GET', url: '/api/acciones', cookies: cookie });
    expect(respuestaLista.statusCode).toBe(200);
    const acciones = respuestaLista.json() as Array<{ id: string; estado: string }>;
    expect(acciones.some((a) => a.id === 'ACC-1' && a.estado === 'pendiente')).toBe(true);

    const respuestaDecision = await app.fastify.inject({
      method: 'POST', url: '/api/acciones/ACC-1', cookies: cookie, payload: { aprobar: true, nota: 'ok' },
    });
    expect(respuestaDecision.statusCode).toBe(200);
    const accion = respuestaDecision.json() as { estado: string; autor: string | null; nota: string | null };
    expect(accion.estado).toBe('aprobada');
    expect(accion.autor).toBe('SUPERVISOR');
    expect(accion.nota).toBe('ok');

    const respuestaRepetida = await app.fastify.inject({
      method: 'POST', url: '/api/acciones/ACC-1', cookies: cookie, payload: { aprobar: true },
    });
    expect(respuestaRepetida.statusCode).toBe(409);
  });

  it('POST /api/acciones/:id responde 404 si la acción no existe', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({
      method: 'POST', url: '/api/acciones/ACC-999', cookies: cookie, payload: { aprobar: true },
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it('GET /api/actividad refleja la bitácora del incidente SIN_COMUNICACION', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({ method: 'GET', url: '/api/actividad', cookies: cookie });
    expect(respuesta.statusCode).toBe(200);
    const actividad = respuesta.json() as Array<{ texto: string; tono: string }>;
    expect(actividad.length).toBeGreaterThan(0);
  });

  it('rutas de preparación/cierre fuera de alcance de M1 responden 501', async () => {
    const cookie = await iniciarSesion(app);
    const respuesta = await app.fastify.inject({
      method: 'POST', url: '/api/preparacion/confirmar', cookies: cookie,
    });
    expect(respuesta.statusCode).toBe(501);
  });
});

async function iniciarSesion(app: AppC4): Promise<Record<string, string>> {
  const respuesta = await app.fastify.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { usuario: 'supervisor1', contrasena: 'clave-prueba-123' },
  });
  const cookie = respuesta.cookies.find((c) => c.name === NOMBRE_COOKIE_SESION);
  if (!cookie) throw new Error('Login de prueba no devolvió cookie de sesión');
  return { [cookie.name]: cookie.value };
}

async function sembrarDatos(pool: Pool): Promise<void> {
  const contrasenaHash = await argon2.hash('clave-prueba-123');
  await pool.query('INSERT INTO auth.operadores (usuario, nombre, rol, contrasena_hash) VALUES ($1, $2, $3, $4)', [
    'supervisor1', 'Operadora de prueba', 'SUPERVISOR', contrasenaHash,
  ]);

  await pool.query('INSERT INTO m1_config_permisos.clientes (id, nombre) VALUES ($1, $2)', [CLIENTE_ID, 'Cliente de prueba']);
  await pool.query('INSERT INTO m1_config_permisos.recintos (id, cliente_id, nombre) VALUES ($1, $2, $3)', [
    RECINTO_ID, CLIENTE_ID, 'Recinto de prueba',
  ]);
  await pool.query(
    `INSERT INTO m1_config_permisos.eventos
       (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre, estado)
     VALUES ($1, $2, $3, $4, $5, now() - interval '1 hour', now() + interval '4 hours', 'abierto')`,
    [EVENTO_ID, RECINTO_ID, 'Evento de prueba', 'Prueba', 'boleteria-sim'],
  );
  await pool.query('INSERT INTO m1_config_permisos.zonas (id, evento_id, nombre) VALUES ($1, $2, $3)', [
    'GENERAL', EVENTO_ID, 'General',
  ]);
  await pool.query('INSERT INTO m1_config_permisos.politicas (evento_id) VALUES ($1)', [EVENTO_ID]);

  for (let i = 1; i <= CANTIDAD_PUNTOS; i += 1) {
    const id = puntoId(i);
    await pool.query(
      `INSERT INTO m1_config_permisos.puntos (id, evento_id, nombre, zona_id, estado)
       VALUES ($1, $2, $3, $4, 'en-linea')`,
      [id, EVENTO_ID, `Puerta ${i}`, 'GENERAL'],
    );
    await pool.query(
      'INSERT INTO m1_config_permisos.punto_zonas (evento_id, punto_id, zona_id) VALUES ($1, $2, $3)',
      [EVENTO_ID, id, 'GENERAL'],
    );
    // El punto 2 lleva más de 60 s sin comunicación para ejercitar la regla SIN_COMUNICACION.
    const ultimaComunicacion = i === 2 ? "now() - interval '5 minutes'" : 'now()';
    await pool.query(
      `INSERT INTO m2_evidencia.puntos_estado (evento_id, punto_id, estado, ultima_comunicacion)
       VALUES ($1, $2, 'en-linea', ${ultimaComunicacion})`,
      [EVENTO_ID, id],
    );
  }

  await pool.query(
    `INSERT INTO m2_evidencia.eventos_estado (evento_id, coordinador_estado, enlace_en_linea)
     VALUES ($1, 'operando', true)`,
    [EVENTO_ID],
  );

  await pool.query(
    'INSERT INTO m1_config_permisos.boletas (evento_id, referencia, zona_id, version) VALUES ($1, $2, $3, 0)',
    [EVENTO_ID, 'BOL-0001', 'GENERAL'],
  );

  await pool.query(
    `INSERT INTO m2_evidencia.acciones (id, evento_id, tipo, titulo, detalle, si, no, rol, decisiva, estado)
     VALUES ('ACC-1', $1, 'redirigir', 'Redirigir zona', 'Detalle de prueba', 'Sí, redirigir', 'No redirigir', 'SUPERVISOR', true, 'pendiente')`,
    [EVENTO_ID],
  );
}
