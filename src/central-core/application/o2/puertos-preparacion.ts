import type { Conciliacion } from '@nexo/shared/contracts';

/** `m1_config_permisos.controles_preparacion` + confirmación de apertura del evento. */
export interface PreparacionLeida {
  confirmada: boolean;
  controles: Array<{ id: string; titulo: string; ok: boolean }>;
}

export interface PreparacionRepositorio {
  obtenerPreparacion(eventoId: string): Promise<PreparacionLeida>;
  /** Marca (o desmarca) un control; `id` ya validado contra `ControlPreparacion.id` por el caller. */
  alternarControl(eventoId: string, id: string, ok: boolean): Promise<void>;
  /** Solo escribe `apertura_confirmada_en`; el llamador ya validó que todos los controles están `ok`. */
  confirmarApertura(eventoId: string): Promise<void>;
}

/**
 * Puerto hacia `ServicioConciliacion` (M3, módulo `reconciliation`): la composición O2 solo lee la
 * conciliación completa (estado, diferencias, condiciones, saldo) para `GET /api/eventos/actual/estado`
 * y el SSE `estado`; las mutaciones viven en `registrarRutasCierre`.
 */
export interface ConciliacionPuerto {
  obtenerConciliacion(eventoId: string): Promise<Conciliacion>;
}
