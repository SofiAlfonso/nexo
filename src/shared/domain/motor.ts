import type { Evidencia, Motivo, Proposito } from '../contracts/index.ts';
import type { Boleta, ContextoIngreso, EvaluacionIngreso } from './modelo.ts';

/** Una presentación de la misma boleta dentro de esta ventana se informa como uso concurrente (prototipo §7). */
export const VENTANA_CONCURRENCIA_MS = 3_000;

/** Ventana de ingreso semiabierta [apertura, cierre) (PB-05 a PB-07). */
export function admiteHorario(ventana: { aperturaEn: Date; cierreEn: Date }, instante: Date): boolean {
  const t = instante.getTime();
  return t >= ventana.aperturaEn.getTime() && t < ventana.cierreEn.getTime();
}

/** Una anulación afecta solo si C2 ya la recibió (ADR-010). */
export function anulacionConocida(boleta: Boleta, instante: Date): boolean {
  return (
    boleta.anulacion !== null &&
    boleta.anulacion.recibidaEn !== null &&
    boleta.anulacion.recibidaEn.getTime() <= instante.getTime()
  );
}

/**
 * Evalúa las reglas del primer ingreso sin consultar persistencia (taller 2 §6.2, prototipo §7).
 * Produce elegibilidad, no consumo: solo el commit en D1 confirma el ingreso.
 */
export class MotorPrimerIngreso {
  evaluar(ctx: ContextoIngreso): EvaluacionIngreso {
    const { evento, punto, boleta, versiones, coordinador, instante } = ctx;
    const antiguedadMs = versiones.permisosRecibidosEn ? instante.getTime() - versiones.permisosRecibidosEn.getTime() : 0;
    const evidencia: Evidencia = {
      via: `Coordinador ${coordinador.coordinadorId}`,
      versionPermisos: versiones.versionPermisos,
      versionPoliticas: versiones.versionPoliticas,
      antiguedadPermisosS: Math.max(0, Math.round(antiguedadMs / 1000)),
    };
    const zonaBoleta = boleta?.zona ?? null;
    const r = (
      decision: EvaluacionIngreso['decision'],
      motivo: Motivo,
      extra: Partial<Pick<EvaluacionIngreso, 'admision' | 'concurrente' | 'anulacionEnTransito'>> & { proposito?: Proposito } = {},
    ): EvaluacionIngreso => ({
      decision,
      motivo,
      proposito: extra.proposito ?? null,
      admision: extra.admision ?? false,
      concurrente: extra.concurrente ?? false,
      anulacionEnTransito: extra.anulacionEnTransito ?? false,
      evidencia,
      zonaBoleta,
    });

    // 1. Autoridad: sin coordinador operando, o contingencia local sin política, no hay decisión (ADR-002, PB-11).
    if (coordinador.estado !== 'operando') return r('sin-respuesta', 'SIN_COORDINADOR');
    if (ctx.modo === 'local-contingencia' && !evento.politicas.contingenciaLocal) {
      return r('sin-respuesta', 'SIN_COORDINADOR');
    }

    // Punto no habilitado o ajeno al evento (PB-09).
    if (!punto || !punto.habilitado || punto.eventoId !== evento.eventoId) return r('rechazado', 'PUNTO_SUSPENDIDO');

    // 2. Código desconocido: se registra sin fabricar boleta (RN-02). Nada cruza entre eventos (PB-01).
    if (!boleta || boleta.eventoId !== evento.eventoId) return r('rechazado', 'CODIGO_DESCONOCIDO');

    // 3. Anulación ya recibida.
    if (anulacionConocida(boleta, instante)) return r('rechazado', 'BOLETA_ANULADA');

    // 4. Zona identificada, servida por el punto y autorizada por la boleta (PB-08).
    const zonaSolicitada = ctx.intento.zonaSolicitada?.trim();
    if (!zonaSolicitada || !punto.zonas.includes(zonaSolicitada) || boleta.zona !== zonaSolicitada) {
      return r('rechazado', 'ZONA_NO_AUTORIZADA');
    }

    // 5. Estado del evento y ventana de ingreso (PB-05, PB-06, PB-07, PB-10).
    if (evento.estado !== 'abierto' || !admiteHorario(evento.ventana, instante)) {
      return r('rechazado', 'FUERA_DE_HORARIO');
    }

    // 6. Primer uso. Sin reingresos (D10): un consumo previo siempre rechaza.
    if (boleta.consumo) {
      const desdeConsumoMs = instante.getTime() - boleta.consumo.consumidoEn.getTime();
      if (desdeConsumoMs < VENTANA_CONCURRENCIA_MS) return r('rechazado', 'USO_CONCURRENTE', { concurrente: true });
      return r('rechazado', 'USO_YA_REGISTRADO');
    }

    // 7. Primera aceptación correcta: genera la admisión.
    return r('aceptado', 'PERMISO_VIGENTE', {
      proposito: 'ingreso',
      admision: true,
      anulacionEnTransito: boleta.anulacion !== null,
    });
  }
}
