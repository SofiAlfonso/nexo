import type { Latido, RegistroLatidoPunto } from '@nexo/shared/contracts';
import { metrics } from '@nexo/shared/telemetry';

const meter = metrics.getMeter('nexo.local-coordinator');
/**
 * Edad en segundos desde el último latido recibido por punto, apoyo de A8 (T2 §8.6:
 * punto sin comunicación más de 60 s). No es una de las seis métricas N/T de T2 §3.2.
 */
const latidoEdadGauge = meter.createObservableGauge('nexo_c2_latido_edad_s', {
  description: 'Segundos desde el último latido H1 recibido, por punto (apoyo de la alerta A8)',
});

/**
 * idOrigen E1 del latido. Incluye el instante del lector porque la secuencia se reinicia cuando el
 * lector reinicia: sin él, un latido nuevo reutilizaría el idOrigen de otro con contenido distinto y
 * C4 lo rechazaría por conflicto de idempotencia (409). El mismo latido reintentado conserva el id.
 */
export function idOrigenLatido(l: Pick<Latido, 'lectorId' | 'secuencia' | 'instanteLector'>): string {
  return `${l.lectorId}:latido:${l.secuencia}:${l.instanteLector}`;
}

/**
 * Último latido por punto (H1). Los latidos no pasan por D1: el despachador E1
 * toma el último de cada punto y lo agrega como registro `latido-punto` en el siguiente lote.
 */
export class RegistroLatidos {
  private readonly ultimos = new Map<string, Latido>();
  private readonly pendientes = new Set<string>();
  private readonly recibidoEn = new Map<string, number>();

  constructor() {
    latidoEdadGauge.addCallback((resultado) => {
      const ahora = Date.now();
      for (const [puntoId, recibidoEn] of this.recibidoEn) {
        resultado.observe((ahora - recibidoEn) / 1000, { puntoId });
      }
    });
  }

  registrar(latido: Latido): void {
    const previo = this.ultimos.get(latido.puntoId);
    if (previo && previo.lectorId === latido.lectorId && previo.secuencia > latido.secuencia) return;
    this.ultimos.set(latido.puntoId, latido);
    this.pendientes.add(latido.puntoId);
    this.recibidoEn.set(latido.puntoId, Date.now());
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
        idOrigen: idOrigenLatido(l),
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
      if (l && idOrigenLatido(l) === r.idOrigen) this.pendientes.add(r.puntoId);
    }
  }
}
