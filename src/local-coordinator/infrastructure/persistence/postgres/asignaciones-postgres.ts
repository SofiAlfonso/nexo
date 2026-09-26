import type pg from 'pg';
import { ErrorReemplazoInvalido } from '../../../application/reemplazo-lector.ts';
import type {
  CredencialRevocada, MotivoRevocacion, ReemplazoRegistrado, RepositorioAsignaciones,
  SolicitudReemplazoLector, SolicitudRevocacionPendiente,
} from '../../../application/puertos.ts';

interface FilaLector {
  evento_id: string;
  punto_id: string;
  habilitado: boolean;
  revocado: boolean;
}

/** Asignación lector–punto en D1 (PU-05-02); ver `040_c2_reemplazo_lector.sql`. */
export class RepositorioAsignacionesPg implements RepositorioAsignaciones {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async reemplazar(s: SolicitudReemplazoLector, instante: Date): Promise<ReemplazoRegistrado> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const anterior = (await client.query<FilaLector>(
        'SELECT evento_id, punto_id, habilitado, revocado FROM lector WHERE evento_id = $1 AND lector_id = $2 FOR UPDATE',
        [s.eventoId, s.lectorAnterior],
      )).rows[0];
      const previo = (await client.query<{ id: string; punto_id: string; lector_nuevo: string; reemplazado_en: Date; solicitud: string }>(
        `SELECT r.id, r.punto_id, r.lector_nuevo, r.reemplazado_en, sr.id AS solicitud
         FROM reemplazo_lector r JOIN solicitud_revocacion sr ON sr.reemplazo_id = r.id
         WHERE r.evento_id = $1 AND r.lector_anterior = $2`,
        [s.eventoId, s.lectorAnterior],
      )).rows[0];
      if (previo) {
        if (previo.punto_id !== s.puntoId || previo.lector_nuevo !== s.lectorNuevo) {
          throw new ErrorReemplazoInvalido(
            `${s.lectorAnterior} ya fue reemplazado por ${previo.lector_nuevo} en ${previo.punto_id}`,
          );
        }
        await client.query('COMMIT');
        return {
          reemplazoId: Number(previo.id), solicitudRevocacionId: Number(previo.solicitud),
          reemplazadoEn: previo.reemplazado_en, repetido: true,
        };
      }
      if (!anterior || anterior.punto_id !== s.puntoId || !anterior.habilitado || anterior.revocado) {
        throw new ErrorReemplazoInvalido(`${s.lectorAnterior} no tiene una asignación vigente en ${s.puntoId}`);
      }

      const nuevo = (await client.query<FilaLector>(
        'SELECT evento_id, punto_id, habilitado, revocado FROM lector WHERE lector_id = $1 FOR UPDATE',
        [s.lectorNuevo],
      )).rows[0];
      if (nuevo) {
        if (nuevo.evento_id !== s.eventoId) throw new ErrorReemplazoInvalido(`${s.lectorNuevo} pertenece a otro evento`);
        if (nuevo.revocado) throw new ErrorReemplazoInvalido(`${s.lectorNuevo} está revocado: nunca se reutiliza una identidad`);
        if (nuevo.habilitado && nuevo.punto_id !== s.puntoId) {
          throw new ErrorReemplazoInvalido(`${s.lectorNuevo} ya está asignado a ${nuevo.punto_id}`);
        }
        await client.query(
          'UPDATE lector SET punto_id = $3, habilitado = true WHERE evento_id = $1 AND lector_id = $2',
          [s.eventoId, s.lectorNuevo, s.puntoId],
        );
      } else {
        await client.query(
          'INSERT INTO lector (evento_id, lector_id, punto_id, habilitado, revocado) VALUES ($1, $2, $3, true, false)',
          [s.eventoId, s.lectorNuevo, s.puntoId],
        );
      }
      await client.query(
        'UPDATE lector SET revocado = true, habilitado = false WHERE evento_id = $1 AND lector_id = $2',
        [s.eventoId, s.lectorAnterior],
      );
      const reemplazo = await client.query<{ id: string }>(
        `INSERT INTO reemplazo_lector (evento_id, punto_id, lector_anterior, lector_nuevo, motivo, reemplazado_en)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [s.eventoId, s.puntoId, s.lectorAnterior, s.lectorNuevo, s.motivo, instante],
      );
      const solicitud = await client.query<{ id: string }>(
        `INSERT INTO solicitud_revocacion (reemplazo_id, evento_id, lector_id, motivo, solicitada_en)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [reemplazo.rows[0]!.id, s.eventoId, s.lectorAnterior, s.motivo, instante],
      );
      await client.query('COMMIT');
      return {
        reemplazoId: Number(reemplazo.rows[0]!.id), solicitudRevocacionId: Number(solicitud.rows[0]!.id),
        reemplazadoEn: instante, repetido: false,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revocacionesPendientes(eventoId: string): Promise<SolicitudRevocacionPendiente[]> {
    const { rows } = await this.pool.query<{ id: string; lector_id: string; motivo: MotivoRevocacion; solicitada_en: Date }>(
      `SELECT s.id, s.lector_id, s.motivo, s.solicitada_en FROM solicitud_revocacion s
       WHERE s.evento_id = $1 AND NOT EXISTS (SELECT 1 FROM revocacion_credencial c WHERE c.solicitud_id = s.id)
       ORDER BY s.id`,
      [eventoId],
    );
    return rows.map((f) => ({
      id: Number(f.id), eventoId, lectorId: f.lector_id, motivo: f.motivo, solicitadaEn: f.solicitada_en,
    }));
  }

  async registrarRevocacion(solicitudId: number, c: CredencialRevocada, registradaEn: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO revocacion_credencial (solicitud_id, numero_serie, huella_sha256, revocada_en, registrada_en)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (solicitud_id) DO NOTHING`,
      [solicitudId, c.serialNumber, c.fingerprint256, c.revokedAt, registradaEn],
    );
  }
}
