import type { Pool } from 'pg';
import type { ServicioLiquidacion } from '../../contracting-settlement/application/index.ts';
import type { LiquidacionPuerto } from '../application/index.ts';
import { ServicioConciliacion } from '../application/index.ts';
import {
  ConciliacionRepositorioPg,
  DeteccionRepositorioPg,
  DiferenciasRepositorioPg,
} from '../infrastructure/index.ts';

export {
  ConflictoEstadoConciliacion,
  DiferenciaNoEncontrada,
  OpcionInvalida,
  ServicioConciliacion,
} from '../application/index.ts';

/**
 * Adapta `ServicioLiquidacion` (M4, módulo `contracting-settlement`) al puerto que necesita la
 * conciliación para el cobro, sin importar su `infrastructure/` (regla de límites entre módulos).
 */
class LiquidacionPuertoServicio implements LiquidacionPuerto {
  private readonly servicio: ServicioLiquidacion;
  constructor(servicio: ServicioLiquidacion) { this.servicio = servicio; }

  async registrarCobro(eventoId: string): Promise<void> {
    await this.servicio.calcularYGuardar(eventoId);
    await this.servicio.registrarCobro(eventoId);
  }

  async saldoCobrado(eventoId: string): Promise<boolean> {
    const resumen = await this.servicio.obtener(eventoId);
    return resumen?.saldoCobrado ?? false;
  }
}

export function crearServicioConciliacion(pool: Pool, liquidacion: ServicioLiquidacion): ServicioConciliacion {
  return new ServicioConciliacion(
    new ConciliacionRepositorioPg(pool),
    new DiferenciasRepositorioPg(pool),
    new DeteccionRepositorioPg(pool),
    new LiquidacionPuertoServicio(liquidacion),
  );
}
