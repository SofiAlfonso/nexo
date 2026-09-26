import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LoteDiario } from '@nexo/shared/contracts';
import { ErrorDiarioOcupado } from '../../../src/local-coordinator/infrastructure/persistence/postgres/almacen-postgres.ts';
import { dockerDisponible, EVENTO, iniciarD1 } from './entorno.ts';
import type { EntornoD1 } from './entorno.ts';

const registro = (idOrigen: string) => ({
  idOrigen, codigo: 'TA-8801-0001', proposito: 'ingreso' as const, zonaSolicitada: 'Norte',
  instanteLector: '2026-09-25T20:00:00.000Z', motivoLocal: 'SIN_COORDINADOR' as const, latenciaMs: null,
});
const lote = (idLote: string, ids: string[]): LoteDiario => ({
  idLote, lectorId: 'LX-2210-107', puntoId: 'P-01', eventoId: EVENTO, registros: ids.map(registro),
});

describe.skipIf(!dockerDisponible)('diario H1 en D1', () => {
  let d1: EntornoD1;

  beforeAll(async () => {
    d1 = await iniciarD1();
    await d1.pool.query(
      `INSERT INTO intento (id_origen, huella, evento_id, lector_id, punto_id, codigo, proposito, zona_solicitada,
                            instante_lector, decision, motivo, respuesta, decidido_en)
       VALUES ('H1-DECIDIDO', repeat('a', 64), $1, 'LX-2210-107', 'P-01', 'TA-8801-0002', 'ingreso', 'Norte', now(), 'rechazado',
               'BOLETA_DESCONOCIDA', '{}'::jsonb, now())`,
      [EVENTO],
    );
  });
  afterAll(async () => { await d1?.cerrar(); });

  it('clasifica por idOrigen en orden, guarda los nuevos con su outbox y repite el acuse por idLote', async () => {
    const recibido = new Date('2026-09-25T20:01:00.000Z');
    const acuse = await d1.almacen.diario.registrarLote(
      lote('H1-L1', ['H1-A', 'H1-DECIDIDO', 'H1-B', 'H1-A']), recibido,
    );
    expect(acuse).toEqual({
      idLote: 'H1-L1', recibidoEn: recibido.toISOString(), repetido: false,
      aceptados: ['H1-A', 'H1-B'], duplicados: ['H1-A'], yaDecididos: ['H1-DECIDIDO'],
    });
    const filas = await d1.pool.query<{ id_origen: string; instante_lector: Date; motivo_local: string; registro: { recibidoEnCoordinador: string } }>(
      `SELECT d.id_origen, d.instante_lector, d.motivo_local, o.registro FROM intento_diario d
         JOIN outbox o ON o.evento_id = d.evento_id AND o.tipo = 'intento-diario' AND o.id_origen = d.id_origen
        WHERE d.id_lote = 'H1-L1' ORDER BY o.id`,
    );
    expect(filas.rows.map((f) => f.id_origen)).toEqual(['H1-A', 'H1-B']);
    expect(filas.rows[0]).toMatchObject({ motivo_local: 'SIN_COORDINADOR', registro: { recibidoEnCoordinador: recibido.toISOString() } });
    expect(filas.rows[0]!.instante_lector.toISOString()).toBe('2026-09-25T20:00:00.000Z');

    expect(await d1.almacen.diario.registrarLote(lote('H1-L1', ['H1-A']), new Date())).toEqual({ ...acuse, repetido: true });
    const otro = await d1.almacen.diario.registrarLote(lote('H1-L2', ['H1-B', 'H1-C']), new Date());
    expect(otro).toMatchObject({ aceptados: ['H1-C'], duplicados: ['H1-B'], yaDecididos: [] });
  });

  it('atiende un lote a la vez: el concurrente se rechaza para que C1 lo reintente', async () => {
    const grande = lote('H1-L3', Array.from({ length: 500 }, (_, i) => `H1-G-${i}`));
    const resultados = await Promise.allSettled([
      d1.almacen.diario.registrarLote(grande, new Date()),
      d1.almacen.diario.registrarLote(lote('H1-L4', ['H1-D']), new Date()),
    ]);
    expect(resultados[0]).toMatchObject({ status: 'fulfilled', value: { repetido: false } });
    expect(resultados[1]).toMatchObject({ status: 'rejected', reason: expect.any(ErrorDiarioOcupado) });
    expect(await d1.almacen.diario.registrarLote(lote('H1-L4', ['H1-D']), new Date())).toMatchObject({ aceptados: ['H1-D'] });
  });
});
