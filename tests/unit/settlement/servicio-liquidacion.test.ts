import { describe, expect, it } from 'vitest';
import {
  ConflictoLiquidacion,
  EventoSinContrato,
  ServicioLiquidacion,
  aLiquidacionContrato,
  type DatosLiquidacion,
  type LiquidacionRepositorio,
  type ResumenLiquidacion,
} from '../../../src/central-core/modules/contracting-settlement/application/index.ts';

class LiquidacionRepositorioMemoria implements LiquidacionRepositorio {
  datos: DatosLiquidacion | null = null;
  guardada: ResumenLiquidacion | null = null;
  cobroVenceEn: Date | null = null;

  async obtenerDatos(): Promise<DatosLiquidacion | null> { return this.datos; }
  async guardar(_eventoId: string, resumen: ResumenLiquidacion): Promise<void> { this.guardada = resumen; }
  async obtenerGuardada(): Promise<ResumenLiquidacion | null> { return this.guardada; }
  async marcarCobrado(_eventoId: string, cobroVenceEn: Date): Promise<void> { this.cobroVenceEn = cobroVenceEn; }
}

describe('ServicioLiquidacion', () => {
  it('calcula y guarda la liquidación a partir de los datos del evento (PB-18: 1 admisión = 500.40)', async () => {
    const repo = new LiquidacionRepositorioMemoria();
    repo.datos = { admisiones: 1, excluidas: 0, admisionesEstimadas: 0, huboFallaCoordinador: false };
    const servicio = new ServicioLiquidacion(repo);

    const resumen = await servicio.calcularYGuardar('EVT-1');
    expect(resumen.importe).toBe('500.40');
    expect(resumen.facturables).toBe(1);
    expect(resumen.saldoCobrado).toBe(false);
    expect(repo.guardada).toEqual(resumen);
  });

  it('descuenta las admisiones excluidas de las facturables', async () => {
    const repo = new LiquidacionRepositorioMemoria();
    repo.datos = { admisiones: 10, excluidas: 3, admisionesEstimadas: 0, huboFallaCoordinador: false };
    const servicio = new ServicioLiquidacion(repo);
    const resumen = await servicio.calcularYGuardar('EVT-1');
    expect(resumen.facturables).toBe(7);
  });

  it('lanza EventoSinContrato si no hay contrato asociado', async () => {
    const repo = new LiquidacionRepositorioMemoria();
    const servicio = new ServicioLiquidacion(repo);
    await expect(servicio.calcularYGuardar('EVT-1')).rejects.toBeInstanceOf(EventoSinContrato);
  });

  it('registra el cobro fijando la fecha límite (PLAZO_COBRO_MS) y no permite repetirlo', async () => {
    const repo = new LiquidacionRepositorioMemoria();
    repo.datos = { admisiones: 1, excluidas: 0, admisionesEstimadas: 0, huboFallaCoordinador: false };
    const ahora = () => new Date('2025-01-01T00:00:00.000Z');
    const servicio = new ServicioLiquidacion(repo, ahora);

    const resumen = await servicio.registrarCobro('EVT-1');
    expect(resumen.saldoCobrado).toBe(true);
    expect(repo.cobroVenceEn?.toISOString()).toBe('2025-01-31T00:00:00.000Z');

    await expect(servicio.registrarCobro('EVT-1')).rejects.toBeInstanceOf(ConflictoLiquidacion);
  });

  it('aLiquidacionContrato proyecta el resumen sin campos internos (devolucion/saldoCobrado)', async () => {
    const repo = new LiquidacionRepositorioMemoria();
    repo.datos = { admisiones: 5, excluidas: 0, admisionesEstimadas: 10, huboFallaCoordinador: true };
    const servicio = new ServicioLiquidacion(repo);
    const resumen = await servicio.calcularYGuardar('EVT-1');
    const liquidacion = aLiquidacionContrato(resumen);
    expect(liquidacion).not.toHaveProperty('devolucion');
    expect(liquidacion).not.toHaveProperty('saldoCobrado');
    expect(liquidacion.costos).toBe('320.00');
  });
});
