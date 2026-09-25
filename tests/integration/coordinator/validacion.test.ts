import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MOTIVO_TEXTO } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor } from '../../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { crearAlmacenPostgres } from '../../../src/local-coordinator/infrastructure/persistence/postgres/almacen-postgres.ts';
import { dockerDisponible, EVENTO, iniciarD1, RelojAjustable, solicitud } from './entorno.ts';
import type { EntornoD1 } from './entorno.ts';

const config = cargarConfig({ EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-INT' });

function montar(entorno: Pick<EntornoD1, 'almacen'>, reloj: RelojAjustable): FastifyInstance {
  const contador = new ContadorV1();
  const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
    unidades: entorno.almacen.unidades,
    alcance: entorno.almacen.alcance,
    autoridad: new AutoridadNodoUnico(config.coordinadorId),
    reloj,
  }), contador, config, reloj);
  return crearServidor({ servicio, almacen: entorno.almacen, latidos: new RegistroLatidos(), config, reloj });
}

function cuerpo(s: ReturnType<typeof solicitud>) {
  return { ...s, instanteLector: s.instanteLector.toISOString() };
}

describe.skipIf(!dockerDisponible)('C2 V1 contra D1 PostgreSQL real', () => {
  let entorno: EntornoD1;
  let app: FastifyInstance;
  const reloj = new RelojAjustable();

  beforeAll(async () => {
    entorno = await iniciarD1();
    app = montar(entorno, reloj);
  });
  afterAll(async () => {
    await app?.close();
    await entorno?.cerrar();
  });

  const validar = (s: ReturnType<typeof solicitud>) => app.inject({ method: 'POST', url: '/v1/validaciones', payload: cuerpo(s) });

  it('acepta una boleta vigente y deja intento, consumo, bitácora y outbox en la misma transacción', async () => {
    const s = solicitud('TA-8801-0001');
    const r = await validar(s);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ idOrigen: s.idOrigen, decision: 'aceptado', motivo: 'PERMISO_VIGENTE', admision: true });

    const filas = await entorno.pool.query<{ n: string; t: string }>(
      `SELECT 'intento' t, count(*) n FROM intento WHERE id_origen = $1
       UNION ALL SELECT 'consumo', count(*) FROM consumo WHERE id_origen = $1
       UNION ALL SELECT 'bitacora', count(*) FROM bitacora WHERE id_origen = $1
       UNION ALL SELECT 'outbox', count(*) FROM outbox WHERE id_origen = $1`,
      [s.idOrigen],
    );
    expect(Object.fromEntries(filas.rows.map((f) => [f.t, Number(f.n)]))).toEqual({ intento: 1, consumo: 1, bitacora: 1, outbox: 1 });
  });

  it('rechaza el segundo uso con "Uso ya registrado" y no crea un segundo consumo', async () => {
    const primero = solicitud('TA-8801-0002');
    expect((await validar(primero)).json().decision).toBe('aceptado');
    reloj.avanzar(5_000);
    const segundo = await validar(solicitud('TA-8801-0002', { lectorId: 'LX-2210-114', puntoId: 'P-02' }));
    expect(segundo.statusCode).toBe(200);
    expect(segundo.json()).toMatchObject({ decision: 'rechazado', motivo: 'USO_YA_REGISTRADO', admision: false });
    expect(MOTIVO_TEXTO.USO_YA_REGISTRADO).toMatch(/^Uso ya registrado/);
    const consumos = await entorno.pool.query('SELECT 1 FROM consumo WHERE referencia = $1', ['TA-8801-0002']);
    expect(consumos.rowCount).toBe(1);
  });

  it('un reintento con el mismo idOrigen y contenido devuelve la decisión original sin duplicar evidencia', async () => {
    const s = solicitud('TA-8801-0003');
    const original = (await validar(s)).json();
    reloj.avanzar(10_000);
    const reintento = await validar(s);
    expect(reintento.statusCode).toBe(200);
    expect(reintento.json()).toMatchObject({
      idOrigen: s.idOrigen, decision: original.decision, motivo: original.motivo, instanteDecision: original.instanteDecision,
    });
    const outbox = await entorno.pool.query('SELECT 1 FROM outbox WHERE id_origen = $1', [s.idOrigen]);
    expect(outbox.rowCount).toBe(1);
  });

  it('el mismo idOrigen con contenido distinto es error de integridad (409)', async () => {
    const s = solicitud('TA-8801-0004');
    await validar(s);
    const alterada = await validar({ ...s, codigo: 'TA-8801-0005' });
    expect(alterada.statusCode).toBe(409);
    expect(alterada.json().error).toBe('CONFLICTO_IDEMPOTENCIA');
    const consumo = await entorno.pool.query('SELECT 1 FROM consumo WHERE referencia = $1', ['TA-8801-0005']);
    expect(consumo.rowCount).toBe(0);
  });

  it('rechaza código desconocido, zona no autorizada y boleta anulada', async () => {
    expect((await validar(solicitud('NO-EXISTE'))).json().motivo).toBe('CODIGO_DESCONOCIDO');
    expect((await validar(solicitud('TA-8801-0006', { lectorId: 'LX-2210-120', puntoId: 'P-03', zonaSolicitada: 'Palcos' }))).json().motivo).toBe('ZONA_NO_AUTORIZADA');
    expect((await validar(solicitud('TA-8801-0006', { zonaSolicitada: 'Palcos' }))).json().motivo).toBe('ZONA_NO_AUTORIZADA');
    expect((await validar(solicitud('TA-8809-0001'))).json().motivo).toBe('BOLETA_ANULADA');
  });

  it('lector revocado o desconocido no obtiene decisión (403)', async () => {
    expect((await validar(solicitud('TA-8801-0007', { lectorId: 'LX-2210-999' }))).statusCode).toBe(403);
    expect((await validar(solicitud('TA-8801-0007', { lectorId: 'LX-NADIE' }))).statusCode).toBe(403);
  });

  it('dos puntos que validan la misma boleta en paralelo producen exactamente un consumo', async () => {
    const intentos = Array.from({ length: 8 }, (_, i) =>
      validar(solicitud('TA-8801-0010', i % 2 ? { lectorId: 'LX-2210-114', puntoId: 'P-02' } : {})));
    const decisiones = (await Promise.all(intentos)).map((r) => r.json());
    expect(decisiones.filter((d) => d.decision === 'aceptado')).toHaveLength(1);
    expect(decisiones.every((d) => d.decision === 'aceptado' || d.motivo === 'USO_CONCURRENTE' || d.motivo === 'USO_YA_REGISTRADO')).toBe(true);
    const consumos = await entorno.pool.query('SELECT 1 FROM consumo WHERE referencia = $1', ['TA-8801-0010']);
    expect(consumos.rowCount).toBe(1);
  });

  it('la bitácora y el outbox son solo adición', async () => {
    await expect(entorno.pool.query('UPDATE bitacora SET tipo = tipo')).rejects.toThrow();
    await expect(entorno.pool.query('DELETE FROM bitacora')).rejects.toThrow();
    await expect(entorno.pool.query('DELETE FROM outbox')).rejects.toThrow();
  });
});

describe.skipIf(!dockerDisponible)('C2 con D1 caído', () => {
  it('responde sin confirmación y nunca acepta', async () => {
    const entorno = await iniciarD1();
    const reloj = new RelojAjustable();
    const app = montar(entorno, reloj);
    try {
      await entorno.contenedor.stop();
      const r = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: cuerpo(solicitud('TA-8801-0020')) });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ decision: 'sin-respuesta', admision: false });
    } finally {
      await app.close();
      await entorno.cerrar();
    }
  });

  it('sin D1 alcanzable responde dentro del plazo de 500 ms más margen', async () => {
    const almacen = await crearAlmacenPostgres(
      { host: '127.0.0.1', port: 1, database: 'nexo_venue', user: 'nexo', password: 'x' },
      { eventoId: EVENTO, migrar: false },
    );
    const app = montar({ almacen }, new RelojAjustable());
    try {
      const inicio = Date.now();
      const r = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: cuerpo(solicitud('TA-8801-0021')) });
      expect(Date.now() - inicio).toBeLessThan(900);
      expect(r.json().decision).toBe('sin-respuesta');
    } finally {
      await app.close();
      await almacen.cerrar();
    }
  });
});
