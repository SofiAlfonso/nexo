import { describe, expect, it, vi } from 'vitest';
import type { Rol } from '../../../src/shared/contracts/common.ts';
import type { Diferencia } from '../../../src/shared/contracts/o2.ts';
import {
  ConflictoEstadoConciliacion,
  DiferenciaNoEncontrada,
  OpcionInvalida,
  ServicioConciliacion,
  type ConciliacionRepositorio,
  type DeteccionRepositorio,
  type DiferenciasRepositorio,
  type EstadoConciliacionAlmacen,
  type EstadoConciliacionGuardado,
  type LiquidacionPuerto,
} from '../../../src/central-core/modules/reconciliation/application/index.ts';
import type { DatosCondicionesCierre, NuevaDiferencia } from '../../../src/central-core/modules/reconciliation/domain/index.ts';

const CONDICIONES_OK: DatosCondicionesCierre = {
  ventanaCerrada: true,
  diariosSincronizados: true,
  buzonVacio: true,
  cambiosAlDia: true,
  preliminarEntregado: false,
  diferenciasResueltas: true,
};

class ConciliacionRepositorioMemoria implements ConciliacionRepositorio {
  estado: EstadoConciliacionAlmacen = 'sin-iniciar';
  preliminarEn: Date | null = null;
  definitivoEn: Date | null = null;

  async obtenerEventoActualId(): Promise<string | null> { return 'EVT-1'; }
  async obtenerEstado(): Promise<EstadoConciliacionGuardado> {
    return { estado: this.estado, preliminarEn: this.preliminarEn, definitivoEn: this.definitivoEn };
  }
  async marcarEnCurso(): Promise<void> { this.estado = 'en-curso'; }
  async marcarPreliminar(_eventoId: string, _usuario: string, momento: Date): Promise<void> {
    this.estado = 'preliminar';
    this.preliminarEn = momento;
  }
  async marcarDefinitivo(_eventoId: string, _usuario: string, momento: Date): Promise<void> {
    this.estado = 'conciliado';
    this.definitivoEn = momento;
  }
}

class DiferenciasRepositorioMemoria implements DiferenciasRepositorio {
  private secuencia = 0;
  private readonly filas = new Map<string, Diferencia>();

  async listar(): Promise<Diferencia[]> { return [...this.filas.values()]; }
  async existeAbiertaPorReferencia(_eventoId: string, referencia: string): Promise<boolean> {
    return [...this.filas.values()].some((d) => d.tipo === 'anulacion' && d.referencia === referencia && d.estado === 'abierta');
  }
  async existeAbiertaDiario(): Promise<boolean> {
    return [...this.filas.values()].some((d) => d.tipo === 'diario' && d.estado === 'abierta');
  }
  async crear(_eventoId: string, diferencia: NuevaDiferencia): Promise<Diferencia> {
    this.secuencia += 1;
    const completa: Diferencia = {
      ...diferencia, id: `DIF-${String(this.secuencia).padStart(3, '0')}`, estado: 'abierta',
      resolucion: null, resueltaPor: null, resueltaEnS: null,
    };
    this.filas.set(completa.id, completa);
    return completa;
  }
  async obtener(_eventoId: string, diferenciaId: string): Promise<Diferencia | null> { return this.filas.get(diferenciaId) ?? null; }
  async resolver(_eventoId: string, diferenciaId: string, opcionId: string, operador: { usuario: string; rol: Rol }, momento: Date): Promise<Diferencia> {
    const actual = this.filas.get(diferenciaId);
    if (!actual) throw new Error('no existe');
    const resuelta: Diferencia = {
      ...actual, estado: 'resuelta', resolucion: opcionId, resueltaPor: operador.rol, resueltaEnS: momento.getUTCSeconds(),
    };
    this.filas.set(diferenciaId, resuelta);
    return resuelta;
  }
}

class DeteccionRepositorioMemoria implements DeteccionRepositorio {
  condiciones: DatosCondicionesCierre = { ...CONDICIONES_OK };
  anulaciones: { referencia: string; intentoId: string }[] = [];
  intentosSinConfirmar = 0;
  boletasExcluidas = new Set<string>();

  async obtenerCondicionesCierre(): Promise<DatosCondicionesCierre> { return this.condiciones; }
  async anulacionesConAdmisionPrevia(): Promise<{ referencia: string; intentoId: string }[]> { return this.anulaciones; }
  async intentosSinDecisionConfirmada(): Promise<number> { return this.intentosSinConfirmar; }
  async marcarBoletaExcluida(_eventoId: string, referencia: string, excluida: boolean): Promise<void> {
    if (excluida) this.boletasExcluidas.add(referencia); else this.boletasExcluidas.delete(referencia);
  }
}

class LiquidacionPuertoMemoria implements LiquidacionPuerto {
  cobrado = false;
  async registrarCobro(): Promise<void> { this.cobrado = true; }
  async saldoCobrado(): Promise<boolean> { return this.cobrado; }
}

function construirServicio() {
  const conciliaciones = new ConciliacionRepositorioMemoria();
  const diferencias = new DiferenciasRepositorioMemoria();
  const deteccion = new DeteccionRepositorioMemoria();
  const liquidacion = new LiquidacionPuertoMemoria();
  const ahora = vi.fn(() => new Date('2025-01-01T00:00:00Z'));
  const servicio = new ServicioConciliacion(conciliaciones, diferencias, deteccion, liquidacion, ahora);
  return { servicio, conciliaciones, diferencias, deteccion, liquidacion };
}

describe('ServicioConciliacion', () => {
  it('detecta diferencias de anulación e intentos sin confirmar y evita duplicarlas', async () => {
    const { servicio, deteccion } = construirServicio();
    deteccion.anulaciones = [{ referencia: 'REF-1', intentoId: 'INT-1' }];
    deteccion.intentosSinConfirmar = 2;

    const primera = await servicio.detectarDiferencias('EVT-1');
    expect(primera).toHaveLength(2);
    expect(primera.map((d) => d.tipo).sort()).toEqual(['anulacion', 'diario']);

    const segunda = await servicio.detectarDiferencias('EVT-1');
    expect(segunda).toHaveLength(0);
  });

  it('no permite entregar el preliminar si la ventana sigue abierta', async () => {
    const { servicio, deteccion } = construirServicio();
    deteccion.condiciones = { ...CONDICIONES_OK, ventanaCerrada: false };
    await expect(servicio.entregarPreliminar('EVT-1', 'cierre1')).rejects.toBeInstanceOf(ConflictoEstadoConciliacion);
  });

  it('entrega el preliminar y bloquea declarar conciliado si quedan diferencias abiertas', async () => {
    const { servicio, deteccion } = construirServicio();
    deteccion.anulaciones = [{ referencia: 'REF-1', intentoId: 'INT-1' }];

    const conciliacion = await servicio.entregarPreliminar('EVT-1', 'cierre1');
    expect(conciliacion.estado).toBe('preliminar');
    expect(conciliacion.diferencias).toHaveLength(1);

    // La diferencia sigue abierta: el detector real la reportaría como pendiente.
    deteccion.condiciones = { ...CONDICIONES_OK, preliminarEntregado: true, diferenciasResueltas: false };
    await expect(servicio.declararConciliado('EVT-1', 'cierre1')).rejects.toMatchObject({
      pendientes: ['diferencias-resueltas'],
    });
  });

  it('resuelve una diferencia de anulación excluyendo la boleta del cobro y permite declarar conciliado', async () => {
    const { servicio, deteccion } = construirServicio();
    deteccion.anulaciones = [{ referencia: 'REF-1', intentoId: 'INT-1' }];
    const conciliacion = await servicio.entregarPreliminar('EVT-1', 'cierre1');
    const [diferencia] = conciliacion.diferencias;
    if (!diferencia) throw new Error('se esperaba una diferencia');

    const resuelta = await servicio.resolverDiferencia('EVT-1', diferencia.id, 'excluir-del-cobro', { usuario: 'cierre1', rol: 'CIERRE' });
    expect(resuelta.diferencias[0]?.estado).toBe('resuelta');
    expect(deteccion.boletasExcluidas.has('REF-1')).toBe(true);

    deteccion.condiciones = { ...CONDICIONES_OK, preliminarEntregado: true };
    const definitiva = await servicio.declararConciliado('EVT-1', 'cierre1');
    expect(definitiva.estado).toBe('conciliado');
  });

  it('rechaza una opción que no pertenece a la diferencia', async () => {
    const { servicio, deteccion } = construirServicio();
    deteccion.anulaciones = [{ referencia: 'REF-1', intentoId: 'INT-1' }];
    const conciliacion = await servicio.entregarPreliminar('EVT-1', 'cierre1');
    const [diferencia] = conciliacion.diferencias;
    if (!diferencia) throw new Error('se esperaba una diferencia');
    await expect(
      servicio.resolverDiferencia('EVT-1', diferencia.id, 'opcion-inexistente', { usuario: 'cierre1', rol: 'CIERRE' }),
    ).rejects.toBeInstanceOf(OpcionInvalida);
  });

  it('lanza DiferenciaNoEncontrada si el id no existe', async () => {
    const { servicio } = construirServicio();
    await expect(
      servicio.resolverDiferencia('EVT-1', 'DIF-999', 'x', { usuario: 'cierre1', rol: 'CIERRE' }),
    ).rejects.toBeInstanceOf(DiferenciaNoEncontrada);
  });

  it('solo permite el cobro cuando el evento está conciliado, y no lo repite', async () => {
    const { servicio, deteccion, liquidacion } = construirServicio();
    await expect(servicio.registrarCobro('EVT-1')).rejects.toBeInstanceOf(ConflictoEstadoConciliacion);

    await servicio.entregarPreliminar('EVT-1', 'cierre1');
    deteccion.condiciones = { ...CONDICIONES_OK, preliminarEntregado: true };
    await servicio.declararConciliado('EVT-1', 'cierre1');

    const conciliacion = await servicio.registrarCobro('EVT-1');
    expect(conciliacion.saldoCobrado).toBe(true);
    expect(liquidacion.cobrado).toBe(true);

    await expect(servicio.registrarCobro('EVT-1')).rejects.toBeInstanceOf(ConflictoEstadoConciliacion);
  });
});
