import { z } from 'zod';
import {
  Contador,
  Decision,
  EstadoAccion,
  EstadoConciliacion,
  EstadoCoordinador,
  EstadoEvento,
  EstadoIncidente,
  EstadoPunto,
  EventoId,
  Evidencia,
  Importe,
  Instante,
  Motivo,
  Prioridad,
  Proposito,
  PuntoId,
  Rol,
  SegundosDelDia,
  TipoAccion,
  TipoIncidente,
  Version,
  Zona,
} from './common.ts';
import { Politicas } from './p2.ts';

/**
 * O2. Operación, panel C5 → C4 (`/api/*`, cookie de sesión). Las formas siguen el `store` del
 * prototipo (prototipo §6) para que `api.js` reemplace a `simulador.js` sin tocar las vistas.
 * Los campos terminados en `S` son segundos desde la medianoche local del día del evento, con el
 * reloj real del servidor (`ahoraS`). El panel nunca decide: C4 propone y una persona aprueba.
 */

const nul = <T extends z.ZodType>(t: T) => t.nullable();

// ---------- evento y estado global: GET /api/eventos/actual/estado ----------

export const Evento = z.object({
  id: EventoId,
  nombre: z.string(),
  nombreCorto: z.string(),
  recinto: z.string(),
  boleteria: z.string(),
  aperturaS: SegundosDelDia,
  cierreS: SegundosDelDia,
  admisionesEstimadas: Contador,
  gratuito: z.boolean(),
  estado: EstadoEvento,
  versionPermisos: Version,
  ultimoCambioRecibidoS: nul(SegundosDelDia),
  politicas: Politicas,
});
export type Evento = z.infer<typeof Evento>;

/** Nodo único en el taller 3 (sin réplica ni repuesto). */
export const Coordinador = z.object({
  id: z.string(),
  topologia: z.string(),
  estado: EstadoCoordinador,
  desdeS: SegundosDelDia,
  /** Último estado recibido por E1; con el enlace caído envejece (SER-05). */
  ultimoReporteS: nul(SegundosDelDia),
  pausas: z.array(z.object({ desdeS: SegundosDelDia, hastaS: nul(SegundosDelDia) })),
});

export const Nube = z.object({
  enLinea: z.boolean(),
  caidaDesdeS: nul(SegundosDelDia),
  /** Pendientes del outbox reportados por C2. */
  buzon: Contador,
  enviados: Contador,
  buzonEdadMaxS: z.number().nonnegative(),
});

export const Integracion = z.object({
  enLinea: z.boolean(),
  /** Referencias con anulación emitida por la boletería y aún no instalada en C2. */
  enTransito: z.array(z.string()),
  pendientesRevision: Contador,
});

export const Conteo = z.object({
  intentos: Contador,
  decisiones: Contador,
  aceptados: Contador,
  admisiones: Contador,
  reingresos: Contador,
  rechazados: Contador,
  desconocidos: Contador,
  zonaIncorrecta: Contador,
  anuladas: Contador,
  concurrentes: Contador,
  usoRegistrado: Contador,
  sinRespuesta: Contador,
  camposCompletos: Contador,
});

export const Metricas = z.object({
  dps: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  solicitudes: Contador,
  enPlazo: Contador,
  visiblesTotal: Contador,
  visiblesEnPlazo: Contador,
  duranteCorte: Contador,
  sincronizaciones: z.array(z.object({ puntoId: PuntoId, pendientes: Contador, duracionS: z.number().nonnegative() })),
});

export const Diferencia = z.object({
  id: z.string().regex(/^DIF-\d{3,}$/),
  tipo: z.enum(['anulacion', 'diario']),
  titulo: z.string(),
  origen: z.string(),
  detalle: z.string(),
  casos: Contador,
  referencia: nul(z.string()),
  intentoId: nul(z.string()),
  opciones: z.array(z.object({ id: z.string(), texto: z.string(), nota: z.string().optional() })),
  estado: z.enum(['abierta', 'resuelta']),
  detectadaEnS: SegundosDelDia,
  resolucion: nul(z.string()),
  resueltaPor: nul(Rol),
  resueltaEnS: nul(SegundosDelDia),
});
export type Diferencia = z.infer<typeof Diferencia>;

export const Conciliacion = z.object({
  estado: EstadoConciliacion,
  preliminarEnS: nul(SegundosDelDia),
  definitivoEnS: nul(SegundosDelDia),
  diferencias: z.array(Diferencia),
  saldoCobrado: z.boolean(),
  /** Condiciones de `condicionesCierre` (prototipo §9). */
  condiciones: z.array(z.object({ id: z.string(), texto: z.string(), ok: z.boolean() })),
});
export type Conciliacion = z.infer<typeof Conciliacion>;

export const ControlPreparacion = z.object({
  id: z.enum(['permisos', 'contingencia', 'reemplazo', 'integridad', 'privacidad', 'adicionales']),
  titulo: z.string(),
  ok: z.boolean(),
  detalle: z.string(),
});

export const Preparacion = z.object({
  confirmada: z.boolean(),
  controles: z.array(ControlPreparacion),
});

export const EstadoActual = z.object({
  ahora: Instante,
  ahoraS: SegundosDelDia,
  evento: Evento,
  coordinador: Coordinador,
  nube: Nube,
  integracion: Integracion,
  conteo: Conteo,
  admisionesPorZona: z.record(Zona, Contador),
  serie: z.array(z.object({ minuto: z.number().int(), decisiones: Contador })).max(40),
  metricas: Metricas,
  conciliacion: Conciliacion,
  preparacion: Preparacion,
});
export type EstadoActual = z.infer<typeof EstadoActual>;

// ---------- intentos: GET /api/intentos?limite=&puntoId= ----------

export const Intento = z.object({
  /** `idOrigen` del lector. */
  id: z.string(),
  ref: z.string(),
  zona: nul(Zona),
  puntoId: PuntoId,
  lector: z.string(),
  t: SegundosDelDia,
  decision: Decision,
  motivo: Motivo,
  proposito: nul(Proposito),
  admision: z.boolean(),
  concurrente: z.boolean(),
  latenciaMs: nul(z.number().nonnegative()),
  evidencia: Evidencia,
  enDiario: z.boolean(),
  manual: z.boolean(),
});
export type Intento = z.infer<typeof Intento>;

export const ListaIntentos = z.array(Intento);

export const ConsultaIntentos = z.object({
  limite: z.coerce.number().int().min(1).max(200).default(50),
  puntoId: PuntoId.optional(),
});

// ---------- puntos: GET /api/puntos, GET /api/puntos/{id} ----------

export const Lector = z.object({
  id: z.string(),
  familia: z.string(),
  procedencia: z.enum(['Cliente', 'Alquiler']),
  credencial: z.string(),
  desdeS: SegundosDelDia,
  hastaS: nul(SegundosDelDia),
});

export const ActividadPunto = z.object({ t: SegundosDelDia, tipo: z.string(), texto: z.string() });

export const PuntoResumen = z.object({
  id: PuntoId,
  nombre: z.string(),
  zona: Zona,
  zonas: z.array(Zona).min(1),
  estado: EstadoPunto,
  ultimaComunicacionS: nul(SegundosDelDia),
  pendientesDiario: Contador,
  diarioTotal: Contador,
  sincronizandoDesdeS: nul(SegundosDelDia),
  decisionesMinuto: Contador,
  /** Decisiones por minuto, últimos 30 min. */
  serie: z.array(Contador).max(30),
  averiadoDesdeS: nul(SegundosDelDia),
  redirigido: z.boolean(),
  recuperacionS: nul(z.number().nonnegative()),
  lectorActual: nul(Lector),
});
export type PuntoResumen = z.infer<typeof PuntoResumen>;

export const PuntoDetalle = PuntoResumen.extend({
  /** Latencias en ms medidas por el lector, últimas 60. */
  latencias: z.array(z.number().nonnegative()).max(60),
  recientes: z.array(Intento).max(12),
  preparacion: z.object({
    lector: z.boolean(),
    credencial: z.boolean(),
    zonas: z.boolean(),
    version: z.boolean(),
    prueba: z.boolean(),
  }),
  lectores: z.array(Lector),
  actividad: z.array(ActividadPunto),
});
export type PuntoDetalle = z.infer<typeof PuntoDetalle>;

export const ListaPuntos = z.array(PuntoResumen);

// ---------- incidentes ----------

export const EntradaBitacora = z.object({
  t: SegundosDelDia,
  /** Clave de rol o `sistema`. */
  autor: z.union([Rol, z.literal('sistema')]),
  tipo: z.enum(['sistema', 'nota', 'accion', 'estado']),
  texto: z.string(),
});

export const Incidente = z.object({
  id: z.string().regex(/^INC-\d{4,}$/),
  tipo: TipoIncidente,
  clasificacion: TipoIncidente,
  prioridad: Prioridad,
  puntoId: nul(PuntoId),
  componente: nul(z.string()),
  zona: nul(Zona),
  titulo: z.string(),
  descripcion: z.string(),
  responsable: Rol,
  estado: EstadoIncidente,
  recibidaEnS: SegundosDelDia,
  actuadaEnS: nul(SegundosDelDia),
  resueltaEnS: nul(SegundosDelDia),
  recuperadaEnS: nul(SegundosDelDia),
  metaRecuperacionS: nul(z.number().nonnegative()),
  relojDesdeS: SegundosDelDia,
  destacado: z.boolean(),
  checklist: z.array(z.object({ texto: z.string(), hecho: z.boolean() })),
  bitacora: z.array(EntradaBitacora),
});
export type Incidente = z.infer<typeof Incidente>;
export const ListaIncidentes = z.array(Incidente);

/** `POST /api/incidentes/{id}/acciones` → 200 `Incidente`. */
export const AccionIncidente = z.discriminatedUnion('accion', [
  z.object({ accion: z.literal('tomar') }),
  z.object({ accion: z.literal('nota'), texto: z.string().min(1).max(2000) }),
  z.object({ accion: z.literal('escalar'), nota: z.string().max(2000).optional() }),
  z.object({ accion: z.literal('descartar'), nota: z.string().max(2000).optional() }),
  z.object({ accion: z.literal('resolver'), nota: z.string().max(2000).optional() }),
  z.object({
    accion: z.literal('actualizar'),
    clasificacion: TipoIncidente.optional(),
    prioridad: Prioridad.optional(),
    responsable: Rol.optional(),
  }),
  z.object({ accion: z.literal('destacar'), valor: z.boolean().optional() }),
  z.object({ accion: z.literal('checklist'), indice: z.number().int().nonnegative() }),
]);
export type AccionIncidente = z.infer<typeof AccionIncidente>;

// ---------- acciones pendientes: GET /api/acciones, POST /api/acciones/{id} ----------

export const Accion = z.object({
  id: z.string().regex(/^ACC-\d+$/),
  tipo: TipoAccion,
  titulo: z.string(),
  detalle: z.string(),
  si: z.string(),
  no: nul(z.string()),
  rol: Rol,
  incidenteId: nul(z.string()),
  enlace: nul(z.string()),
  decisiva: z.boolean(),
  estado: EstadoAccion,
  creadaEnS: SegundosDelDia,
  decididaEnS: nul(SegundosDelDia),
  autor: nul(Rol),
  nota: nul(z.string()),
});
export type Accion = z.infer<typeof Accion>;
export const ListaAcciones = z.array(Accion);

export const DecisionAccion = z.object({ aprobar: z.boolean(), nota: z.string().max(2000).optional() });
export type DecisionAccion = z.infer<typeof DecisionAccion>;

// ---------- actividad y boletas ----------

export const EntradaActividad = z.object({
  t: SegundosDelDia,
  texto: z.string(),
  tono: z.enum(['ok', 'warn', 'no', 'info', 'mute', 'violet', 'gold']),
});
export const ListaActividad = z.array(EntradaActividad).max(40);

/** `GET /api/boletas/{ref}`: búsqueda por referencia técnica (no identifica a nadie). */
export const Boleta = z.object({
  ref: z.string(),
  zona: Zona,
  consumidaEnS: nul(SegundosDelDia),
  consumidaEnPunto: nul(PuntoId),
  ultimoUsoS: nul(SegundosDelDia),
  anulacion: nul(z.object({ emitidaEnS: SegundosDelDia, recibidaEnS: nul(SegundosDelDia) })),
  excluida: z.boolean(),
});
export type Boleta = z.infer<typeof Boleta>;

// ---------- preparación y cierre ----------

/** `POST /api/preparacion/controles/{id}` → 200 `Preparacion`. */
export const CambioControl = z.object({ ok: z.boolean() });
/** `POST /api/cierre/diferencias/{id}` → 200 `Conciliacion`. */
export const ResolucionDiferencia = z.object({ opcion: z.string().min(1) });
/**
 * `POST /api/cierre/preliminar` y `POST /api/cierre/definitivo` (cuerpo vacío) → 200 `Conciliacion`;
 * 409 `CONFLICTO_ESTADO` con `detalles: { pendientes: string[] }` si faltan condiciones.
 * `POST /api/cierre/cobro` → 200 `Conciliacion` con `saldoCobrado: true`.
 */
export const SolicitudCierre = z.object({ nota: z.string().max(2000).optional() }).strict();

export const Liquidacion = z.object({
  moneda: z.literal('USD'),
  admisiones: Contador,
  excluidas: Contador,
  facturables: Contador,
  importe: Importe,
  anticipo: Importe,
  saldo: Importe,
  costos: Importe,
  contribucion: Importe,
  margen: z.string().regex(/^-?\d+(\.\d{1,6})?$/),
});
export type Liquidacion = z.infer<typeof Liquidacion>;

// ---------- SSE: GET /api/stream ----------

/**
 * `text/event-stream`. `event:` es el `tipo`; `data:` es el JSON del campo `datos`; `id:` es
 * una secuencia monótona. Al (re)conectar C4 envía primero `estado` completo: la reconexión
 * recupera el estado (T2 §5.4, O2). Latido `: ping` cada 15 s.
 */
export const EventoStream = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('estado'), datos: EstadoActual }),
  z.object({ tipo: z.literal('punto'), datos: PuntoResumen }),
  z.object({ tipo: z.literal('intento'), datos: Intento }),
  z.object({ tipo: z.literal('incidente'), datos: Incidente }),
  z.object({ tipo: z.literal('accion'), datos: Accion }),
  z.object({ tipo: z.literal('aviso'), datos: z.object({ texto: z.string(), tono: EntradaActividad.shape.tono }) }),
  z.object({ tipo: z.literal('diferencia'), datos: Diferencia }),
]);
export type EventoStream = z.infer<typeof EventoStream>;
export const TIPOS_EVENTO_STREAM = ['estado', 'punto', 'intento', 'incidente', 'accion', 'aviso', 'diferencia'] as const;
