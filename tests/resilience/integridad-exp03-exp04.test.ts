import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../src/local-coordinator/application/prioridad.ts';
import { ServicioValidacion } from '../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor } from '../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../src/local-coordinator/config.ts';
import { dockerDisponible, EVENTO, iniciarD1, RelojAjustable, solicitud } from '../integration/coordinator/entorno.ts';
import type { EntornoD1 } from '../integration/coordinator/entorno.ts';

const config = cargarConfig({ EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-RESILIENCE' });

function montar(entorno: EntornoD1): FastifyInstance {
  const reloj = new RelojAjustable();
  const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
    unidades: entorno.almacen.unidades,
    alcance: entorno.almacen.alcance,
    autoridad: new AutoridadNodoUnico(config.coordinadorId),
    reloj,
  }), new ContadorV1(), config, reloj);
  return crearServidor({ servicio, almacen: entorno.almacen, latidos: new RegistroLatidos(), config, reloj });
}

type Peticion = ReturnType<typeof solicitud>;

function validar(app: FastifyInstance, peticion: Peticion) {
  return app.inject({
    method: 'POST',
    url: '/v1/validaciones',
    payload: { ...peticion, instanteLector: peticion.instanteLector.toISOString() },
  });
}

describe.skipIf(!dockerDisponible)('Integridad C2/D1: EXP 03 y EXP 04', () => {
  let entorno: EntornoD1;
  let app: FastifyInstance;

  beforeAll(async () => {
    entorno = await iniciarD1();
    app = montar(entorno);
    await app.ready();
    await validar(app, solicitud('NO-EXISTE', { idOrigen: 'EXP-WARMUP' }));
  });
  afterAll(async () => {
    await app?.close();
    await entorno?.cerrar();
  });

  it('EXP 03: tras perder la respuesta y reiniciar C2, el mismo idOrigen recupera la decisión sin duplicar evidencia', async () => {
    const peticion = solicitud('TA-8801-0001', { idOrigen: 'EXP03-REINTENTO' });
    const primeraRespuesta = await validar(app, peticion);
    expect(primeraRespuesta.statusCode).toBe(200);
    expect(primeraRespuesta.json()).toMatchObject({ decision: 'aceptado', admision: true, repetida: false });

    // El lector no recibe la primera respuesta; C2 reinicia, pero D1 conserva el commit.
    await app.close();
    app = montar(entorno);
    await app.ready();
    const reintento = await validar(app, peticion);
    expect(reintento.statusCode).toBe(200);
    expect(reintento.json()).toEqual({ ...primeraRespuesta.json(), repetida: true });

    const cambiado = await validar(app, { ...peticion, codigo: 'TA-8801-0002' });
    expect(cambiado.statusCode).toBe(409);
    expect(cambiado.json()).toMatchObject({ error: 'CONFLICTO_IDEMPOTENCIA' });

    const integridad = await entorno.pool.query<{
      intentos: string; decisiones: string; consumos: string; bitacora: string; outbox: string; otros: string;
    }>(
      `SELECT
         (SELECT count(*) FROM intento WHERE id_origen = $1) AS intentos,
         (SELECT count(*) FROM intento WHERE id_origen = $1 AND decision = 'aceptado') AS decisiones,
         (SELECT count(*) FROM consumo WHERE id_origen = $1) AS consumos,
         (SELECT count(*) FROM bitacora WHERE id_origen = $1 AND tipo = 'decision') AS bitacora,
         (SELECT count(*) FROM outbox WHERE id_origen = $1 AND tipo = 'decision') AS outbox,
         (SELECT count(*) FROM consumo WHERE evento_id = $2 AND referencia = 'TA-8801-0002') AS otros`,
      [peticion.idOrigen, EVENTO],
    );
    expect(Object.values(integridad.rows[0]!).map(Number)).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it('EXP 04: 500 boletas desde dos lectores simultáneos producen 500 aceptaciones y 500 rechazos íntegros', async () => {
    const prefijo = 'EXP04-';
    await entorno.pool.query(
      `INSERT INTO boleta (evento_id, referencia, codigo, zona, version)
       SELECT $1, 'EXP04-' || lpad(n::text, 4, '0'), 'EXP04-' || lpad(n::text, 4, '0'), 'Norte', 37
       FROM generate_series(1, 500) AS n`,
      [EVENTO],
    );

    const respuestas: Array<{ idOrigen: string; decision: string; motivo: string; admision: boolean }> = [];
    // Cada pareja corre a la vez; una pareja en vuelo evita confundir saturación del pool
    // y el plazo de V1 (500 ms) con una carrera de consumo.
    for (let numero = 1; numero <= 500; numero++) {
      const codigo = `${prefijo}${String(numero).padStart(4, '0')}`;
      const par = await Promise.all([
        validar(app, solicitud(codigo, { idOrigen: `${codigo}-N`, lectorId: 'LX-2210-107', puntoId: 'P-01' })),
        validar(app, solicitud(codigo, { idOrigen: `${codigo}-S`, lectorId: 'LX-2210-114', puntoId: 'P-02' })),
      ]);
      for (const r of par) {
        expect(r.statusCode).toBe(200);
        respuestas.push(r.json());
      }
    }

    expect(respuestas).toHaveLength(1_000);
    const distribucion = Object.groupBy(respuestas, (r) => `${r.decision}:${r.motivo}`);
    expect(respuestas.filter((r) => r.decision === 'aceptado' && r.admision).length, JSON.stringify(Object.fromEntries(
      Object.entries(distribucion).map(([clave, filas]) => [clave, filas?.length]),
    ))).toBe(500);
    expect(respuestas.filter((r) => r.decision === 'rechazado' && !r.admision &&
      (r.motivo === 'USO_CONCURRENTE' || r.motivo === 'USO_YA_REGISTRADO'))).toHaveLength(500);

    const integridad = await entorno.pool.query<{
      consumos: string; aceptados: string; rechazados: string; intentos: string;
      bitacora: string; outbox: string; boletas_invalidas: string; evidencia_incompleta: string;
    }>(
      `WITH candidatos AS (
         SELECT i.id_origen, i.codigo, i.decision, i.motivo
         FROM intento i WHERE i.evento_id = $1 AND i.id_origen LIKE 'EXP04-%'
       ), por_boleta AS (
         SELECT codigo, count(*) AS intentos,
                count(*) FILTER (WHERE decision = 'aceptado') AS aceptados,
                count(*) FILTER (WHERE decision = 'rechazado') AS rechazados
         FROM candidatos GROUP BY codigo
       )
       SELECT
         (SELECT count(*) FROM consumo WHERE evento_id = $1 AND referencia LIKE 'EXP04-%') AS consumos,
         (SELECT count(*) FROM candidatos WHERE decision = 'aceptado') AS aceptados,
         (SELECT count(*) FROM candidatos WHERE decision = 'rechazado'
            AND motivo IN ('USO_CONCURRENTE', 'USO_YA_REGISTRADO')) AS rechazados,
         (SELECT count(*) FROM candidatos) AS intentos,
         (SELECT count(*) FROM bitacora WHERE evento_id = $1 AND tipo = 'decision' AND id_origen LIKE 'EXP04-%') AS bitacora,
         (SELECT count(*) FROM outbox WHERE evento_id = $1 AND tipo = 'decision' AND id_origen LIKE 'EXP04-%') AS outbox,
         (SELECT count(*) FROM por_boleta WHERE intentos <> 2 OR aceptados <> 1 OR rechazados <> 1)
           + (500 - (SELECT count(*) FROM por_boleta)) AS boletas_invalidas,
         (SELECT count(*) FROM candidatos c
           LEFT JOIN bitacora b ON b.id_origen = c.id_origen AND b.tipo = 'decision'
           LEFT JOIN outbox o ON o.id_origen = c.id_origen AND o.tipo = 'decision' AND o.bitacora_id = b.id
           WHERE b.id IS NULL OR o.id IS NULL)
           AS evidencia_incompleta`,
      [EVENTO],
    );
    expect(Object.fromEntries(Object.entries(integridad.rows[0]!).map(([clave, valor]) => [clave, Number(valor)]))).toEqual({
      consumos: 500, aceptados: 500, rechazados: 500, intentos: 1_000,
      bitacora: 1_000, outbox: 1_000, boletas_invalidas: 0, evidencia_incompleta: 0,
    });
  }, 120_000);
});
