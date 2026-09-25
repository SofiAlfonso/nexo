import type { Pool } from 'pg';
import { Intento, type EstadoCoordinador, type EstadoPunto } from '@nexo/shared/contracts';
import type {
  ConsultaIntentosOpciones, ContadoresDecisiones, EstadoCoordinadorLeido, EstadoOperativoRepositorio,
  EstadoPuntoLeido, IntentosRepositorio,
} from '../application/o2/puertos.ts';
import type { ConciliacionLeida, PreparacionConciliacionRepositorio, PreparacionLeida } from '../application/o2/puertos-preparacion.ts';

/** Segundos desde la medianoche local; misma convención usada por `servicio-o2.ts` y M2. */
function segundosDelDia(instante: Date): number {
  return instante.getHours() * 3600 + instante.getMinutes() * 60 + instante.getSeconds();
}

interface FilaPuntoEstado {
  id: string;
  nombre: string;
  zona: string | null;
  zonas: string[] | null;
  estado: EstadoPunto;
  ultima_comunicacion: Date | null;
  pendientes_diario: number | null;
  diario_total: number | null;
}

/**
 * Lectura de solo consulta del estado operativo (M2) y configuración de puntos (M1) para la
 * composición O2. No escribe: M1/M2 son dueños de sus escrituras vía sus propios repositorios.
 */
export class EstadoOperativoRepositorioPg implements EstadoOperativoRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  private async consultarPuntos(eventoId: string, puntoId?: string): Promise<FilaPuntoEstado[]> {
    const { rows } = await this.pool.query<FilaPuntoEstado>(
      `SELECT p.id, p.nombre, z.nombre AS zona,
              array_agg(DISTINCT permitida.nombre ORDER BY permitida.nombre)
                FILTER (WHERE permitida.nombre IS NOT NULL) AS zonas,
              COALESCE(pe.estado, p.estado) AS estado, pe.ultima_comunicacion,
              pe.pendientes_diario, pe.diario_total
       FROM m1_config_permisos.puntos p
       LEFT JOIN m1_config_permisos.zonas z ON z.evento_id = p.evento_id AND z.id = p.zona_id
       LEFT JOIN m1_config_permisos.punto_zonas pz ON pz.evento_id = p.evento_id AND pz.punto_id = p.id
       LEFT JOIN m1_config_permisos.zonas permitida ON permitida.evento_id = pz.evento_id AND permitida.id = pz.zona_id
       LEFT JOIN m2_evidencia.puntos_estado pe ON pe.evento_id = p.evento_id AND pe.punto_id = p.id
       WHERE p.evento_id = $1 ${puntoId ? 'AND p.id = $2' : ''}
       GROUP BY p.id, p.nombre, z.nombre, pe.estado, p.estado, pe.ultima_comunicacion,
                pe.pendientes_diario, pe.diario_total
       ORDER BY p.id`,
      puntoId ? [eventoId, puntoId] : [eventoId],
    );
    return rows;
  }

  private mapear(fila: FilaPuntoEstado): EstadoPuntoLeido {
    return {
      id: fila.id,
      nombre: fila.nombre,
      zona: fila.zona ?? '',
      zonas: fila.zonas ?? [],
      estado: fila.estado,
      ultimaComunicacion: fila.ultima_comunicacion,
      pendientesDiario: fila.pendientes_diario ?? 0,
      diarioTotal: fila.diario_total ?? 0,
    };
  }

  async listarPuntos(eventoId: string): Promise<EstadoPuntoLeido[]> {
    const filas = await this.consultarPuntos(eventoId);
    return filas.map(fila => this.mapear(fila));
  }

  async obtenerPunto(eventoId: string, puntoId: string): Promise<EstadoPuntoLeido | null> {
    const filas = await this.consultarPuntos(eventoId, puntoId);
    return filas[0] ? this.mapear(filas[0]) : null;
  }

  async obtenerEstadoCoordinador(eventoId: string): Promise<EstadoCoordinadorLeido | null> {
    const { rows } = await this.pool.query<{
      coordinador_id: string | null; coordinador_estado: EstadoCoordinador; coordinador_desde: Date | null;
      enlace_en_linea: boolean; enlace_caida_desde: Date | null; outbox_pendientes: number; outbox_edad_max_s: number;
    }>(
      `SELECT coordinador_id, coordinador_estado, coordinador_desde, enlace_en_linea,
              enlace_caida_desde, outbox_pendientes, outbox_edad_max_s
       FROM m2_evidencia.eventos_estado WHERE evento_id = $1`,
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      coordinadorId: fila.coordinador_id,
      estado: fila.coordinador_estado,
      desde: fila.coordinador_desde,
      enlaceEnLinea: fila.enlace_en_linea,
      enlaceCaidaDesde: fila.enlace_caida_desde,
      outboxPendientes: fila.outbox_pendientes,
      outboxEdadMaxS: fila.outbox_edad_max_s,
    };
  }

  async contarDecisiones(eventoId: string): Promise<ContadoresDecisiones> {
    const [agregados, porZona, serie] = await Promise.all([
      this.pool.query<{
        intentos: string; aceptados: string; admisiones: string; reingresos: string; rechazados: string;
        desconocidos: string; zona_incorrecta: string; anuladas: string; concurrentes: string;
        uso_registrado: string; sin_respuesta: string;
      }>(
        `SELECT count(*) AS intentos,
                count(*) FILTER (WHERE decision = 'aceptado') AS aceptados,
                count(*) FILTER (WHERE admision) AS admisiones,
                count(*) FILTER (WHERE proposito = 'reingreso' AND decision = 'aceptado') AS reingresos,
                count(*) FILTER (WHERE decision = 'rechazado') AS rechazados,
                count(*) FILTER (WHERE motivo = 'CODIGO_DESCONOCIDO') AS desconocidos,
                count(*) FILTER (WHERE motivo = 'ZONA_NO_AUTORIZADA') AS zona_incorrecta,
                count(*) FILTER (WHERE motivo = 'BOLETA_ANULADA') AS anuladas,
                count(*) FILTER (WHERE concurrente) AS concurrentes,
                count(*) FILTER (WHERE motivo = 'USO_YA_REGISTRADO') AS uso_registrado,
                count(*) FILTER (WHERE decision = 'sin-respuesta') AS sin_respuesta
         FROM m2_evidencia.decisiones WHERE evento_id = $1`,
        [eventoId],
      ),
      this.pool.query<{ zona: string; admisiones: string }>(
        `SELECT z.nombre AS zona, count(*) AS admisiones
         FROM m2_evidencia.decisiones d
         JOIN m1_config_permisos.zonas z ON z.evento_id = d.evento_id AND z.id = d.zona_id
         WHERE d.evento_id = $1 AND d.admision
         GROUP BY z.nombre`,
        [eventoId],
      ),
      this.pool.query<{ minuto: Date; decisiones: string }>(
        `SELECT date_trunc('minute', instante_decision) AS minuto, count(*) AS decisiones
         FROM m2_evidencia.decisiones
         WHERE evento_id = $1 AND instante_decision > now() - interval '40 minutes'
         GROUP BY minuto ORDER BY minuto`,
        [eventoId],
      ),
    ]);
    const fila = agregados.rows[0];
    const admisionesPorZona: Record<string, number> = {};
    for (const zona of porZona.rows) admisionesPorZona[zona.zona] = Number(zona.admisiones);
    return {
      intentos: Number(fila?.intentos ?? 0),
      aceptados: Number(fila?.aceptados ?? 0),
      admisiones: Number(fila?.admisiones ?? 0),
      reingresos: Number(fila?.reingresos ?? 0),
      rechazados: Number(fila?.rechazados ?? 0),
      desconocidos: Number(fila?.desconocidos ?? 0),
      zonaIncorrecta: Number(fila?.zona_incorrecta ?? 0),
      anuladas: Number(fila?.anuladas ?? 0),
      concurrentes: Number(fila?.concurrentes ?? 0),
      usoRegistrado: Number(fila?.uso_registrado ?? 0),
      sinRespuesta: Number(fila?.sin_respuesta ?? 0),
      admisionesPorZona,
      serieUltimaHora: serie.rows.map(row => ({
        minuto: Math.floor(row.minuto.getTime() / 60_000),
        decisiones: Number(row.decisiones),
      })),
    };
  }
}

/** Conciliación (M3) y preparación (M1) leídas directamente: fuera del alcance de M1/M2 propios. */
export class PreparacionConciliacionRepositorioPg implements PreparacionConciliacionRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerConciliacion(eventoId: string): Promise<ConciliacionLeida> {
    const { rows } = await this.pool.query<{
      estado: ConciliacionLeida['estado']; preliminar_en: Date | null; definitivo_en: Date | null;
    }>('SELECT estado, preliminar_en, definitivo_en FROM m3_conciliacion.conciliaciones WHERE evento_id = $1', [eventoId]);
    const fila = rows[0];
    return {
      estado: fila?.estado ?? 'sin-iniciar',
      preliminarEn: fila?.preliminar_en ?? null,
      definitivoEn: fila?.definitivo_en ?? null,
    };
  }

  async obtenerPreparacion(eventoId: string): Promise<PreparacionLeida> {
    const [evento, controles] = await Promise.all([
      this.pool.query<{ apertura_confirmada_en: Date | null }>(
        'SELECT apertura_confirmada_en FROM m1_config_permisos.eventos WHERE id = $1', [eventoId],
      ),
      this.pool.query<{ id: string; titulo: string; confirmado: boolean }>(
        'SELECT id, titulo, confirmado FROM m1_config_permisos.controles_preparacion WHERE evento_id = $1 ORDER BY id',
        [eventoId],
      ),
    ]);
    return {
      confirmada: evento.rows[0]?.apertura_confirmada_en !== null && evento.rows[0]?.apertura_confirmada_en !== undefined,
      controles: controles.rows.map(fila => ({ id: fila.id, titulo: fila.titulo, ok: fila.confirmado })),
    };
  }
}

interface FilaDecision {
  id_origen: string;
  referencia: string | null;
  zona: string | null;
  punto_id: string | null;
  lector_id: string | null;
  instante_decision: Date;
  decision: string;
  motivo: string;
  proposito: string | null;
  admision: boolean;
  concurrente: boolean;
  latencia_ms: string | null;
  via: string | null;
  version_permisos: number | null;
  version_politicas: number | null;
  antiguedad_permisos_s: number | null;
}

const CONSULTA_DECISIONES = `
  SELECT d.id_origen, d.referencia, z.nombre AS zona, d.punto_id, d.lector_id, d.instante_decision,
         d.decision, d.motivo, d.proposito, d.admision, d.concurrente, d.latencia_ms,
         d.via, d.version_permisos, d.version_politicas, d.antiguedad_permisos_s
  FROM m2_evidencia.decisiones d
  LEFT JOIN m1_config_permisos.zonas z ON z.evento_id = d.evento_id AND z.id = d.zona_id`;

function leerIntento(fila: FilaDecision): Intento {
  // M1 (ola 1) no proyecta aún el diario del lector ni las acciones manuales del panel sobre un
  // intento puntual: `enDiario`/`manual` quedan en `false` hasta que M2/O2 los necesiten.
  return Intento.parse({
    id: fila.id_origen,
    ref: fila.referencia ?? '',
    zona: fila.zona,
    puntoId: fila.punto_id,
    lector: fila.lector_id ?? '',
    t: segundosDelDia(fila.instante_decision),
    decision: fila.decision,
    motivo: fila.motivo,
    proposito: fila.proposito,
    admision: fila.admision,
    concurrente: fila.concurrente,
    latenciaMs: fila.latencia_ms === null ? null : Number(fila.latencia_ms),
    evidencia: {
      via: fila.via && fila.via.length > 0 ? fila.via : 'desconocido',
      versionPermisos: fila.version_permisos ?? 0,
      versionPoliticas: fila.version_politicas ?? 0,
      antiguedadPermisosS: fila.antiguedad_permisos_s ?? 0,
    },
    enDiario: false,
    manual: false,
  });
}

/** Lectura de intentos (`m2_evidencia.decisiones`) para `GET /api/intentos` y el SSE `intento`. */
export class IntentosRepositorioPg implements IntentosRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listar(eventoId: string, opciones: ConsultaIntentosOpciones): Promise<Intento[]> {
    const condicionPunto = opciones.puntoId ? 'AND d.punto_id = $2' : '';
    const parametros = opciones.puntoId ? [eventoId, opciones.puntoId, opciones.limite] : [eventoId, opciones.limite];
    const { rows } = await this.pool.query<FilaDecision>(
      `${CONSULTA_DECISIONES} WHERE d.evento_id = $1 ${condicionPunto}
       ORDER BY d.instante_decision DESC LIMIT $${parametros.length}`,
      parametros,
    );
    return rows.map(leerIntento);
  }

  async listarPorIdOrigen(eventoId: string, idOrigenes: string[]): Promise<Intento[]> {
    if (idOrigenes.length === 0) return [];
    const { rows } = await this.pool.query<FilaDecision>(
      `${CONSULTA_DECISIONES} WHERE d.evento_id = $1 AND d.id_origen = ANY($2::text[])
       ORDER BY d.instante_decision`,
      [eventoId, idOrigenes],
    );
    return rows.map(leerIntento);
  }
}
