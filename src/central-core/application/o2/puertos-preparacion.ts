import type { EstadoConciliacion } from '@nexo/shared/contracts';

/** `m3_conciliacion.conciliaciones`; M1 solo necesita el estado inicial para O2 (sin M3 real aún). */
export interface ConciliacionLeida {
  estado: EstadoConciliacion;
  preliminarEn: Date | null;
  definitivoEn: Date | null;
}

/** `m1_config_permisos.controles_preparacion` + confirmación de apertura del evento. */
export interface PreparacionLeida {
  confirmada: boolean;
  controles: Array<{ id: string; titulo: string; ok: boolean }>;
}

export interface PreparacionConciliacionRepositorio {
  obtenerConciliacion(eventoId: string): Promise<ConciliacionLeida>;
  obtenerPreparacion(eventoId: string): Promise<PreparacionLeida>;
}
