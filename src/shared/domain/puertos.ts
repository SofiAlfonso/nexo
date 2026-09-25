import type {
  AlcanceAutenticado,
  Boleta,
  ConsumoIngreso,
  Coordinador,
  EntradaBitacora,
  Evento,
  IntentoDeValidacion,
  IntentoRegistrado,
  PuntoDeValidacion,
  RegistroOutbox,
  ResultadoValidacion,
  VersionesInstaladas,
} from './modelo.ts';

/** Reloj del coordinador (inyectable para pruebas deterministas). */
export interface Reloj {
  ahora(): Date;
}

/** Datos que la unidad carga bajo bloqueo de la boleta (`cargarParaActualizar`). */
export interface DatosIngreso {
  evento: Evento | null;
  punto: PuntoDeValidacion | null;
  boleta: Boleta | null;
  versiones: VersionesInstaladas;
}

/**
 * Unidad de trabajo T1 sobre D1 (taller 2 §6.2). Una por solicitud.
 * Intento, decisión, consumo, bitácora y outbox se confirman juntos o no se confirma nada.
 * Cualquier error de la unidad se traduce en "sin confirmación", nunca en aceptación.
 */
export interface UnidadValidacion {
  /** Intento ya decidido con ese `idOrigen` dentro del evento (idempotencia, RN-03). */
  buscarIntento(eventoId: string, idOrigen: string): Promise<IntentoRegistrado | null>;
  /** Carga el contexto y serializa por boleta (bloqueo por boleta, no por evento). */
  cargarParaActualizar(intento: IntentoDeValidacion): Promise<DatosIngreso>;
  /** Lanza `ErrorIntentoDuplicado` si otro proceso ya registró el mismo `idOrigen`. */
  registrarIntento(intento: IntentoDeValidacion, huella: string, resultado: ResultadoValidacion): Promise<void>;
  /** Lanza `ErrorConsumoDuplicado` si la clave de consumo ya existe (UNIQUE en D1). */
  registrarConsumo(consumo: ConsumoIngreso): Promise<void>;
  agregarBitacora(entrada: EntradaBitacora): Promise<void>;
  agregarOutbox(registro: RegistroOutbox): Promise<void>;
  confirmar(): Promise<void>;
  cancelar(): Promise<void>;
}

export interface FabricaUnidadValidacion {
  abrir(): Promise<UnidadValidacion>;
}

/** Resuelve la identidad técnica del lector (credencial, asignación y revocación; PB-14). */
export interface ResolutorAlcance {
  resolver(lectorId: string): Promise<AlcanceAutenticado>;
}

/** Estado de autoridad del coordinador (nodo único). */
export interface EstadoAutoridad {
  actual(): Coordinador;
}

/** Telemetría de negocio. Sus fallas nunca cambian ni pierden una decisión (PB-21). */
export interface Telemetria {
  decisionConfirmada(resultado: ResultadoValidacion, intento: IntentoDeValidacion, duracionMs: number): void;
  sinConfirmacion(intento: IntentoDeValidacion, causa: string): void;
}

/** Fila pendiente del outbox, lista para armar un lote E1. */
export interface PendienteOutbox extends RegistroOutbox {
  id: number;
  creadoEn: Date;
}

/** Lectura y acuse del outbox para el despachador E1. Solo adición: el acuse no borra filas. */
export interface OutboxPendiente {
  pendientes(limite: number): Promise<PendienteOutbox[]>;
  registrarAcuse(ids: readonly number[], idLote: string, acusadoEn: Date): Promise<void>;
  resumen(ahora: Date): Promise<{ pendientes: number; edadMaxS: number }>;
  /** Agrega registros generados por C2 (latidos, estado) fuera de V1. Idempotente por (evento, tipo, idOrigen). */
  agregar(registros: readonly RegistroOutbox[]): Promise<void>;
}

/** Permisos instalados en D1 (carga inicial desde la semilla o paquetes P2). */
export interface RepositorioPermisos {
  versionInstalada(eventoId: string): Promise<VersionesInstaladas | null>;
}
