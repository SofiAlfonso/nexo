import type { CambioPermiso, Evento } from '@nexo/shared/contracts';
import type { Pool } from 'pg';
import type { EventoConfigRepositorio, PermisosRepositorio, PuntoConfigRepositorio } from '../application/puertos.ts';
import type { EventoConfigurado, PuntoConfigurado } from '../domain/index.ts';

// D2: m1_config_permisos (001_initial.sql); M1 consulta configuración, no estado operativo de M2.
interface FilaEvento {
  id: string;
  nombre: string;
  nombre_corto: string;
  recinto: string;
  boleteria: string;
  apertura: Date;
  cierre: Date;
  admisiones_estimadas: number;
  gratuito: boolean;
  estado: Evento['estado'];
  version_permisos: number;
  ultimo_cambio_recibido: Date | null;
  version_politicas: number;
  reingreso_permitido: boolean;
  reingreso_tras_min: number;
  reingreso_suspendido: boolean;
}

interface FilaPunto {
  id: string;
  nombre: string;
  zona: string | null;
  zonas: string[] | null;
}

interface FilaCambio {
  operacion: CambioPermiso['tipo'];
  version: number;
  referencia: string;
  zona: string | null;
  recibido_en: Date;
}

interface FilaBoleta {
  version: number;
  referencia: string;
  zona: string;
}

function segundosDelDia(instante: Date): number {
  return instante.getHours() * 3600 + instante.getMinutes() * 60 + instante.getSeconds()
    + instante.getMilliseconds() / 1000;
}

export class EventoConfigRepositorioPg implements EventoConfigRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerEventoActual(): Promise<EventoConfigurado | null> {
    // D2 no tiene indicador "actual": primero el abierto, luego el preparado de ID más alto.
    const { rows } = await this.pool.query<FilaEvento>(`
      SELECT e.id, e.nombre, e.nombre_corto, r.nombre AS recinto, e.boleteria,
             e.apertura, e.cierre, e.admisiones_estimadas, e.gratuito, e.estado,
             e.version_permisos, e.ultimo_cambio_recibido,
             p.version AS version_politicas, p.reingreso_permitido,
             p.reingreso_tras_min, p.reingreso_suspendido
      FROM m1_config_permisos.eventos e
      JOIN m1_config_permisos.recintos r ON r.id = e.recinto_id
      JOIN m1_config_permisos.politicas p ON p.evento_id = e.id
      WHERE e.estado IN ('abierto', 'preparacion')
      ORDER BY CASE WHEN e.estado = 'abierto' THEN 0 ELSE 1 END, e.id DESC
      LIMIT 1
    `);
    const fila = rows[0];
    if (!fila) return null;
    return {
      id: fila.id,
      nombre: fila.nombre,
      nombreCorto: fila.nombre_corto,
      recinto: fila.recinto,
      boleteria: fila.boleteria,
      aperturaS: segundosDelDia(fila.apertura),
      cierreS: segundosDelDia(fila.cierre),
      aperturaEn: fila.apertura.toISOString(),
      cierreEn: fila.cierre.toISOString(),
      admisionesEstimadas: fila.admisiones_estimadas,
      gratuito: fila.gratuito,
      estado: fila.estado,
      versionPermisos: fila.version_permisos,
      ultimoCambioRecibidoS: fila.ultimo_cambio_recibido
        ? segundosDelDia(fila.ultimo_cambio_recibido) : null,
      politicas: {
        version: fila.version_politicas,
        reingresoPermitido: fila.reingreso_permitido,
        reingresoTrasMin: fila.reingreso_tras_min,
        reingresoSuspendido: fila.reingreso_suspendido,
      },
    };
  }

  async obtenerVersionPermisosVigente(eventoId: string): Promise<number> {
    const { rows } = await this.pool.query<{ version_permisos: number }>(
      'SELECT version_permisos FROM m1_config_permisos.eventos WHERE id = $1', [eventoId],
    );
    if (!rows[0]) throw new Error(`El evento ${eventoId} ya no existe`);
    return rows[0].version_permisos;
  }
}

export class PuntoConfigRepositorioPg implements PuntoConfigRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listarPuntosConfig(eventoId: string): Promise<PuntoConfigurado[]> {
    const { rows } = await this.pool.query<FilaPunto>(`
      SELECT p.id, p.nombre, z.nombre AS zona,
             array_agg(DISTINCT permitida.nombre ORDER BY permitida.nombre)
               FILTER (WHERE permitida.nombre IS NOT NULL) AS zonas
      FROM m1_config_permisos.puntos p
      LEFT JOIN m1_config_permisos.zonas z
        ON z.evento_id = p.evento_id AND z.id = p.zona_id
      LEFT JOIN m1_config_permisos.punto_zonas pz
        ON pz.evento_id = p.evento_id AND pz.punto_id = p.id
      LEFT JOIN m1_config_permisos.zonas permitida
        ON permitida.evento_id = pz.evento_id AND permitida.id = pz.zona_id
      WHERE p.evento_id = $1
      GROUP BY p.id, p.nombre, z.nombre
      ORDER BY p.id
    `, [eventoId]);
    return rows.map(fila => {
      if (!fila.zona || !fila.zonas?.length) {
        throw new Error(`Falta configuración de zonas del punto ${fila.id}`);
      }
      return { id: fila.id, nombre: fila.nombre, zona: fila.zona, zonas: fila.zonas };
    });
  }
}

export class PermisosRepositorioPg implements PermisosRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerCambiosDesde(
    eventoId: string,
    desdeVersion: number,
    hastaVersion: number,
  ): Promise<{ hastaVersion: number; cambios: CambioPermiso[] }> {
    if (desdeVersion === 0) {
      // La boleta guarda el estado vigente; el historial solo sirve para distribuir incrementos.
      const { rows } = await this.pool.query<FilaBoleta>(`
        SELECT b.version, b.referencia, z.nombre AS zona
        FROM m1_config_permisos.boletas b
        JOIN m1_config_permisos.zonas z ON z.evento_id = b.evento_id AND z.id = b.zona_id
        WHERE b.evento_id = $1 AND b.version <= $2 AND NOT b.anulada AND NOT b.excluida
        ORDER BY b.version, b.referencia
      `, [eventoId, hastaVersion]);
      return {
        hastaVersion,
        cambios: rows.map(fila => ({
          tipo: 'alta', version: fila.version, referencia: fila.referencia, zona: fila.zona,
        })),
      };
    }
    const { rows } = await this.pool.query<FilaCambio>(`
      SELECT c.operacion, c.version, c.referencia, z.nombre AS zona, c.recibido_en
      FROM m1_config_permisos.cambios_permisos c
      LEFT JOIN m1_config_permisos.zonas z ON z.evento_id = c.evento_id AND z.id = c.zona_id
      WHERE c.evento_id = $1 AND c.version > $2 AND c.version <= $3
      ORDER BY c.version
    `, [eventoId, desdeVersion, hastaVersion]);
    const cambios: CambioPermiso[] = rows.map(fila => {
      if (fila.operacion === 'alta' || fila.operacion === 'cambio-zona') {
        if (fila.zona === null) throw new Error(`Falta zona del permiso ${fila.referencia}`);
        return { tipo: fila.operacion, version: fila.version, referencia: fila.referencia, zona: fila.zona };
      }
      if (fila.operacion === 'anulacion') {
        return { tipo: 'anulacion', version: fila.version, referencia: fila.referencia, anuladaEn: fila.recibido_en.toISOString() };
      }
      throw new Error(`Tipo de cambio desconocido: ${fila.operacion}`);
    });
    return { hastaVersion, cambios };
  }
}
