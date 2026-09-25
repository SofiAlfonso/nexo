import type {
  Decision,
  EstadoCoordinador,
  EstadoEvento,
  Evidencia,
  Motivo,
  Proposito,
  RegistroEvidencia,
} from '../contracts/index.ts';

/**
 * Modelo del primer ingreso (taller 2 §2.3, §6.2). Sin dependencias de infraestructura:
 * los instantes son `Date` y la persistencia se accede solo por los puertos de `puertos.ts`.
 */

/** Propósito técnico de la clave de consumo (ADR-003). Sin reingresos (D10). */
export const PROPOSITO_CONSUMO = 'PRIMER_INGRESO' as const;
export type PropositoConsumo = typeof PROPOSITO_CONSUMO;

/** Alcance que sale de la identidad técnica del lector, no de la solicitud (T2 §6.1). */
export interface AlcanceAutenticado {
  lectorId: string;
  /** `null` si el lector no está registrado en el coordinador. */
  eventoId: string | null;
  puntoId: string | null;
  revocado: boolean;
}

export interface VentanaIngreso {
  aperturaEn: Date;
  cierreEn: Date;
}

export interface PoliticasEvento {
  version: number;
  /** D10: siempre `false` en el taller 3. */
  reingresoPermitido: boolean;
  /** PB-11: permite operar en contingencia local sin coordinador operando. */
  contingenciaLocal: boolean;
}

export interface Evento {
  eventoId: string;
  clienteId: string;
  boleteriaId: string;
  estado: EstadoEvento;
  ventana: VentanaIngreso;
  politicas: PoliticasEvento;
}

export interface PuntoDeValidacion {
  eventoId: string;
  puntoId: string;
  zonas: readonly string[];
  habilitado: boolean;
}

export interface Anulacion {
  anuladaEn: Date;
  /** Instante en que C2 recibió el cambio; `null` si aún no llega (anulación en tránsito). */
  recibidaEn: Date | null;
}

export interface ConsumoRegistrado {
  idOrigen: string;
  puntoId: string;
  consumidoEn: Date;
}

/** Boleta: permiso emitido para un evento; no representa al portador (RN-10). */
export interface Boleta {
  eventoId: string;
  referencia: string;
  zona: string;
  anulacion: Anulacion | null;
  /** Consumo de primer ingreso ya confirmado en D1, si existe. */
  consumo: ConsumoRegistrado | null;
}

/** Clave de consumo: cliente, evento, boletería, referencia y `PRIMER_INGRESO`; sin zona, punto ni lector. */
export interface ClaveConsumo {
  clienteId: string;
  eventoId: string;
  boleteriaId: string;
  referencia: string;
  proposito: PropositoConsumo;
}

export interface ConsumoIngreso {
  clave: ClaveConsumo;
  idOrigen: string;
  puntoId: string;
  lectorId: string;
  consumidoEn: Date;
}

/** Intento tal como lo presenta el lector (V1). La huella distingue retransmisión de conflicto (PB-04). */
export interface IntentoDeValidacion {
  idOrigen: string;
  eventoId: string;
  lectorId: string;
  puntoId: string;
  codigo: string;
  proposito: Proposito;
  zonaSolicitada: string | null;
  instanteLector: Date;
}

export interface VersionesInstaladas {
  versionPermisos: number;
  versionPoliticas: number;
  /** Último paquete de permisos recibido; da la antigüedad de la evidencia. */
  permisosRecibidosEn: Date | null;
}

export interface Coordinador {
  coordinadorId: string;
  estado: EstadoCoordinador;
}

/** Modo que pide el lector. `local-contingencia` exige política aprobada (RN-06, PB-11). */
export type ModoOperacion = 'conectado' | 'local-contingencia';

/** Todo lo que el motor necesita; puede carecer de boleta (código desconocido) o de zona. */
export interface ContextoIngreso {
  intento: IntentoDeValidacion;
  evento: Evento;
  punto: PuntoDeValidacion | null;
  boleta: Boleta | null;
  versiones: VersionesInstaladas;
  coordinador: Coordinador;
  modo: ModoOperacion;
  /** Reloj de C2 (no el del lector). */
  instante: Date;
}

/** Resultado del motor: elegibilidad, motivo y evidencia. Aún no autoriza (falta el commit). */
export interface EvaluacionIngreso {
  decision: Decision;
  motivo: Motivo;
  proposito: Proposito | null;
  /** Primera aceptación correcta: genera consumo y admisión. */
  admision: boolean;
  concurrente: boolean;
  anulacionEnTransito: boolean;
  evidencia: Evidencia;
  /** Zona de la boleta; `null` si el código es desconocido. */
  zonaBoleta: string | null;
}

/** Decisión confirmada y correlacionada con el intento. */
export interface ResultadoValidacion extends Omit<EvaluacionIngreso, 'zonaBoleta'> {
  idOrigen: string;
  versionPermisos: number;
  instanteDecision: Date;
  repetida: boolean;
}

export interface IntentoRegistrado {
  huella: string;
  resultado: ResultadoValidacion;
}

export interface EntradaBitacora {
  eventoId: string;
  tipo: 'decision';
  idOrigen: string;
  contenido: Record<string, unknown>;
  registradoEn: Date;
}

export interface RegistroOutbox {
  eventoId: string;
  registro: RegistroEvidencia;
}
