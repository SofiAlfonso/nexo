import type { Coordinador, EstadoAutoridad } from '@nexo/shared/domain';

export class AutoridadNodoUnico implements EstadoAutoridad {
  private estado: Coordinador['estado'] = 'operando';
  private readonly coordinadorId: string;
  constructor(coordinadorId: string) {
    this.coordinadorId = coordinadorId;
  }

  actual(): Coordinador {
    return { coordinadorId: this.coordinadorId, estado: this.estado };
  }

  establecerEstado(estado: 'operando' | 'sin-autoridad'): void {
    this.estado = estado;
  }
}
