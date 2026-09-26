import type { Pool } from 'pg';
import { ServicioLiquidacion } from '../application/index.ts';
import { LiquidacionRepositorioPg } from '../infrastructure/index.ts';

export {
  ConflictoLiquidacion,
  EventoSinContrato,
  ServicioLiquidacion,
  aLiquidacionContrato,
  type ResumenLiquidacion,
} from '../application/index.ts';

export function crearServicioLiquidacion(pool: Pool): ServicioLiquidacion {
  return new ServicioLiquidacion(new LiquidacionRepositorioPg(pool));
}
