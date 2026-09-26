import type { Pool } from 'pg';
import { Intento, type Accion, type Boleta, type EntradaActividad, type EstadoCoordinador, type EstadoPunto } from '@nexo/shared/contracts';
import type {
  AccionesRepositorio, ActividadRepositorio, BoletasRepositorio, ConsultaIntentosOpciones, ContadoresDecisiones,
  EstadoCoordinadorLeido, EstadoOperativoRepositorio, EstadoPuntoLeido, IntentosRepositorio, ResultadoDecisionAccion,
} from '../application/o2/puertos.ts';
import type { PreparacionLeida, PreparacionRepositorio } from '../application/o2/puertos-preparacion.ts';
import type { EventoConfigRepositorio } from '../modules/configuration-permissions/application/index.ts';
import type { EventoConfigurado } from '../modules/configuration-permissions/domain/index.ts';

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

/** Preparación (M1) leída directamente: fuera del alcance de M1 propio. La conciliación real
 * (M3) llega por `ConciliacionPuerto` (`ServicioConciliacion`), no por este repositorio. */
export class PreparacionRepositorioPg implements PreparacionRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
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

  async alternarControl(eventoId: string, id: string, ok: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE m1_config_permisos.controles_preparacion
         SET confirmado = $3, confirmado_en = CASE WHEN $3 THEN now() ELSE NULL END
       WHERE evento_id = $1 AND id = $2`,
      [eventoId, id, ok],
    );
  }

  async confirmarApertura(eventoId: string): Promise<void> {
    await this.pool.query(
      'UPDATE m1_config_permisos.eventos SET apertura_confirmada_en = now() WHERE id = $1 AND apertura_confirmada_en IS NULL',
      [eventoId],
    );
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

interface FilaAccion {
  id: string;
  tipo: Accion['tipo'];
  titulo: string;
  detalle: string;
  si: string;
  no: string | null;
  rol: Accion['rol'];
  incidente_id: string | null;
  enlace: string | null;
  decisiva: boolean;
  estado: Accion['estado'];
  creada_en: Date;
  decidida_en: Date | null;
  autor_rol: Accion['rol'] | null;
  nota: string | null;
}

const CONSULTA_ACCIONES = `
  SELECT a.id, a.tipo, a.titulo, a.detalle, a.si, a.no, a.rol, a.incidente_id, a.enlace, a.decisiva,
         a.estado, a.creada_en, a.decidida_en, op.rol AS autor_rol, a.nota
  FROM m2_evidencia.acciones a
  LEFT JOIN auth.operadores op ON op.id = a.operador_id`;

function leerAccion(fila: FilaAccion): Accion {
  return {
    id: fila.id,
    tipo: fila.tipo,
    titulo: fila.titulo,
    detalle: fila.detalle,
    si: fila.si,
    no: fila.no,
    rol: fila.rol,
    incidenteId: fila.incidente_id,
    enlace: fila.enlace,
    decisiva: fila.decisiva,
    estado: fila.estado,
    creadaEnS: segundosDelDia(fila.creada_en),
    decididaEnS: fila.decidida_en ? segundosDelDia(fila.decidida_en) : null,
    autor: fila.autor_rol,
    nota: fila.nota,
  };
}

/** Lectura/escritura de acciones pendientes (`m2_evidencia.acciones`) para `/api/acciones`. */
export class AccionesRepositorioPg implements AccionesRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listar(eventoId: string): Promise<Accion[]> {
    const { rows } = await this.pool.query<FilaAccion>(
      `${CONSULTA_ACCIONES} WHERE a.evento_id = $1 ORDER BY a.creada_en DESC`,
      [eventoId],
    );
    return rows.map(leerAccion);
  }

  async decidir(
    eventoId: string, id: string, aprobar: boolean, nota: string | undefined, usuario: string,
  ): Promise<ResultadoDecisionAccion> {
    const { rows: existente } = await this.pool.query<{ estado: Accion['estado'] }>(
      'SELECT estado FROM m2_evidencia.acciones WHERE evento_id = $1 AND id = $2', [eventoId, id],
    );
    const actual = existente[0];
    if (!actual) return { tipo: 'no-encontrada' };
    if (actual.estado !== 'pendiente') return { tipo: 'ya-decidida', estado: actual.estado };

    const nuevoEstado = aprobar ? 'aprobada' : 'rechazada';
    const { rowCount } = await this.pool.query(
      `UPDATE m2_evidencia.acciones
       SET estado = $1, decidida_en = now(), operador_id = (SELECT id FROM auth.operadores WHERE usuario = $2), nota = $3
       WHERE evento_id = $4 AND id = $5 AND estado = 'pendiente'`,
      [nuevoEstado, usuario, nota ?? null, eventoId, id],
    );
    if (rowCount === 0) return { tipo: 'ya-decidida', estado: actual.estado };

    const { rows } = await this.pool.query<FilaAccion>(`${CONSULTA_ACCIONES} WHERE a.evento_id = $1 AND a.id = $2`, [eventoId, id]);
    const accion = rows[0];
    if (!accion) return { tipo: 'no-encontrada' };
    return { tipo: 'ok', accion: leerAccion(accion) };
  }
}

interface FilaBoleta {
  referencia: string;
  zona: string;
  excluida: boolean;
  anulacion_emitida_en: Date | null;
  anulacion_recibida_en: Date | null;
  ultimo_uso: Date | null;
  ultimo_punto: string | null;
}

/** Lectura de boletas (`m1_config_permisos.boletas` + última decisión admitida) para `GET /api/boletas/{ref}`. */
export class BoletasRepositorioPg implements BoletasRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtener(eventoId: string, referencia: string): Promise<Boleta | null> {
    const { rows } = await this.pool.query<FilaBoleta>(
      `SELECT b.referencia, z.nombre AS zona, b.excluida, b.anulacion_emitida_en, b.anulacion_recibida_en,
              d.instante_decision AS ultimo_uso, d.punto_id AS ultimo_punto
       FROM m1_config_permisos.boletas b
       JOIN m1_config_permisos.zonas z ON z.evento_id = b.evento_id AND z.id = b.zona_id
       LEFT JOIN LATERAL (
         SELECT instante_decision, punto_id FROM m2_evidencia.decisiones d
         WHERE d.evento_id = b.evento_id AND d.referencia = b.referencia AND d.admision
         ORDER BY d.instante_decision DESC LIMIT 1
       ) d ON true
       WHERE b.evento_id = $1 AND b.referencia = $2`,
      [eventoId, referencia],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      ref: fila.referencia,
      zona: fila.zona,
      consumidaEnS: fila.ultimo_uso ? segundosDelDia(fila.ultimo_uso) : null,
      consumidaEnPunto: fila.ultimo_punto,
      ultimoUsoS: fila.ultimo_uso ? segundosDelDia(fila.ultimo_uso) : null,
      anulacion: fila.anulacion_emitida_en
        ? { emitidaEnS: segundosDelDia(fila.anulacion_emitida_en), recibidaEnS: fila.anulacion_recibida_en ? segundosDelDia(fila.anulacion_recibida_en) : null }
        : null,
      excluida: fila.excluida,
    };
  }
}

interface FilaBitacora {
  creada_en: Date;
  tipo: string;
  texto: string;
  prioridad: 'critica' | 'alta' | 'media' | 'baja' | null;
}

/** Deriva `tono` de la prioridad del incidente enlazado (si lo hay) o del tipo de entrada. */
function tonoBitacora(fila: FilaBitacora): EntradaActividad['tono'] {
  if (fila.prioridad === 'critica' || fila.prioridad === 'alta') return 'no';
  if (fila.prioridad === 'media') return 'warn';
  if (fila.tipo === 'accion') return 'ok';
  return 'info';
}

/** Lectura de actividad reciente (`m2_evidencia.bitacora`) para `GET /api/actividad`: no inventa narrativa. */
export class ActividadRepositorioPg implements ActividadRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async listar(eventoId: string): Promise<EntradaActividad[]> {
    const { rows } = await this.pool.query<FilaBitacora>(
      `SELECT b.creada_en, b.tipo, b.texto, i.prioridad
       FROM m2_evidencia.bitacora b
       LEFT JOIN m2_evidencia.incidentes i ON i.id = b.incidente_id
       WHERE b.evento_id = $1
       ORDER BY b.creada_en DESC
       LIMIT 40`,
      [eventoId],
    );
    return rows.map(fila => ({ t: segundosDelDia(fila.creada_en), texto: fila.texto, tono: tonoBitacora(fila) }));
  }
}

interface FilaEventoActualO2 {
  id: string;
  nombre: string;
  nombre_corto: string;
  recinto: string;
  boleteria: string;
  apertura: Date;
  cierre: Date;
  admisiones_estimadas: number;
  gratuito: boolean;
  estado: EventoConfigurado['estado'];
  version_permisos: number;
  ultimo_cambio_recibido: Date | null;
  version_politicas: number;
  reingreso_permitido: boolean;
  reingreso_tras_min: number;
  reingreso_suspendido: boolean;
}

/**
 * Resuelve el evento "actual" para O2 (`GET /api/eventos/actual/estado` y el SSE `estado`) con un
 * criterio más amplio que `configuration-permissions.EventoConfigRepositorioPg`: incluye `cerrado`.
 * M1 no considera "actual" un evento cerrado (P2/importación de boletería ya no aplican), pero O2
 * debe seguir mostrándolo mientras dure el cierre — M3 exige `estado = 'cerrado'` para entregar el
 * preliminar (ver `reconciliation/infrastructure`), así que excluirlo aquí dejaría sin datos a
 * `#/cierre` justo cuando existen. Se duplica (no se decora) la consulta de M1 para no tocar su
 * módulo ni ampliar el alcance de P2/importación, que sí deben ignorar un evento ya cerrado.
 */
export class EventoActualO2RepositorioPg implements EventoConfigRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async obtenerVersionPermisosVigente(eventoId: string): Promise<number> {
    const { rows } = await this.pool.query<{ version_permisos: number }>(
      'SELECT version_permisos FROM m1_config_permisos.eventos WHERE id = $1', [eventoId],
    );
    return rows[0]?.version_permisos ?? 0;
  }

  async obtenerEventoActual(): Promise<EventoConfigurado | null> {
    const { rows } = await this.pool.query<FilaEventoActualO2>(`
      SELECT e.id, e.nombre, e.nombre_corto, r.nombre AS recinto, e.boleteria,
             e.apertura, e.cierre, e.admisiones_estimadas, e.gratuito, e.estado,
             e.version_permisos, e.ultimo_cambio_recibido,
             p.version AS version_politicas, p.reingreso_permitido,
             p.reingreso_tras_min, p.reingreso_suspendido
      FROM m1_config_permisos.eventos e
      JOIN m1_config_permisos.recintos r ON r.id = e.recinto_id
      JOIN m1_config_permisos.politicas p ON p.evento_id = e.id
      WHERE e.estado IN ('abierto', 'cerrado', 'preparacion')
      ORDER BY CASE e.estado WHEN 'abierto' THEN 0 WHEN 'cerrado' THEN 1 ELSE 2 END, e.id DESC
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
}
