import pg from 'pg';
import type { AcuseLoteDiario, LoteDiario, RegistroEvidencia, RegistroIntentoDiario } from '@nexo/shared/contracts';
import type {
  AlcanceAutenticado,
  FabricaUnidadValidacion,
  OutboxPendiente,
  PendienteOutbox,
  RegistroOutbox,
  RepositorioPermisos,
  ResolutorAlcance,
  VersionesInstaladas,
} from '@nexo/shared/domain';
import type { Almacen, RepositorioDiario } from '../../../application/puertos.ts';
import type { ConfigCoordinador } from '../../../config.ts';
import { migrate } from '../../db/index.ts';
import { UnidadValidacionPostgres } from './unidad-postgres.ts';

export { UnidadValidacionPostgres } from './unidad-postgres.ts';

export interface OpcionesAlmacenPostgres {
  eventoId: string;
  /** Aplica las migraciones de D1 al iniciar (idempotente, con advisory lock). */
  migrar?: boolean;
  /** Pool existente (pruebas); si se pasa, `cerrar()` no lo termina. */
  pool?: pg.Pool;
  /** Tope de espera por conexión y por sentencia: D1 lento o caído → "sin confirmación" rápido. */
  conexionTimeoutMs?: number;
  sentenciaTimeoutMs?: number;
  lockTimeoutMs?: number;
}

export function crearPoolD1(cfg: NonNullable<ConfigCoordinador['postgres']>, conexionTimeoutMs = 400): pg.Pool {
  return new pg.Pool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    max: 10,
    connectionTimeoutMillis: conexionTimeoutMs,
    idleTimeoutMillis: 30_000,
  });
}

/** Adaptador PostgreSQL de D1 con el esquema de `infrastructure/db/` (S1-data). */
export async function crearAlmacenPostgres(
  cfg: NonNullable<ConfigCoordinador['postgres']> | null,
  opciones: OpcionesAlmacenPostgres,
): Promise<Almacen> {
  if (!cfg && !opciones.pool) throw new Error('Falta la configuración de D1');
  const propio = !opciones.pool;
  const pool = opciones.pool ?? crearPoolD1(cfg!, opciones.conexionTimeoutMs);
  // Un cliente inactivo que pierde la conexión no debe tumbar el proceso.
  pool.on('error', () => undefined);
  if (opciones.migrar ?? true) await migrate(pool);

  const eventoId = opciones.eventoId;
  const lockTimeoutMs = opciones.lockTimeoutMs ?? 1_000;
  const statementTimeoutMs = opciones.sentenciaTimeoutMs ?? 2_000;

  const unidades: FabricaUnidadValidacion = {
    async abrir() {
      const cliente = await pool.connect();
      return UnidadValidacionPostgres.abrir(cliente, { lockTimeoutMs, statementTimeoutMs });
    },
  };

  const alcance: ResolutorAlcance = {
    async resolver(lectorId: string): Promise<AlcanceAutenticado> {
      const r = await pool.query<{ evento_id: string; punto_id: string; habilitado: boolean; revocado: boolean }>(
        'SELECT evento_id, punto_id, habilitado, revocado FROM lector WHERE evento_id = $1 AND lector_id = $2',
        [eventoId, lectorId],
      );
      const f = r.rows[0];
      if (!f) return { lectorId, eventoId: null, puntoId: null, revocado: false };
      return { lectorId, eventoId: f.evento_id, puntoId: f.punto_id, revocado: f.revocado || !f.habilitado };
    },
  };

  const outbox: OutboxPendiente = {
    async pendientes(limite: number): Promise<PendienteOutbox[]> {
      const r = await pool.query<{ id: string; evento_id: string; creado_en: Date; registro: RegistroEvidencia }>(
        `SELECT o.id, o.evento_id, o.creado_en, COALESCE(o.registro, o.payload) AS registro
           FROM outbox o LEFT JOIN outbox_envio e ON e.outbox_id = o.id
          WHERE e.outbox_id IS NULL AND o.evento_id = $1
          ORDER BY o.id LIMIT $2`,
        [eventoId, limite],
      );
      return r.rows.map((f) => ({ id: Number(f.id), eventoId: f.evento_id, creadoEn: f.creado_en, registro: f.registro }));
    },
    async registrarAcuse(ids, idLote, acusadoEn) {
      if (ids.length === 0) return;
      await pool.query(
        `INSERT INTO outbox_envio (outbox_id, id_lote, acusado_en)
         SELECT unnest($1::bigint[]), $2, $3 ON CONFLICT (outbox_id) DO NOTHING`,
        [ids, idLote, acusadoEn],
      );
    },
    async resumen(ahora: Date) {
      const r = await pool.query<{ pendientes: string; mas_antiguo: Date | null }>(
        `SELECT count(*) AS pendientes, min(o.creado_en) AS mas_antiguo
           FROM outbox o LEFT JOIN outbox_envio e ON e.outbox_id = o.id
          WHERE e.outbox_id IS NULL AND o.evento_id = $1`,
        [eventoId],
      );
      const f = r.rows[0]!;
      const edadMaxS = f.mas_antiguo ? Math.max(0, (ahora.getTime() - f.mas_antiguo.getTime()) / 1000) : 0;
      return { pendientes: Number(f.pendientes), edadMaxS };
    },
    async agregar(registros: readonly RegistroOutbox[]) {
      for (const r of registros) {
        await pool.query(
          `INSERT INTO outbox (evento_id, tipo, id_origen, registro) VALUES ($1,$2,$3,$4)
           ON CONFLICT (evento_id, tipo, id_origen) DO NOTHING`,
          [r.eventoId, r.registro.tipo, r.registro.idOrigen, JSON.stringify(r.registro)],
        );
      }
    },
  };

  const diario: RepositorioDiario = {
    async registrarLote(lote: LoteDiario, recibidoEn: Date): Promise<AcuseLoteDiario> {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(`SET LOCAL statement_timeout = ${statementTimeoutMs}`);
        await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`diario:${lote.idLote}`]);
        const previo = await cliente.query<{ acuse: AcuseLoteDiario }>('SELECT acuse FROM diario_lote WHERE id_lote = $1', [lote.idLote]);
        if (previo.rows[0]) {
          await cliente.query('ROLLBACK');
          return { ...previo.rows[0].acuse, repetido: true };
        }
        const acuse: AcuseLoteDiario = {
          idLote: lote.idLote,
          recibidoEn: recibidoEn.toISOString(),
          aceptados: [],
          duplicados: [],
          yaDecididos: [],
          repetido: false,
        };
        const nuevos: RegistroIntentoDiario[] = [];
        const vistos = new Set<string>();
        for (const r of lote.registros) {
          if (vistos.has(r.idOrigen)) {
            acuse.duplicados.push(r.idOrigen);
            continue;
          }
          vistos.add(r.idOrigen);
          const decidido = await cliente.query('SELECT 1 FROM intento WHERE id_origen = $1 AND decision IS NOT NULL', [r.idOrigen]);
          if (decidido.rowCount) {
            acuse.yaDecididos.push(r.idOrigen);
            continue;
          }
          const recibido = await cliente.query('SELECT 1 FROM intento_diario WHERE evento_id = $1 AND id_origen = $2', [lote.eventoId, r.idOrigen]);
          if (recibido.rowCount) {
            acuse.duplicados.push(r.idOrigen);
            continue;
          }
          acuse.aceptados.push(r.idOrigen);
          nuevos.push({
            tipo: 'intento-diario',
            idOrigen: r.idOrigen,
            lectorId: lote.lectorId,
            puntoId: lote.puntoId,
            codigo: r.codigo,
            zonaSolicitada: r.zonaSolicitada,
            proposito: r.proposito,
            motivoLocal: r.motivoLocal,
            instanteLector: r.instanteLector,
            recibidoEnCoordinador: recibidoEn.toISOString(),
          });
        }
        await cliente.query(
          'INSERT INTO diario_lote (id_lote, evento_id, lector_id, acuse, recibido_en) VALUES ($1,$2,$3,$4,$5)',
          [lote.idLote, lote.eventoId, lote.lectorId, JSON.stringify(acuse), recibidoEn],
        );
        for (const n of nuevos) {
          await cliente.query(
            `INSERT INTO intento_diario (evento_id, id_origen, id_lote, lector_id, punto_id, codigo, proposito, zona_solicitada,
                                         motivo_local, instante_lector, recibido_en)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [lote.eventoId, n.idOrigen, lote.idLote, n.lectorId, n.puntoId, n.codigo, n.proposito, n.zonaSolicitada, n.motivoLocal, n.instanteLector, recibidoEn],
          );
          await cliente.query(
            `INSERT INTO outbox (evento_id, tipo, id_origen, registro) VALUES ($1,'intento-diario',$2,$3)
             ON CONFLICT (evento_id, tipo, id_origen) DO NOTHING`,
            [lote.eventoId, n.idOrigen, JSON.stringify(n)],
          );
        }
        const fin = await cliente.query('COMMIT');
        if (fin.command !== 'COMMIT') throw new Error('D1 no confirmó el lote del diario');
        return acuse;
      } catch (e) {
        await cliente.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        cliente.release();
      }
    },
  };

  const permisos: RepositorioPermisos = {
    async versionInstalada(id: string): Promise<VersionesInstaladas | null> {
      const r = await pool.query<{ version_permisos: string; version_politicas: string; permisos_recibidos_en: Date | null }>(
        'SELECT version_permisos, version_politicas, permisos_recibidos_en FROM evento WHERE evento_id = $1',
        [id],
      );
      const f = r.rows[0];
      if (!f) return null;
      return {
        versionPermisos: Number(f.version_permisos),
        versionPoliticas: Number(f.version_politicas),
        permisosRecibidosEn: f.permisos_recibidos_en,
      };
    },
  };

  return {
    unidades,
    alcance,
    outbox,
    diario,
    permisos,
    async salud() {
      try {
        await pool.query('SELECT 1');
        return true;
      } catch {
        return false;
      }
    },
    async cerrar() {
      if (propio) await pool.end();
    },
  };
}
