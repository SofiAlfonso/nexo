import type {
  Accion, Boleta, EntradaActividad, EstadoAccion, EstadoCoordinador, EstadoPunto, Intento,
} from '@nexo/shared/contracts';

/** Fila leída de `m2_evidencia.puntos_estado`, agregada con `m1_config_permisos.puntos`. */
export interface EstadoPuntoLeido {
  id: string;
  nombre: string;
  zona: string;
  zonas: string[];
  estado: EstadoPunto;
  ultimaComunicacion: Date | null;
  pendientesDiario: number;
  diarioTotal: number;
}

/** Fila leída de `m2_evidencia.eventos_estado`. */
export interface EstadoCoordinadorLeido {
  coordinadorId: string | null;
  estado: EstadoCoordinador;
  desde: Date | null;
  enlaceEnLinea: boolean;
  enlaceCaidaDesde: Date | null;
  outboxPendientes: number;
  outboxEdadMaxS: number;
}

/** Contadores de decisiones agregados desde `m2_evidencia.decisiones` (O2 mínimo, ola 1). */
export interface ContadoresDecisiones {
  intentos: number;
  aceptados: number;
  admisiones: number;
  reingresos: number;
  rechazados: number;
  desconocidos: number;
  zonaIncorrecta: number;
  anuladas: number;
  concurrentes: number;
  usoRegistrado: number;
  sinRespuesta: number;
  admisionesPorZona: Record<string, number>;
  serieUltimaHora: Array<{ minuto: number; decisiones: number }>;
}

/** Puerto de lectura del estado operativo (M2) para la composición O2. Solo lectura. */
export interface EstadoOperativoRepositorio {
  listarPuntos(eventoId: string): Promise<EstadoPuntoLeido[]>;
  obtenerPunto(eventoId: string, puntoId: string): Promise<EstadoPuntoLeido | null>;
  obtenerEstadoCoordinador(eventoId: string): Promise<EstadoCoordinadorLeido | null>;
  contarDecisiones(eventoId: string): Promise<ContadoresDecisiones>;
}

export interface ConsultaIntentosOpciones {
  limite: number;
  puntoId?: string;
}

/** Puerto de lectura de intentos (`m2_evidencia.decisiones`) para `GET /api/intentos` y el SSE `intento`. */
export interface IntentosRepositorio {
  listar(eventoId: string, opciones: ConsultaIntentosOpciones): Promise<Intento[]>;
  /** Usado tras aceptar un lote E1 para difundir por SSE solo las decisiones recién ingeridas. */
  listarPorIdOrigen(eventoId: string, idOrigenes: string[]): Promise<Intento[]>;
}

/** Resultado de intentar decidir una acción pendiente (`POST /api/acciones/{id}`). */
export type ResultadoDecisionAccion =
  | { tipo: 'ok'; accion: Accion }
  | { tipo: 'no-encontrada' }
  | { tipo: 'ya-decidida'; estado: EstadoAccion };

/** Puerto de lectura/escritura de acciones pendientes (`m2_evidencia.acciones`), GET/POST `/api/acciones`. */
export interface AccionesRepositorio {
  listar(eventoId: string): Promise<Accion[]>;
  /** Aplica la decisión solo si la acción está `pendiente`; usa `usuario` para resolver el operador (auth.operadores). */
  decidir(eventoId: string, id: string, aprobar: boolean, nota: string | undefined, usuario: string): Promise<ResultadoDecisionAccion>;
}

/** Puerto de lectura de boletas (`m1_config_permisos.boletas` + última decisión admitida), `GET /api/boletas/{ref}`. */
export interface BoletasRepositorio {
  obtener(eventoId: string, referencia: string): Promise<Boleta | null>;
}

/** Puerto de lectura de actividad (`m2_evidencia.bitacora`), `GET /api/actividad`. */
export interface ActividadRepositorio {
  listar(eventoId: string): Promise<EntradaActividad[]>;
}
