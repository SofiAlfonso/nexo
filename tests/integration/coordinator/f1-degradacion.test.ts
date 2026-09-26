import { readFile } from 'node:fs/promises';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RUTAS } from '@nexo/shared/contracts';
import type { LoteDiario } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { crearServidor } from '../../../src/local-coordinator/api/servidor.ts';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { DespachadorOutbox } from '../../../src/local-coordinator/application/despachador-outbox.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import type { Almacen } from '../../../src/local-coordinator/application/puertos.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { migrate } from '../../../src/local-coordinator/infrastructure/db/migrate.ts';
import { crearClienteE1Http } from '../../../src/local-coordinator/infrastructure/e1/cliente-e1.ts';
import { crearAlmacenPostgres } from '../../../src/local-coordinator/infrastructure/persistence/postgres/index.ts';
import { dockerDisponible } from './entorno.ts';

/**
 * F1 (C4 caído): C2 debe seguir validando dentro de 300 ms con la mezcla del perfil pico
 * (65 % boletas ya usadas sobre la única boleta usada de un D1 nuevo) mientras los lectores
 * recuperan su diario H1. `commit_delay` fija en D1 un commit lento (fsync de un disco compartido)
 * para que el resultado no dependa del Docker local: sin las correcciones, esta prueba cae bajo el 5 %.
 */
const EVENTO = 'EVT-2026-02';
const TPS = 49.5;
const DURACION_S = Number(process.env.F1_DURACION_S ?? 20);
const COMMIT_DELAY_US = Number(process.env.F1_COMMIT_DELAY_US ?? 20_000);
const LOTES_POR_LECTOR = Number(process.env.F1_LOTES_POR_LECTOR ?? 1);
const REGISTROS_POR_LOTE = 500;
const seedD1 = fileURLToPath(new URL('../../../src/local-coordinator/infrastructure/db/seed/seed.sql', import.meta.url));

interface Lector { lectorId: string; puntoId: string; zonas: string[] }
interface Medicion { caso: string; latenciaMs: number; decision: string }

async function puertoCerrado(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const puerto = (s.address() as AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return puerto;
}

describe.skipIf(!dockerDisponible)('F1: C2 con C4 inaccesible y recuperación de diario', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let almacen: Almacen;
  let app: FastifyInstance;
  let despachador: DespachadorOutbox;
  let url: string;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16-alpine')
      .withCommand(['postgres', '-c', `commit_delay=${COMMIT_DELAY_US}`, '-c', 'commit_siblings=0']).start();
    pool = new pg.Pool({ connectionString: contenedor.getConnectionUri(), max: 3 });
    pool.on('error', () => undefined);
    await migrate(pool);
    await pool.query(await readFile(seedD1, 'utf8'));
    const centralUrl = `http://127.0.0.1:${await puertoCerrado()}`;
    const config = {
      ...cargarConfig({}), host: '127.0.0.1', port: 0, eventoId: EVENTO, centralUrl, migrarD1: false,
      postgres: {
        host: contenedor.getHost(), port: contenedor.getPort(), database: contenedor.getDatabase(),
        user: contenedor.getUsername(), password: contenedor.getPassword(),
      },
    };
    // Mismo cableado que `main.ts`, sin registros de Fastify por solicitud.
    almacen = await crearAlmacenPostgres(config.postgres, {
      eventoId: EVENTO, migrar: false, lockTimeoutMs: config.plazoValidacionMs, sentenciaTimeoutMs: config.plazoValidacionMs,
    });
    const autoridad = new AutoridadNodoUnico(config.coordinadorId);
    const latidos = new RegistroLatidos();
    const contador = new ContadorV1();
    const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
      unidades: almacen.unidades, alcance: almacen.alcance, autoridad, reloj: { ahora: () => new Date() },
    }), contador, config);
    app = crearServidor({ servicio, almacen, latidos, config });
    despachador = new DespachadorOutbox({
      outbox: almacen.outbox, latidos, v1: contador, cliente: crearClienteE1Http(centralUrl), config,
      estado: () => ({ estado: autoridad.actual().estado, versionPermisos: 1, versionPoliticas: 1 }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    despachador.iniciar();
    url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await despachador?.detener();
    await app?.close();
    await almacen?.cerrar();
    await pool?.end().catch(() => undefined);
    await contenedor?.stop().catch(() => undefined);
  });

  it('valida ≥99 % de V1 en ≤300 ms, sin doble consumo, y el diario drena después', { timeout: 300_000 }, async () => {
    const lectores = (await pool.query<Lector>(
      `SELECT l.lector_id AS "lectorId", l.punto_id AS "puntoId", p.zonas FROM lector l
         JOIN punto p USING (evento_id, punto_id) WHERE l.evento_id = $1 AND l.habilitado AND NOT l.revocado ORDER BY l.lector_id`,
      [EVENTO],
    )).rows;
    expect(lectores).toHaveLength(20);
    const total = Math.round(TPS * DURACION_S);
    const vigentes = (await pool.query<{ codigo: string; zona: string }>(
      `SELECT b.codigo, b.zona FROM boleta b WHERE b.evento_id = $1 AND b.anulada_en IS NULL
          AND NOT EXISTS (SELECT 1 FROM consumo c WHERE c.evento_id = b.evento_id AND c.referencia = b.referencia)
        ORDER BY b.codigo LIMIT $2`,
      [EVENTO, total],
    )).rows;
    const conZona = (zona: string) => lectores.filter((l) => l.zonas.includes(zona));
    const sinZona = (zona: string) => lectores.filter((l) => !l.zonas.includes(zona));
    let siguienteVigente = 0;
    // Mezcla del perfil pico sobre 100 posiciones: 65 usada, 5 anulada, 20 válida, 8 otra zona, 2 desconocida.
    const plan = (i: number): { caso: string; codigo: string; lector: Lector; zona: string } => {
      const k = (i * 37) % 100;
      if (k < 65) return { caso: 'usada', codigo: 'TA-8800-0002', lector: conZona('Norte')[i % 5]!, zona: 'Norte' };
      if (k < 70) return { caso: 'anulada', codigo: 'TA-8800-0001', lector: conZona('Norte')[i % 5]!, zona: 'Norte' };
      const b = vigentes[siguienteVigente++ % vigentes.length]!;
      if (k < 90) { const c = conZona(b.zona); return { caso: 'valida', codigo: b.codigo, lector: c[i % c.length]!, zona: b.zona }; }
      if (k < 98) {
        const c = sinZona(b.zona);
        const lector = c[i % c.length]!;
        return { caso: 'otra-zona', codigo: b.codigo, lector, zona: lector.zonas[0]! };
      }
      return { caso: 'desconocida', codigo: `TA-9999-${String(i).padStart(4, '0')}`, lector: lectores[i % 20]!, zona: lectores[i % 20]!.zonas[0]! };
    };

    const validar = async (i: number): Promise<Medicion> => {
      const p = plan(i);
      const inicio = performance.now();
      try {
        const r = await fetch(`${url}${RUTAS.validar.ruta}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
          body: JSON.stringify({
            idOrigen: `${p.lector.lectorId}:f1:${i}`, eventoId: EVENTO, lectorId: p.lector.lectorId, puntoId: p.lector.puntoId,
            codigo: p.codigo, proposito: 'ingreso', zonaSolicitada: p.zona, instanteLector: new Date().toISOString(),
          }),
        });
        const cuerpo = await r.json() as { decision?: string };
        return { caso: p.caso, latenciaMs: performance.now() - inicio, decision: r.ok ? cuerpo.decision ?? '?' : `http-${r.status}` };
      } catch {
        return { caso: p.caso, latenciaMs: performance.now() - inicio, decision: 'sin-respuesta' };
      }
    };

    // Recuperación del diario: cada lector entrega lotes completos y reintenta hasta el acuse, como C1.
    let cargaTerminada = false;
    const enviarDiario = async (lector: Lector) => {
      for (let n = 0; n < LOTES_POR_LECTOR; n++) {
        const lote: LoteDiario = {
          idLote: `${lector.lectorId}:f1-lote:${n}`, lectorId: lector.lectorId, puntoId: lector.puntoId, eventoId: EVENTO,
          registros: Array.from({ length: REGISTROS_POR_LOTE }, (_, j) => ({
            idOrigen: `${lector.lectorId}:f1-diario:${n}:${j}`, codigo: `TA-8800-${String(j % 1000).padStart(4, '0')}`,
            proposito: 'ingreso' as const, zonaSolicitada: lector.zonas[0]!, instanteLector: new Date().toISOString(),
            motivoLocal: 'SIN_COORDINADOR' as const, latenciaMs: null,
          })),
        };
        for (;;) {
          try {
            const r = await fetch(`${url}${RUTAS.loteDiario.ruta}`, {
              method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lote),
              signal: AbortSignal.timeout(2000),
            });
            if (r.ok) break;
          } catch { /* Sin acuse: se reintenta el mismo lote. */ }
          await new Promise((ok) => setTimeout(ok, cargaTerminada ? 200 : 1000));
        }
      }
    };

    const inicio = performance.now();
    const diario = Promise.all(lectores.map(enviarDiario));
    const mediciones: Promise<Medicion>[] = [];
    for (let i = 0; i < total; i++) {
      const espera = inicio + (i * 1000) / TPS - performance.now();
      if (espera > 0) await new Promise((ok) => setTimeout(ok, espera));
      mediciones.push(validar(i));
    }
    const resultados = await Promise.all(mediciones);
    cargaTerminada = true;

    const dentro = resultados.filter((r) => r.latenciaMs <= 300 && r.decision !== 'sin-respuesta' && !r.decision.startsWith('http-')).length;
    const latencias = resultados.map((r) => r.latenciaMs).sort((a, b) => a - b);
    const resumen = {
      intentos: total, dentro300: dentro, proporcion: dentro / total,
      p95: Math.round(latencias[Math.floor(total * 0.95)]!), p99: Math.round(latencias[Math.floor(total * 0.99)]!),
      sinRespuesta: resultados.filter((r) => r.decision === 'sin-respuesta').length,
      aceptadas: resultados.filter((r) => r.decision === 'aceptado').length,
    };
    console.log('F1 V1', JSON.stringify(resumen));
    expect(resumen.proporcion).toBeGreaterThanOrEqual(0.99);
    // Ninguna boleta usada o anulada se acepta, y cada boleta válida se acepta una sola vez.
    expect(resultados.filter((r) => r.decision === 'aceptado' && r.caso !== 'valida')).toHaveLength(0);
    const dobles = await pool.query(
      `SELECT referencia FROM consumo WHERE evento_id = $1 GROUP BY cliente_id, evento_id, boleteria_id, referencia, proposito HAVING count(*) > 1`,
      [EVENTO],
    );
    expect(dobles.rowCount).toBe(0);

    // Tras la carga, el diario termina de drenar: cada registro queda una sola vez en D1 y en el outbox.
    await diario;
    const esperados = lectores.length * LOTES_POR_LECTOR * REGISTROS_POR_LOTE;
    const d1 = await pool.query<{ diario: string; outbox: string }>(
      `SELECT (SELECT count(*) FROM intento_diario WHERE id_origen LIKE '%:f1-diario:%') AS diario,
              (SELECT count(*) FROM outbox WHERE tipo = 'intento-diario' AND id_origen LIKE '%:f1-diario:%') AS outbox`,
    );
    console.log('F1 diario', JSON.stringify({ esperados, ...d1.rows[0], drenadoS: Math.round((performance.now() - inicio) / 1000) }));
    expect(Number(d1.rows[0]!.diario)).toBe(esperados);
    expect(Number(d1.rows[0]!.outbox)).toBe(esperados);
  });
});
