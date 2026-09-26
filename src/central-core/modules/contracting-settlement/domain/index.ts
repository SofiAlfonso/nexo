import { Decimal } from 'decimal.js';

/**
 * T12: tarifa e hipótesis comercial S3 (taller1.md §5): USD 500 por evento más USD 0,40 por
 * boleta correctamente aceptada (I(N) = 500 + 0,40·N), contada una vez por boleta y evento.
 * `decimal.js` evita el punto flotante (PB-18 exige el importe exacto).
 */
export const CARGO_BASE_EVENTO = '500';
export const TARIFA_POR_ADMISION = '0.40';
/** Anticipo: 500 más 50 % del uso estimado (taller1.md §5, prototipo §9). */
export const PORCENTAJE_ANTICIPO_USO = '0.5';

/** Plazos de negocio (taller1.md KR4.3, KR5.2; taller2.md PB-15, 16, 22, 23, 24). */
export const PLAZO_PRELIMINAR_MS = 30 * 60 * 1000;
export const PLAZO_DEFINITIVO_MS = 24 * 60 * 60 * 1000;
export const PLAZO_COBRO_MS = 30 * 24 * 60 * 60 * 1000;
export const PLAZO_RECOMPRA_MS = 60 * 24 * 60 * 60 * 1000;

/** Costos fijos por evento y escalación si hubo falla del coordinador (prototipo §9, S-04). */
export const COSTO_BASE_EVENTO = '300';
export const COSTO_ESCALACION_COORDINADOR = '20';

function decimalNoNegativo(valor: number, nombre: string): Decimal {
  if (!Number.isFinite(valor) || valor < 0) throw new Error(`${nombre} no puede ser negativo`);
  return new Decimal(valor);
}

/**
 * Importe facturado por el evento: cargo base más admisiones facturables por la tarifa unitaria,
 * menos un descuento comercial acordado (PU-07-05). PB-17: cero admisiones da USD 500.
 * PB-18: una admisión da exactamente USD 500,40 (con decimal, no punto flotante).
 */
export function importe(admisionesFacturables: number, descuento = '0'): string {
  const admisiones = decimalNoNegativo(admisionesFacturables, 'admisionesFacturables');
  const total = new Decimal(CARGO_BASE_EVENTO)
    .plus(new Decimal(TARIFA_POR_ADMISION).times(admisiones))
    .minus(descuento);
  if (total.isNegative()) throw new Error('El descuento no puede superar el importe');
  return total.toFixed(2);
}

/**
 * Anticipo cobrado antes del evento a partir de las admisiones estimadas en el contrato.
 * PB-20: una admisión estimada da exactamente USD 500,20.
 */
export function anticipo(admisionesEstimadas: number): string {
  const estimadas = decimalNoNegativo(admisionesEstimadas, 'admisionesEstimadas');
  const usoEstimado = new Decimal(TARIFA_POR_ADMISION).times(estimadas).times(PORCENTAJE_ANTICIPO_USO);
  return new Decimal(CARGO_BASE_EVENTO).plus(usoEstimado).toFixed(2);
}

export interface AjusteAnticipo {
  /** Monto adicional que el cliente debe pagar (importe real superó el anticipo). */
  saldo: string;
  /** Monto que NEXO debe devolver (el anticipo superó el importe real). */
  devolucion: string;
}

/**
 * Ajuste al conciliar: saldo por cobrar si el importe real supera el anticipo (PU-07-04),
 * o devolución si el anticipo cobrado fue mayor que el uso real (PU-07-03).
 */
export function ajusteContraAnticipo(importeReal: string, anticipoCobrado: string): AjusteAnticipo {
  const diferencia = new Decimal(importeReal).minus(anticipoCobrado);
  return diferencia.greaterThan(0)
    ? { saldo: diferencia.toFixed(2), devolucion: '0.00' }
    : { saldo: '0.00', devolucion: diferencia.abs().toFixed(2) };
}

/** Costos del evento: base más escalación si hubo un incidente de falla del coordinador. */
export function costosEvento(huboFallaCoordinador: boolean): string {
  const total = new Decimal(COSTO_BASE_EVENTO).plus(huboFallaCoordinador ? COSTO_ESCALACION_COORDINADOR : 0);
  return total.toFixed(2);
}

export interface ContribucionYMargen {
  contribucion: string;
  /** Margen frente al importe, como fracción decimal (p. ej. "0.9540" ~ 95,4 %). */
  margen: string;
}

/** Contribución y margen = (importe - costos) / importe (prototipo §9). */
export function contribucionYMargen(importeReal: string, costos: string): ContribucionYMargen {
  const importeDecimal = new Decimal(importeReal);
  const contribucion = importeDecimal.minus(costos);
  const margen = importeDecimal.isZero() ? new Decimal(0) : contribucion.dividedBy(importeDecimal);
  return { contribucion: contribucion.toFixed(2), margen: margen.toFixed(4) };
}

/**
 * Un plazo se cumple con el límite exacto incluido (PB-15, 16, 24: al límite exacto está
 * dentro; un milisegundo después, fuera).
 */
export function dentroDePlazo(transcurridoMs: number, limiteMs: number): boolean {
  return transcurridoMs >= 0 && transcurridoMs <= limiteMs;
}

export function msTranscurridos(desde: Date, hasta: Date): number {
  return hasta.getTime() - desde.getTime();
}

export interface CondicionesRecompra {
  /** Cliente de la primera contratación pagada del piloto. */
  clienteOriginalId: string;
  /** Cliente de la nueva contratación evaluada. */
  clienteNuevoId: string;
  /** La nueva contratación es vinculante (firmada), no solo una intención. */
  vinculante: boolean;
  primerPilotoPagadoEn: Date;
  nuevaContratacionEn: Date;
}

export interface ResultadoRecompra {
  /** Nueva contratación vinculante del mismo cliente, sin importar el plazo (PU-08). */
  esRecompra: boolean;
  /** Recompra dentro de los 60 días del primer piloto pagado: acredita KR5.2 (PB-22, 23). */
  acreditaKR52: boolean;
  diasTranscurridos: number;
}

/**
 * PU-08: reglas de recompra. KR5.2 exige "nueva contratación vinculante del mismo cliente
 * dentro de 60 días del primer piloto pagado" (taller1.md). PB-22: a los 60 días exactos
 * cumple; PB-23: a los 61 días es recompra, pero no acredita KR5.2.
 */
export function evaluarRecompra(condiciones: CondicionesRecompra): ResultadoRecompra {
  const transcurridoMs = msTranscurridos(condiciones.primerPilotoPagadoEn, condiciones.nuevaContratacionEn);
  if (transcurridoMs < 0) throw new Error('La nueva contratación no puede ser anterior al primer piloto pagado');
  const diasTranscurridos = Math.floor(transcurridoMs / (24 * 60 * 60 * 1000));
  const esRecompra = condiciones.vinculante && condiciones.clienteOriginalId === condiciones.clienteNuevoId;
  const acreditaKR52 = esRecompra && dentroDePlazo(transcurridoMs, PLAZO_RECOMPRA_MS);
  return { esRecompra, acreditaKR52, diasTranscurridos };
}
