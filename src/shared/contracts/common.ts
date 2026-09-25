import { z } from 'zod';

/**
 * Enumerados y tipos base compartidos por todos los contratos.
 * Valores tomados del prototipo (`NEXO_07_Prototipo/js/modelo/dominio.js`):
 * los estados usan exactamente sus valores; motivos, tipos de incidente y
 * roles viajan por su clave (p. ej. `PERMISO_VIGENTE`) y el texto visible
 * está en los mapas `*_TEXTO`.
 */

const claves = <T extends Record<string, unknown>>(o: T) =>
  Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

// ---------- identificadores y valores ----------

export const Instante = z.iso.datetime({ offset: true });
export const IdOrigen = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const IdLote = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);
export const EventoId = z.string().regex(/^EVT-\d{4}-\d{2}$/);
export const PuntoId = z.string().regex(/^P-\d{2,3}$/);
export const LectorId = z.string().min(1).max(64);
export const RecintoId = z.string().regex(/^REC-\d{2}$/);
export const CoordinadorId = z.string().min(1).max(64);
export const Zona = z.string().min(1).max(64);
export const Version = z.number().int().nonnegative();
export const Contador = z.number().int().nonnegative();
/** Segundos desde la medianoche local del día del evento (reloj del panel, como `ahoraS` del prototipo). */
export const SegundosDelDia = z.number().nonnegative();
/** Importe decimal serializado como texto para no perder precisión (PB-18, decimal.js). */
export const Importe = z.string().regex(/^-?\d+(\.\d{1,4})?$/);

// ---------- decisión ----------

export const DECISIONES = ['aceptado', 'rechazado', 'sin-respuesta'] as const;
export const Decision = z.enum(DECISIONES);
export type Decision = z.infer<typeof Decision>;

export const MOTIVO_TEXTO = {
  PERMISO_VIGENTE: 'Permiso vigente para esta puerta y horario',
  REINGRESO_AUTORIZADO: 'Reingreso autorizado por la política del evento',
  ZONA_NO_AUTORIZADA: 'La boleta no autoriza la zona de esta puerta',
  BOLETA_ANULADA: 'Boleta anulada por la boletería',
  FUERA_DE_HORARIO: 'Fuera de la ventana de ingreso',
  USO_YA_REGISTRADO: 'Uso ya registrado; reingreso no permitido todavía',
  USO_CONCURRENTE: 'Otra puerta consumió esta boleta en el mismo instante',
  REINGRESO_SUSPENDIDO: 'Reingresos suspendidos: permisos desactualizados',
  CODIGO_DESCONOCIDO: 'Código desconocido para este evento',
  SIN_COORDINADOR: 'Sin respuesta del coordinador local',
  PUNTO_SUSPENDIDO: 'Punto fuera de servicio',
} as const;
export const Motivo = z.enum(claves(MOTIVO_TEXTO));
export type Motivo = z.infer<typeof Motivo>;

/** Propósito del intento. El lector pide `ingreso`; C2 responde `reingreso` si aplica la política. */
export const Proposito = z.enum(['ingreso', 'reingreso']);
export type Proposito = z.infer<typeof Proposito>;

/** Evidencia de cada decisión (prototipo §7). */
export const Evidencia = z.object({
  via: z.string().min(1), // "Coordinador COORD-A" o "Diario del lector"
  versionPermisos: Version,
  versionPoliticas: Version,
  antiguedadPermisosS: z.number().nonnegative(),
});
export type Evidencia = z.infer<typeof Evidencia>;

// ---------- estados ----------

export const EstadoPunto = z.enum(['en-linea', 'sin-comunicacion', 'averiado', 'en-pausa', 'sin-abrir']);
export type EstadoPunto = z.infer<typeof EstadoPunto>;
export const ESTADO_PUNTO_TEXTO: Record<EstadoPunto, string> = {
  'en-linea': 'En línea',
  'sin-comunicacion': 'Sin comunicación',
  averiado: 'Lector averiado',
  'en-pausa': 'En pausa',
  'sin-abrir': 'Sin abrir',
};

export const EstadoCoordinador = z.enum(['operando', 'sin-autoridad', 'protegiendo']);
export type EstadoCoordinador = z.infer<typeof EstadoCoordinador>;

export const EstadoEvento = z.enum(['preparacion', 'abierto', 'cerrado']);
export type EstadoEvento = z.infer<typeof EstadoEvento>;

export const EstadoLector = z.enum(['operativo', 'averiado']);
export type EstadoLector = z.infer<typeof EstadoLector>;

export const TIPO_INCIDENTE_TEXTO = {
  SIN_COMUNICACION: 'Puerta sin comunicación',
  LECTOR_AVERIADO: 'Lector averiado',
  COORDINADOR: 'Falla del coordinador',
  ENLACE_NUBE: 'Sin enlace con la nube',
  PERMISOS: 'Permisos desactualizados',
  LATENCIA: 'Latencia sobre el umbral',
  FALSA_ALARMA: 'Falsa alarma',
} as const;
export const TipoIncidente = z.enum(claves(TIPO_INCIDENTE_TEXTO));
export type TipoIncidente = z.infer<typeof TipoIncidente>;
export const VERSION_TAXONOMIA = 'v1 · fijada antes del piloto';

export const Prioridad = z.enum(['critica', 'alta', 'media', 'baja']);
export type Prioridad = z.infer<typeof Prioridad>;
export const PRIORIDAD_TEXTO: Record<Prioridad, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

export const EstadoIncidente = z.enum(['nuevo', 'en-curso', 'resuelto', 'descartado']);
export type EstadoIncidente = z.infer<typeof EstadoIncidente>;

export const TipoAccion = z.enum(['redirigir', 'credencial', 'promover', 'reingresos', 'preliminar']);
export type TipoAccion = z.infer<typeof TipoAccion>;
export const EstadoAccion = z.enum(['pendiente', 'aprobada', 'rechazada', 'caducada']);
export type EstadoAccion = z.infer<typeof EstadoAccion>;

export const EstadoConciliacion = z.enum(['sin-iniciar', 'en-curso', 'preliminar', 'conciliado']);
export type EstadoConciliacion = z.infer<typeof EstadoConciliacion>;

// ---------- roles (ADR-006, ADR-009, ADR-016) ----------

export const ROL_TEXTO = {
  SUPERVISOR: 'Supervisor del operador',
  LIDER_TECNICO: 'Líder técnico',
  LOGISTICA: 'Logística de puerta',
  CIERRE: 'Responsable de cierre',
  FINANZAS: 'Líder comercial y financiero',
} as const;
export const Rol = z.enum(claves(ROL_TEXTO));
export type Rol = z.infer<typeof Rol>;

// ---------- errores ----------

export const CodigoError = z.enum([
  'SOLICITUD_INVALIDA', // 400: el cuerpo no cumple el esquema
  'NO_AUTENTICADO', // 401
  'NO_AUTORIZADO', // 403: rol o credencial sin permiso
  'NO_ENCONTRADO', // 404
  'CONFLICTO_IDEMPOTENCIA', // 409: mismo idOrigen o idLote con contenido distinto (PB-04)
  'CONFLICTO_ESTADO', // 409: la operación no aplica al estado actual
  'LOTE_DEMASIADO_GRANDE', // 413
  'NO_DISPONIBLE', // 503
  'ERROR_INTERNO', // 500
]);
export type CodigoError = z.infer<typeof CodigoError>;

export const ErrorRespuesta = z.object({
  error: CodigoError,
  mensaje: z.string(),
  detalles: z.unknown().optional(),
});
export type ErrorRespuesta = z.infer<typeof ErrorRespuesta>;
