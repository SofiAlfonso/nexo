/**
 * Adaptador del puerto `Telemetria` de dominio (T2 §6, `@nexo/shared/domain`) para C2: traduce
 * las dos notificaciones del caso de uso "Validar primer ingreso" en métricas OTel (T1, T3, N1,
 * N2) y en un log JSON estructurado (T2 §8.4). Sus fallas nunca deben llegar al llamador (PB-21);
 * el motor ya invoca este adaptador dentro de un `try/catch` que descarta cualquier excepción.
 */
import { LIMITES_LATENCIA_MS, metrics } from '@nexo/shared/telemetry';
import type { IntentoDeValidacion, ResultadoValidacion, Telemetria } from '@nexo/shared/domain';

export interface LoggerBasico {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

const meter = metrics.getMeter('nexo.local-coordinator');

/**
 * `nexo_c2_validaciones_total{decision,motivo}`: base de N1 (admisiones/ingresos, `decision=aceptado`
 * y `admision=true`) y de N2 (disponibilidad = 1 - proporción `decision=sin-respuesta`).
 */
const validacionesTotal = meter.createCounter('nexo_c2_validaciones_total', {
  description: 'Decisiones de V1 confirmadas por C2, incluidas sin-respuesta (denominador completo, T2 §8.2)',
});

/** `nexo_c2_validacion_duracion_ms`: T1, latencia de validación medida en C2 (commit incluido). */
const validacionDuracionMs = meter.createHistogram('nexo_c2_validacion_duracion_ms', {
  description: 'Duración de una validación V1 confirmada en C2, desde la solicitud hasta la decisión',
  unit: 'ms',
  advice: { explicitBucketBoundaries: [...LIMITES_LATENCIA_MS] },
});

/** `nexo_c2_errores_total{causa}`: T3, errores técnicos y solicitudes sin respuesta. */
const erroresTotal = meter.createCounter('nexo_c2_errores_total', {
  description: 'Solicitudes V1 sin confirmación por error técnico, timeout o plazo vencido (T3)',
});

/** Implementa el puerto `Telemetria` de `@nexo/shared/domain` para C2. */
export function crearTelemetriaC2(log?: LoggerBasico): Telemetria {
  return {
    decisionConfirmada(resultado: ResultadoValidacion, intento: IntentoDeValidacion, duracionMs: number): void {
      validacionesTotal.add(1, { decision: resultado.decision, motivo: resultado.motivo, admision: String(resultado.admision) });
      validacionDuracionMs.record(duracionMs, { decision: resultado.decision });
      log?.info({
        evento: 'validacion.decidida',
        idOrigen: intento.idOrigen,
        puntoId: intento.puntoId,
        decision: resultado.decision,
        motivo: resultado.motivo,
        duracionMs,
      }, 'Validación V1 confirmada');
    },
    sinConfirmacion(intento: IntentoDeValidacion, causa: string): void {
      validacionesTotal.add(1, { decision: 'sin-respuesta', motivo: 'SIN_COORDINADOR', admision: 'false' });
      erroresTotal.add(1, { causa });
      log?.warn({
        evento: 'validacion.sin_confirmacion',
        idOrigen: intento.idOrigen,
        puntoId: intento.puntoId,
        causa,
      }, 'Validación V1 sin confirmación');
    },
  };
}
