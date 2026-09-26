import type { Pool, PoolClient } from 'pg';
import {
  ConflictoImportacion,
  type ImportacionRegistrada,
  type ImportacionesRepositorio,
  type ResultadoImportacion,
  type SolicitudImportacion,
} from '../application/index.ts';
import { normalizarLocalidad } from '../domain/index.ts';

// D2: m1_config_permisos.importaciones_boleteria (020) registra cada versión P1 aplicada.
interface EstadoBoleta {
  zonaId: string;
  anulada: boolean;
  nueva: boolean;
  tocada: boolean;
  version: number;
  anulacionEmitidaEn: string | null;
}

interface FilaCambio {
  version: number;
  referencia: string;
  operacion: 'alta' | 'anulacion' | 'cambio-zona';
  zonaId: string | null;
}

export class ImportacionesRepositorioPg implements ImportacionesRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async ultimaImportacion(eventoId: string): Promise<ImportacionRegistrada | null> {
    const { rows } = await this.pool.query<{ evento_externo: string; version_externa: number; huella: string }>(`
      SELECT evento_externo, version_externa, huella
      FROM m1_config_permisos.importaciones_boleteria
      WHERE evento_id = $1 ORDER BY version_externa DESC LIMIT 1
    `, [eventoId]);
    const f = rows[0];
    return f ? { eventoExterno: f.evento_externo, versionExterna: f.version_externa, huella: f.huella } : null;
  }

  async huellaImportada(eventoId: string, versionExterna: number): Promise<string | null> {
    const { rows } = await this.pool.query<{ huella: string }>(
      'SELECT huella FROM m1_config_permisos.importaciones_boleteria WHERE evento_id = $1 AND version_externa = $2',
      [eventoId, versionExterna],
    );
    return rows[0]?.huella ?? null;
  }

  async zonasPorLocalidad(eventoId: string): Promise<Map<string, string>> {
    const { rows } = await this.pool.query<{ id: string; nombre: string }>(
      'SELECT id, nombre FROM m1_config_permisos.zonas WHERE evento_id = $1', [eventoId],
    );
    return new Map(rows.map(f => [normalizarLocalidad(f.nombre), f.id]));
  }

  async importar(s: SolicitudImportacion): Promise<ResultadoImportacion> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await this.importarEnTransaccion(cliente, s);
      await cliente.query('COMMIT');
      return resultado;
    } catch (error) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cliente.release();
    }
  }

  private async importarEnTransaccion(cliente: PoolClient, s: SolicitudImportacion): Promise<ResultadoImportacion> {
    // El bloqueo del evento serializa importaciones concurrentes y la numeración de versiones.
    const evento = await cliente.query<{ version_permisos: number }>(
      'SELECT version_permisos FROM m1_config_permisos.eventos WHERE id = $1 FOR UPDATE', [s.eventoId],
    );
    if (!evento.rows[0]) throw new Error(`El evento ${s.eventoId} no existe en D2`);
    const desde = evento.rows[0].version_permisos;

    const previa = await cliente.query<{ huella: string; version_permisos_desde: number; version_permisos_hasta: number }>(`
      SELECT huella, version_permisos_desde, version_permisos_hasta
      FROM m1_config_permisos.importaciones_boleteria WHERE evento_id = $1 AND version_externa = $2
    `, [s.eventoId, s.versionExterna]);
    if (previa.rows[0]) {
      if (previa.rows[0].huella !== s.huella) {
        throw new ConflictoImportacion(`La versión externa ${s.versionExterna} ya se importó con otro contenido`);
      }
      return {
        repetida: true,
        versionPermisosDesde: previa.rows[0].version_permisos_desde,
        versionPermisosHasta: previa.rows[0].version_permisos_hasta,
        cambiosAplicados: 0,
      };
    }

    const referencias = [...new Set(s.cambios.map(c => c.referencia))];
    const existentes = await cliente.query<{ referencia: string; zona_id: string; anulada: boolean; version: number }>(`
      SELECT referencia, zona_id, anulada, version FROM m1_config_permisos.boletas
      WHERE evento_id = $1 AND referencia = ANY($2::text[])
    `, [s.eventoId, referencias]);
    const boletas = new Map<string, EstadoBoleta>(existentes.rows.map(f => [f.referencia, {
      zonaId: f.zona_id, anulada: f.anulada, nueva: false, tocada: false, version: f.version, anulacionEmitidaEn: null,
    }]));

    // Solo los cambios efectivos consumen una versión canónica; repetir una emisión vigente no cambia nada.
    let version = desde;
    const filas: FilaCambio[] = [];
    for (const c of s.cambios) {
      const b = boletas.get(c.referencia);
      if (c.operacion === 'emision' && !b) {
        version++;
        boletas.set(c.referencia, { zonaId: c.zonaId, anulada: false, nueva: true, tocada: true, version, anulacionEmitidaEn: null });
        filas.push({ version, referencia: c.referencia, operacion: 'alta', zonaId: c.zonaId });
      } else if ((c.operacion === 'emision' || c.operacion === 'cambio-zona') && b && !b.anulada && b.zonaId !== c.zonaId) {
        version++;
        Object.assign(b, { zonaId: c.zonaId, tocada: true, version });
        filas.push({ version, referencia: c.referencia, operacion: 'cambio-zona', zonaId: c.zonaId });
      } else if (c.operacion === 'anulacion' && b && !b.anulada) {
        version++;
        Object.assign(b, { anulada: true, anulacionEmitidaEn: c.instante, tocada: true, version });
        filas.push({ version, referencia: c.referencia, operacion: 'anulacion', zonaId: null });
      }
    }

    const tocadas = [...boletas.entries()].filter(([, b]) => b.tocada);
    const columnas = (lista: [string, EstadoBoleta][]) => [
      lista.map(([r]) => r), lista.map(([, b]) => b.zonaId), lista.map(([, b]) => b.anulada),
      lista.map(([, b]) => b.anulacionEmitidaEn), lista.map(([, b]) => b.version),
    ];
    const nuevas = tocadas.filter(([, b]) => b.nueva);
    const modificadas = tocadas.filter(([, b]) => !b.nueva);
    if (nuevas.length > 0) {
      await cliente.query(`
        INSERT INTO m1_config_permisos.boletas
          (evento_id, referencia, zona_id, anulada, anulacion_emitida_en, anulacion_recibida_en, version)
        SELECT $1, u.referencia, u.zona_id, u.anulada, u.emitida,
               CASE WHEN u.anulada THEN $7::timestamptz END, u.version
        FROM unnest($2::text[], $3::text[], $4::boolean[], $5::timestamptz[], $6::integer[])
          AS u(referencia, zona_id, anulada, emitida, version)
      `, [s.eventoId, ...columnas(nuevas), s.recibidoEn]);
    }
    if (modificadas.length > 0) {
      await cliente.query(`
        UPDATE m1_config_permisos.boletas b
        SET zona_id = u.zona_id,
            anulada = u.anulada,
            anulacion_emitida_en = CASE WHEN u.anulada AND NOT b.anulada THEN u.emitida ELSE b.anulacion_emitida_en END,
            anulacion_recibida_en = CASE WHEN u.anulada AND NOT b.anulada THEN $7::timestamptz ELSE b.anulacion_recibida_en END,
            version = u.version
        FROM unnest($2::text[], $3::text[], $4::boolean[], $5::timestamptz[], $6::integer[])
          AS u(referencia, zona_id, anulada, emitida, version)
        WHERE b.evento_id = $1 AND b.referencia = u.referencia
      `, [s.eventoId, ...columnas(modificadas), s.recibidoEn]);
    }
    if (filas.length > 0) {
      await cliente.query(`
        INSERT INTO m1_config_permisos.cambios_permisos (evento_id, version, referencia, operacion, zona_id, recibido_en)
        SELECT $1, u.version, u.referencia, u.operacion, u.zona_id, $6
        FROM unnest($2::integer[], $3::text[], $4::text[], $5::text[]) AS u(version, referencia, operacion, zona_id)
      `, [s.eventoId, filas.map(f => f.version), filas.map(f => f.referencia), filas.map(f => f.operacion),
        filas.map(f => f.zonaId), s.recibidoEn]);
    }
    await cliente.query(`
      UPDATE m1_config_permisos.eventos
      SET version_permisos = $2, ultimo_cambio_recibido = $3
      WHERE id = $1
    `, [s.eventoId, version, s.recibidoEn]);
    await cliente.query(`
      INSERT INTO m1_config_permisos.importaciones_boleteria
        (evento_id, evento_externo, version_externa, huella, instantanea, cambios_recibidos, cambios_aplicados,
         version_permisos_desde, version_permisos_hasta, importada_en)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [s.eventoId, s.eventoExterno, s.versionExterna, s.huella, s.instantanea, s.cambios.length, filas.length,
      desde, version, s.recibidoEn]);
    return { repetida: false, versionPermisosDesde: desde, versionPermisosHasta: version, cambiosAplicados: filas.length };
  }
}
