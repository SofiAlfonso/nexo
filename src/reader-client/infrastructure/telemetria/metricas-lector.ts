/**
 * Métricas OTel de C1 (T40, T2 §8.2/§8.3): complementan las de C2 con la latencia y el resultado
 * medidos en el lector (denominador completo, incluidos los `sin-respuesta` por timeout local).
 */
import { metrics } from '@nexo/shared/telemetry';

const meter = metrics.getMeter('nexo.reader-client');

/** `nexo_c1_validacion_duracion_ms{decision}`: T1 medido en el lector, extremo a extremo. */
const validacionDuracionMs = meter.createHistogram('nexo_c1_validacion_duracion_ms', {
  description: 'Latencia de una presentación V1 medida en el lector, desde el envío hasta la decisión (o el timeout local)',
  unit: 'ms',
});

/** `nexo_c1_resultados_total{decision}`: base de N1/N2 vistas desde el lector. */
const resultadosTotal = meter.createCounter('nexo_c1_resultados_total', {
  description: 'Resultados de presentaciones V1 vistos por el lector, por decisión',
});

/** Registra el resultado de una presentación V1 en el lector (T1, T2). */
export function registrarResultadoLector(decision: string, latenciaMs: number): void {
  validacionDuracionMs.record(latenciaMs, { decision });
  resultadosTotal.add(1, { decision });
}
