import type { Latido, RegistroLatidoPunto } from '@nexo/shared/contracts';

/**
 * Último latido por punto (H1). Los latidos no pasan por D1: el despachador E1
 * toma el último de cada punto y lo agrega como registro `latido-punto` en el siguiente lote.
 */
export class RegistroLatidos {
  private readonly ultimos = new Map<string, Latido>();
  private readonly pendientes = new Set<string>();

  registrar(latido: Latido): void {
    const previo = this.ultimos.get(latido.puntoId);
    if (previo && previo.lectorId === latido.lectorId && previo.secuencia > latido.secuencia) return;
    this.ultimos.set(latido.puntoId, latido);
    this.pendientes.add(latido.puntoId);
  }

  ultimo(puntoId: string): Latido | undefined {
    return this.ultimos.get(puntoId);
  }

  /** Registros E1 de los puntos con latido nuevo desde la última toma. */
  tomarPendientes(): RegistroLatidoPunto[] {
    const registros: RegistroLatidoPunto[] = [];
    for (const puntoId of this.pendientes) {
      const l = this.ultimos.get(puntoId);
      if (!l) continue;
      registros.push({
        tipo: 'latido-punto',
        idOrigen: `${l.lectorId}:latido:${l.secuencia}`,
        lectorId: l.lectorId,
        puntoId: l.puntoId,
        estadoLector: l.estadoLector,
        instanteLector: l.instanteLector,
        pendientesDiario: l.pendientesDiario,
        diarioTotal: l.diarioTotal,
      });
    }
    this.pendientes.clear();
    return registros;
  }

  /** Devuelve registros no entregados para reintentarlos en el siguiente lote. */
  devolver(registros: readonly RegistroLatidoPunto[]): void {
    for (const r of registros) {
      const l = this.ultimos.get(r.puntoId);
      if (l && `${l.lectorId}:latido:${l.secuencia}` === r.idOrigen) this.pendientes.add(r.puntoId);
    }
  }
}
