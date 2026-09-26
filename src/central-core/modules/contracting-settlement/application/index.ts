import type { Liquidacion } from '../../../../shared/contracts/o2.ts';
import {
  PLAZO_COBRO_MS,
  ajusteContraAnticipo,
  anticipo as calcularAnticipo,
  contribucionYMargen,
  costosEvento,
  importe as calcularImporte,
} from '../domain/index.ts';

export interface DatosLiquidacion {
  admisiones: number;
  excluidas: number;
  admisionesEstimadas: number;
  huboFallaCoordinador: boolean;
  descuento?: string;
}

export interface ResumenLiquidacion {
  moneda: 'USD';
  admisiones: number;
  excluidas: number;
  facturables: number;
  importe: string;
  anticipo: string;
  saldo: string;
  devolucion: string;
  costos: string;
  contribucion: string;
  margen: string;
  saldoCobrado: boolean;
}

/** Cálculo puro de T12 aplicado a los datos del evento (usado por `ServicioLiquidacion`). */
export function calcularLiquidacion(datos: DatosLiquidacion): Omit<ResumenLiquidacion, 'saldoCobrado'> {
  const facturables = datos.admisiones - datos.excluidas;
  const importeReal = calcularImporte(facturables, datos.descuento);
  const anticipo = calcularAnticipo(datos.admisionesEstimadas);
  const { saldo, devolucion } = ajusteContraAnticipo(importeReal, anticipo);
  const costos = costosEvento(datos.huboFallaCoordinador);
  const { contribucion, margen } = contribucionYMargen(importeReal, costos);
  return {
    moneda: 'USD',
    admisiones: datos.admisiones,
    excluidas: datos.excluidas,
    facturables,
    importe: importeReal,
    anticipo,
    saldo,
    devolucion,
    costos,
    contribucion,
    margen,
  };
}

export interface LiquidacionRepositorio {
  /** `null` si el evento no tiene contrato (no debería ocurrir tras M1, pero se valida). */
  obtenerDatos(eventoId: string): Promise<DatosLiquidacion | null>;
  guardar(eventoId: string, resumen: ResumenLiquidacion): Promise<void>;
  obtenerGuardada(eventoId: string): Promise<ResumenLiquidacion | null>;
  marcarCobrado(eventoId: string, cobroVenceEn: Date): Promise<void>;
}

export class ConflictoLiquidacion extends Error {
  readonly codigo = 'CONFLICTO_ESTADO';
}

export class EventoSinContrato extends Error {}

/**
 * M4: liquidación (T12 aplicado a datos reales del evento). El anticipo y el saldo/devolución se
 * recalculan siempre contra el estado actual de admisiones y exclusiones (prototipo §9: "la
 * liquidación es estimada" mientras el ingreso sigue abierto).
 */
export class ServicioLiquidacion {
  private readonly repo: LiquidacionRepositorio;
  private readonly ahora: () => Date;

  constructor(repo: LiquidacionRepositorio, ahora: () => Date = () => new Date()) {
    this.repo = repo;
    this.ahora = ahora;
  }

  async calcularYGuardar(eventoId: string): Promise<ResumenLiquidacion> {
    const datos = await this.repo.obtenerDatos(eventoId);
    if (!datos) throw new EventoSinContrato(`No hay contrato asociado al evento ${eventoId}`);
    const previa = await this.repo.obtenerGuardada(eventoId);
    const resumen: ResumenLiquidacion = { ...calcularLiquidacion(datos), saldoCobrado: previa?.saldoCobrado ?? false };
    await this.repo.guardar(eventoId, resumen);
    return resumen;
  }

  async registrarCobro(eventoId: string): Promise<ResumenLiquidacion> {
    const existente = await this.repo.obtenerGuardada(eventoId);
    if (existente?.saldoCobrado) throw new ConflictoLiquidacion('El saldo de este evento ya fue cobrado');
    const datos = await this.repo.obtenerDatos(eventoId);
    if (!datos) throw new EventoSinContrato(`No hay contrato asociado al evento ${eventoId}`);
    const resumen: ResumenLiquidacion = { ...calcularLiquidacion(datos), saldoCobrado: true };
    await this.repo.guardar(eventoId, resumen);
    const ahora = this.ahora();
    await this.repo.marcarCobrado(eventoId, new Date(ahora.getTime() + PLAZO_COBRO_MS));
    return resumen;
  }

  async obtener(eventoId: string): Promise<ResumenLiquidacion | null> {
    return this.repo.obtenerGuardada(eventoId);
  }
}

/** Proyecta el resumen interno (con `devolucion`/`saldoCobrado`) al contrato O2 `Liquidacion`. */
export function aLiquidacionContrato(resumen: ResumenLiquidacion): Liquidacion {
  return {
    moneda: resumen.moneda,
    admisiones: resumen.admisiones,
    excluidas: resumen.excluidas,
    facturables: resumen.facturables,
    importe: resumen.importe,
    anticipo: resumen.anticipo,
    saldo: resumen.saldo,
    costos: resumen.costos,
    contribucion: resumen.contribucion,
    margen: resumen.margen,
  };
}
