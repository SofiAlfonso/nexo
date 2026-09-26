import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoteEvidencia } from '../../../src/shared/contracts/e1.ts';
import { createD2Pool, migrate } from '../../../src/central-core/infrastructure/db/index.ts';
import { ServicioIngestaEvidencia } from '../../../src/central-core/modules/evidence-ingestion/application/index.ts';
import { RepositorioLotesPg } from '../../../src/central-core/modules/evidence-ingestion/infrastructure/index.ts';

const EVENTO_ID = 'EVT-2026-45';

const intento = {
  tipo: 'intento-diario', idOrigen: 'LEC-001:diario:0001', lectorId: 'LEC-001', puntoId: 'P-01',
  codigo: 'TA-8800-0000', zonaSolicitada: 'Norte', proposito: 'ingreso', motivoLocal: 'SIN_COORDINADOR',
  instanteLector: '2026-09-25T18:00:00.000Z', recibidoEnCoordinador: '2026-09-25T18:05:00.000Z',
} as const;

const lote = (idLote: string) => LoteEvidencia.parse({
  idLote, recintoId: 'REC-01', eventoId: EVENTO_ID, coordinadorId: 'COORD-A',
  emitidoEn: '2026-09-25T18:05:01.000Z', registros: [intento],
});

describe('PU-04-05: M2 proyecta en D2 el intento del diario como pendiente', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = createD2Pool({ ...process.env, D2_DATABASE_URL: contenedor.getConnectionUri() });
    await migrate(pool);
    await pool.query("INSERT INTO m1_config_permisos.clientes (id, nombre) VALUES ('cli-1', 'Cliente')");
    await pool.query("INSERT INTO m1_config_permisos.recintos (id, cliente_id, nombre) VALUES ('REC-01', 'cli-1', 'Recinto')");
    await pool.query(
      `INSERT INTO m1_config_permisos.eventos (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre, estado)
       VALUES ($1, 'REC-01', 'Evento', 'Evento', 'boleteria-sim', now(), now() + interval '4 hours', 'abierto')`,
      [EVENTO_ID],
    );
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  it('consolida una sola fila pendiente, sin decisión ni admisión retroactiva, aunque se reenvíe', async () => {
    const ingesta = new ServicioIngestaEvidencia(new RepositorioLotesPg(pool));
    const primero = await ingesta.procesarLote(lote('COORD-A:lote:0001'));
    expect(primero).toMatchObject({ aceptados: 1, resultados: [{ estado: 'aceptado' }] });
    expect(await ingesta.procesarLote(lote('COORD-A:lote:0001'))).toMatchObject({ repetido: true });
    expect(await ingesta.procesarLote(lote('COORD-A:lote:0002'))).toMatchObject({
      aceptados: 0, duplicados: 1, resultados: [{ estado: 'duplicado' }],
    });

    const { rows } = await pool.query(
      `SELECT i.id_origen, i.referencia, i.zona_solicitada, i.proposito, i.punto_id, i.lector_id,
              i.motivo_local, i.instante_lector, i.recibido_en_coordinador, i.estado, e.tipo
       FROM m2_evidencia.intentos_diario i JOIN m2_evidencia.evidencias e ON e.id = i.evidencia_id
       WHERE i.evento_id = $1`,
      [EVENTO_ID],
    );
    expect(rows).toEqual([{
      id_origen: intento.idOrigen, referencia: intento.codigo, zona_solicitada: 'Norte', proposito: 'ingreso',
      punto_id: 'P-01', lector_id: 'LEC-001', motivo_local: 'SIN_COORDINADOR',
      instante_lector: new Date(intento.instanteLector),
      recibido_en_coordinador: new Date(intento.recibidoEnCoordinador),
      estado: 'pendiente', tipo: 'intento-diario',
    }]);
    const decisiones = await pool.query(
      'SELECT count(*)::int AS n FROM m2_evidencia.decisiones WHERE evento_id = $1', [EVENTO_ID],
    );
    expect(decisiones.rows[0].n).toBe(0);
  });

  it('D2 no admite otro estado que pendiente para un intento del diario', async () => {
    await expect(pool.query(
      `UPDATE m2_evidencia.intentos_diario SET estado = 'aceptado' WHERE evento_id = $1`, [EVENTO_ID],
    )).rejects.toThrow(/intentos_diario_estado_check/);
  });
});
