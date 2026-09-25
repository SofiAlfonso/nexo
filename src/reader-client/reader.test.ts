import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AcuseLatido, AcuseLoteDiario, Latido, LoteDiario, RespuestaValidacion, SolicitudValidacion,
} from '@nexo/shared/contracts';
import { LectorEmulado } from './application/index.ts';
import { cargarPerfil, ejecutarCarga, ejecutarPares } from './load/index.ts';

const ejecutarArchivo = promisify(execFile);
const directorios: string[] = [];
const servidores: ReturnType<typeof Fastify>[] = [];
const lectores: LectorEmulado[] = [];
afterEach(async () => {
  for (const lector of lectores.splice(0)) await lector.detener();
  for (const servidor of servidores.splice(0)) await servidor.close();
  for (const directorio of directorios.splice(0)) await rm(directorio, { recursive: true, force: true });
});

async function servidorFalso(boletas?: Map<string, { zona: string; estado: string; usada: boolean }>) {
  const servidor = Fastify();
  servidores.push(servidor);
  const solicitudes: SolicitudValidacion[] = [];
  const latidos: Latido[] = [];
  const lotes: LoteDiario[] = [];
  const decisiones = new Map<string, RespuestaValidacion>();
  const consumidas = new Set<string>();
  let diarioDisponible = false;
  servidor.post('/v1/validaciones', async (request) => {
    const intento = SolicitudValidacion.parse(request.body);
    solicitudes.push(intento);
    const repetida = decisiones.has(intento.idOrigen);
    let respuesta = decisiones.get(intento.idOrigen);
    if (!respuesta) {
      const boleta = boletas?.get(intento.codigo);
      const motivo = boletas
        ? !boleta ? 'CODIGO_DESCONOCIDO'
          : boleta.estado === 'anulada' ? 'BOLETA_ANULADA'
            : boleta.zona !== intento.zonaSolicitada ? 'ZONA_NO_AUTORIZADA'
              : boleta.usada || consumidas.has(intento.codigo) ? 'USO_YA_REGISTRADO'
                : 'PERMISO_VIGENTE'
        : 'PERMISO_VIGENTE';
      const aceptado = motivo === 'PERMISO_VIGENTE';
      if (aceptado) consumidas.add(intento.codigo);
      respuesta = RespuestaValidacion.parse({
        idOrigen: intento.idOrigen, decision: aceptado ? 'aceptado' : 'rechazado', motivo,
        proposito: aceptado ? 'ingreso' : null, admision: aceptado, concurrente: false,
        anulacionEnTransito: false, versionPermisos: 1,
        evidencia: { via: 'C2 falso', versionPermisos: 1, versionPoliticas: 1, antiguedadPermisosS: 0 },
        instanteDecision: new Date().toISOString(), repetida: false,
      });
      decisiones.set(intento.idOrigen, respuesta);
    }
    if (intento.codigo === 'LENTO' && !repetida) await new Promise((r) => setTimeout(r, 300));
    return { ...respuesta, repetida };
  });
  servidor.post('/v1/heartbeats', async (request) => {
    latidos.push(Latido.parse(request.body));
    return AcuseLatido.parse({ recibidoEn: new Date().toISOString(), intervaloS: 10 });
  });
  servidor.post('/v1/diario/lotes', async (request, reply) => {
    if (!diarioDisponible) return reply.code(503).send({ error: 'NO_DISPONIBLE', mensaje: 'Sin diario' });
    const lote = LoteDiario.parse(request.body);
    lotes.push(lote);
    return AcuseLoteDiario.parse({
      idLote: lote.idLote, recibidoEn: new Date().toISOString(),
      aceptados: lote.registros.map((r) => r.idOrigen), duplicados: [],
      yaDecididos: [], repetido: false,
    });
  });
  await servidor.listen({ host: '127.0.0.1', port: 0 });
  return {
    url: `http://127.0.0.1:${(servidor.server.address() as { port: number }).port}`,
    solicitudes, latidos, lotes, habilitarDiario: () => { diarioDisponible = true; },
  };
}

async function lector(url: string, directorio: string, heartbeatMs = 10_000) {
  const lector = new LectorEmulado({
    lectorId: 'LX-2210-0149', puntoId: 'P-07', eventoId: 'EVT-2026-02',
    directorio, coordinador: url, timeoutMs: 100, heartbeatMs,
    logger: { warn: vi.fn(), error: vi.fn() },
  });
  lectores.push(lector);
  await lector.iniciar();
  return lector;
}

it('persiste idOrigen antes del envío y lo conserva al reintentar', async () => {
  const falso = await servidorFalso();
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-'));
  directorios.push(directorio);
  const cliente = await lector(falso.url, directorio);
  const primer = await cliente.presentar({ codigo: 'LENTO', zonaSolicitada: 'Sur' });
  expect(primer.decision).toBe('sin-respuesta');
  expect(cliente.estado().pendientesDiario).toBe(1);
  const segundo = await cliente.reintentar(primer.solicitud.idOrigen);
  expect(segundo.decision).toBe('aceptado');
  expect(segundo.respuesta?.repetida).toBe(true);
  expect(falso.solicitudes.map((s) => s.idOrigen)).toEqual([primer.solicitud.idOrigen, primer.solicitud.idOrigen]);
  expect(falso.solicitudes[1]).toEqual(falso.solicitudes[0]);
});

it('envía latidos periódicos H1 con secuencia creciente', async () => {
  const falso = await servidorFalso();
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-'));
  directorios.push(directorio);
  await lector(falso.url, directorio, 25);
  await vi.waitFor(() => expect(falso.latidos.length).toBeGreaterThanOrEqual(2), { timeout: 500 });
  expect(falso.latidos[1]!.secuencia).toBeGreaterThan(falso.latidos[0]!.secuencia);
});

it('recupera el diario JSONL después de reiniciar y sincroniza H1 sin autorizar', async () => {
  const falso = await servidorFalso();
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-'));
  directorios.push(directorio);
  const primero = await lector(falso.url, directorio);
  const intento = await primero.presentar({ codigo: 'LENTO', zonaSolicitada: 'Sur' });
  expect(intento.decision).toBe('sin-respuesta');
  await primero.detener();
  falso.habilitarDiario();
  const segundo = await lector(falso.url, directorio);
  await vi.waitFor(() => expect(segundo.estado().pendientesDiario).toBe(0), { timeout: 1500 });
  expect(falso.lotes.flatMap((lote) => lote.registros.map((r) => r.idOrigen)))
    .toContain(intento.solicitud.idOrigen);
  expect(falso.solicitudes).toHaveLength(1);
  const reintento = await segundo.reintentar(intento.solicitud.idOrigen);
  expect(reintento.solicitud).toEqual(intento.solicitud);
  expect(reintento.respuesta?.repetida).toBe(true);
});

it('diarios nuevos del mismo lector no reutilizan idOrigen ni idLote', async () => {
  const falso = await servidorFalso();
  const primeroDir = await mkdtemp(join(tmpdir(), 'nexo-lector-epoca-'));
  const segundoDir = await mkdtemp(join(tmpdir(), 'nexo-lector-epoca-'));
  directorios.push(primeroDir, segundoDir);
  const primero = await lector(falso.url, primeroDir);
  const segundo = await lector(falso.url, segundoDir);
  const a = await primero.presentar({ codigo: 'LENTO', zonaSolicitada: 'Sur' });
  const b = await segundo.presentar({ codigo: 'LENTO', zonaSolicitada: 'Sur' });
  expect(a.solicitud.idOrigen).not.toBe(b.solicitud.idOrigen);
  expect(a.decision).toBe('sin-respuesta');
  expect(b.decision).toBe('sin-respuesta');
  falso.habilitarDiario();
  await Promise.all([primero.sincronizarDiario(), segundo.sincronizarDiario()]);
  expect(new Set(falso.lotes.map((lote) => lote.idLote)).size).toBe(2);
});

it('sostiene nominal 5,5 TPS y llega a 49,5 TPS en pico contra V1/H1 falso', async () => {
  const mapa = new Map<string, { zona: string; estado: string; usada: boolean }>();
  const boletas: { codigo: string; zona: string; estado: 'vigente' | 'anulada'; usada: boolean }[] =
    Array.from({ length: 500 }, (_, indice) => {
      const boleta = { codigo: `VALID-${indice}`, zona: 'Sur', estado: 'vigente' as const, usada: false };
      mapa.set(boleta.codigo, boleta);
      return boleta;
    });
  for (const boleta of [
    { codigo: 'USED-1', zona: 'Sur', estado: 'vigente', usada: true },
    { codigo: 'CANCELLED-1', zona: 'Sur', estado: 'anulada', usada: false },
  ] as const) {
    boletas.push(boleta);
    mapa.set(boleta.codigo, boleta);
  }
  const falso = await servidorFalso(mapa);
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-carga-'));
  directorios.push(directorio);
  const clientes = await Promise.all(Array.from({ length: 20 }, async (_, indice) => {
    const cliente = new LectorEmulado({
      lectorId: `LX-2210-${String(indice).padStart(4, '0')}`,
      puntoId: `P-${String(indice + 1).padStart(2, '0')}`,
      eventoId: 'EVT-2026-02', directorio, coordinador: falso.url,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    lectores.push(cliente);
    await cliente.iniciar();
    return cliente;
  }));
  for (const [nombre, duracion, esperado] of [['nominal', 15, 5.5], ['pico', 2, 49.5]] as const) {
    const exportacion = { eventos: [{
      eventoId: 'EVT-2026-02',
      boletas: boletas.filter((boleta) =>
        !boleta.codigo.startsWith('VALID-') ||
        (nombre === 'nominal' ? Number(boleta.codigo.slice(6)) < 250 : Number(boleta.codigo.slice(6)) >= 250)),
    }] };
    const perfil = await cargarPerfil(fileURLToPath(new URL(`../../tests/load/${nombre}.json`, import.meta.url)));
    perfil.eventos = ['EVT-2026-02'];
    perfil.lectores = 20;
    perfil.ciclos = 1;
    perfil.fases = nombre === 'nominal'
      ? [{ duracionSegundos: 14, tps: 4.714285714285714 }, { duracionSegundos: 1, tps: 16.5 }]
      : [{ duracionSegundos: duracion, tps: 49.5 }];
    const reporte = await ejecutarCarga({
      perfil, exportacion,
      present: async (intento) => {
        const cliente = clientes[intento.lectorIndex]!;
        const resultado = await cliente.presentar({ codigo: intento.codigo, zonaSolicitada: intento.zonaSolicitada });
        return { decision: resultado.decision, motivo: resultado.respuesta?.motivo, solicitud: resultado.solicitud };
      },
    });
    expect(reporte.tpsProgramado).toBeCloseTo(esperado, 0);
    expect(reporte.tpsDespachado).toBeGreaterThanOrEqual(esperado * 0.95);
    if (nombre === 'nominal') {
      expect(reporte.registros.filter((registro) => registro.programadoMs >= 14_000)).toHaveLength(16);
    }
    expect(reporte.registros.every((registro) => registro.idOrigen?.startsWith('LX-2210-'))).toBe(true);
    expect(reporte.timeouts).toBe(0);
    expect(reporte.falsosRechazos).toBe(0);
  }
}, 30_000);

it('CLI start/status/stop/report usa boletas exportadas y escribe JSON fuera del repo', async () => {
  const mapa = new Map<string, { zona: string; estado: string; usada: boolean }>();
  const boletas = Array.from({ length: 100 }, (_, indice) => ({
    codigo: `TICKET-${indice}`, zona: 'Sur', estado: 'vigente', usada: false,
  }));
  boletas.push({ codigo: 'TICKET-USADO', zona: 'Sur', estado: 'vigente', usada: true });
  boletas.push({ codigo: 'TICKET-ANULADO', zona: 'Sur', estado: 'anulada', usada: false });
  for (const boleta of boletas) mapa.set(boleta.codigo, boleta);
  const falso = await servidorFalso(mapa);
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-cli-'));
  directorios.push(directorio);
  const rutaBoletas = join(directorio, 'boletas.json');
  await writeFile(rutaBoletas, JSON.stringify({ eventos: [{ eventoId: 'EVT-2026-02', boletas }] }));
  const cli = fileURLToPath(new URL('./cli/index.ts', import.meta.url));
  const comando = (...args: string[]) => ejecutarArchivo(process.execPath, [cli, ...args], { timeout: 10_000 });
  try {
    const inicio = await comando('start', '--perfil', 'pico', '--lectores', '20',
      '--coordinador', falso.url, '--boletas', rutaBoletas, '--datos', directorio,
      '--evento', 'EVT-2026-02', '--duracion', '3');
    expect(inicio.stdout).toContain('Lector iniciado');
    const estado = await comando('status', '--datos', directorio);
    expect(JSON.parse(estado.stdout).activo).toBe(true);
    await comando('stop', '--datos', directorio);
    await vi.waitFor(async () => {
      const reporte = JSON.parse(await readFile(join(directorio, 'reporte.json'), 'utf8'));
      expect(reporte.intentos).toBeGreaterThan(0);
      expect(reporte.registros[0].idOrigen).toMatch(/^LX-2210-/);
    }, { timeout: 8000 });
    const informe = await comando('report', '--datos', directorio);
    expect(JSON.parse(informe.stdout).perfil).toBe('pico');
  } finally {
    const estado = await comando('status', '--datos', directorio);
    if (JSON.parse(estado.stdout).activo) await comando('stop', '--datos', directorio);
  }
}, 20_000);

it('pares concurrentes reciben exactamente una aceptación de C2 falso por boleta', async () => {
  const mapa = new Map<string, { zona: string; estado: string; usada: boolean }>();
  const boletas = Array.from({ length: 10 }, (_, indice) => {
    const boleta = { codigo: `PAR-${indice}`, zona: 'Sur', estado: 'vigente' as const, usada: false };
    mapa.set(boleta.codigo, boleta);
    return boleta;
  });
  const falso = await servidorFalso(mapa);
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-pares-'));
  directorios.push(directorio);
  const clientes = await Promise.all([0, 1].map(async (indice) => {
    const cliente = new LectorEmulado({
      lectorId: `LX-PAIR-${indice}`, puntoId: `P-0${indice + 1}`,
      eventoId: 'EVT-2026-02', directorio, coordinador: falso.url,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    lectores.push(cliente);
    await cliente.iniciar();
    return cliente;
  }));
  const perfil = await cargarPerfil(fileURLToPath(new URL('../../tests/load/pico.json', import.meta.url)));
  perfil.eventos = ['EVT-2026-02'];
  perfil.lectores = 2;
  perfil.mezcla = { valid: 100, used: 0, cancelled: 0, 'wrong-zone': 0, unknown: 0 };
  const reporte = await ejecutarPares({
    perfil, exportacion: { eventos: [{ eventoId: 'EVT-2026-02', boletas }] }, pares: 5,
    present: async (intento) => {
      const cliente = clientes[intento.idCarga.endsWith('-A') ? 0 : 1]!;
      const resultado = await cliente.presentar({ codigo: intento.codigo, zonaSolicitada: intento.zonaSolicitada });
      return { decision: resultado.decision, solicitud: resultado.solicitud };
    },
  });
  expect(reporte.paresEvaluados).toBe(5);
  expect(reporte.paresIncorrectos).toBe(0);
  expect(reporte.eventos[0]?.aceptacionesEsperadas).toBe(5);
  expect(reporte.eventos[0]?.aceptacionesObtenidas).toBe(5);
  expect(new Set(reporte.registros.map((r) => r.idOrigen)).size).toBe(10);
}, 10_000);
