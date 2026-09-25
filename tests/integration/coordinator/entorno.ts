import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { crearAlmacenPostgres } from '../../../src/local-coordinator/infrastructure/persistence/postgres/almacen-postgres.ts';
import type { Almacen } from '../../../src/local-coordinator/application/puertos.ts';

export const dockerDisponible = spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 15_000 }).status === 0;

export const EVENTO = 'EVT-2026-02';

export class RelojAjustable {
  private desplazamientoMs = 0;
  ahora(): Date {
    return new Date(Date.now() + this.desplazamientoMs);
  }
  avanzar(ms: number): void {
    this.desplazamientoMs += ms;
  }
}

export interface EntornoD1 {
  contenedor: StartedPostgreSqlContainer;
  pool: pg.Pool;
  almacen: Almacen;
  cerrar(): Promise<void>;
}

export async function iniciarD1(): Promise<EntornoD1> {
  const contenedor = await new PostgreSqlContainer('postgres:16-alpine').start();
  const pool = new pg.Pool({ connectionString: contenedor.getConnectionUri(), max: 10, connectionTimeoutMillis: 2_000 });
  pool.on('error', () => undefined);
  const almacen = await crearAlmacenPostgres(null, { eventoId: EVENTO, pool, migrar: true });
  await sembrar(pool);
  return {
    contenedor,
    pool,
    almacen,
    async cerrar() {
      await almacen.cerrar();
      await pool.end().catch(() => undefined);
      await contenedor.stop().catch(() => undefined);
    },
  };
}

/** Semilla mínima: EVT-2026-02 abierto, P-01 (Norte, Palcos) y P-02 (Sur), un lector por punto y boletas. */
export async function sembrar(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO evento (evento_id, cliente_id, boleteria_id, recinto_id, estado, apertura_en, cierre_en,
                         version_permisos, version_politicas, reingreso_permitido, permisos_recibidos_en)
     VALUES ($1, 'CLI-001', 'BOL-01', 'REC-01', 'abierto', now() - interval '1 hour', now() + interval '12 hours', 37, 2, false, now())`,
    [EVENTO],
  );
  await pool.query(
    `INSERT INTO punto (evento_id, punto_id, zonas) VALUES ($1, 'P-01', ARRAY['Norte','Palcos']), ($1, 'P-02', ARRAY['Norte','Sur']), ($1, 'P-03', ARRAY['Palcos'])`,
    [EVENTO],
  );
  await pool.query(
    `INSERT INTO lector (evento_id, lector_id, punto_id, revocado) VALUES
       ($1, 'LX-2210-107', 'P-01', false), ($1, 'LX-2210-114', 'P-02', false), ($1, 'LX-2210-120', 'P-03', false), ($1, 'LX-2210-999', 'P-01', true)`,
    [EVENTO],
  );
  for (let i = 1; i <= 40; i++) {
    const referencia = `TA-8801-${String(i).padStart(4, '0')}`;
    await pool.query('INSERT INTO boleta (evento_id, referencia, codigo, zona, version) VALUES ($1,$2,$2,$3,37)', [EVENTO, referencia, 'Norte']);
  }
  await pool.query(
    `INSERT INTO boleta (evento_id, referencia, codigo, zona, version, anulada_en, anulacion_recibida_en)
     VALUES ($1, 'TA-8809-0001', 'TA-8809-0001', 'Norte', 37, now() - interval '30 minutes', now() - interval '29 minutes')`,
    [EVENTO],
  );
}

let secuencia = 0;
export function solicitud(
  codigo: string,
  extra: Partial<{ idOrigen: string; lectorId: string; puntoId: string; zonaSolicitada: string; instanteLector: Date }> = {},
) {
  secuencia++;
  const lectorId = extra.lectorId ?? 'LX-2210-107';
  return {
    idOrigen: extra.idOrigen ?? `${lectorId}:${Date.now()}:${secuencia}`,
    eventoId: EVENTO,
    lectorId,
    puntoId: extra.puntoId ?? 'P-01',
    codigo,
    proposito: 'ingreso' as const,
    zonaSolicitada: extra.zonaSolicitada ?? 'Norte',
    instanteLector: extra.instanteLector ?? new Date(),
  };
}
