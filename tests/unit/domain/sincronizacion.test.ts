import { describe, expect, it, vi } from 'vitest';
import { LoteEvidencia } from '../../../src/shared/contracts/e1.ts';
import type { AcuseLoteEvidencia, RegistroEvidencia } from '../../../src/shared/contracts/e1.ts';
import { ServicioIngestaEvidencia } from '../../../src/central-core/modules/evidence-ingestion/application/index.ts';
import type { LoteEvidenciaRepositorio, ProcesarAceptados, Resultado } from '../../../src/central-core/modules/evidence-ingestion/application/index.ts';
import { DespachadorOutbox } from '../../../src/local-coordinator/application/despachador-outbox.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import type { IntentoDiarioPendiente } from '../../../src/central-core/modules/evidence-ingestion/domain/index.ts';
import type { OutboxPendiente, PendienteOutbox } from '../../../src/shared/domain/index.ts';
import { BASE, EVENTO } from './dobles.ts';

const historico: RegistroEvidencia = {
  tipo: 'intento-diario', idOrigen: 'INT-HIST-001', lectorId: 'LEC-001',
  puntoId: 'P-01', codigo: 'COD-001', zonaSolicitada: 'Norte',
  proposito: 'ingreso', motivoLocal: 'SIN_COORDINADOR',
  instanteLector: new Date(BASE).toISOString(), recibidoEnCoordinador: new Date(BASE).toISOString(),
};

const lote = LoteEvidencia.parse({
  idLote: 'LOTE-HIST-001', recintoId: 'REC-01', eventoId: EVENTO,
  coordinadorId: 'COORD-A', emitidoEn: new Date(BASE).toISOString(), registros: [historico],
});

class LotesDobles implements LoteEvidenciaRepositorio {
  readonly acuses = new Map<string, AcuseLoteEvidencia>();
  readonly guardados: RegistroEvidencia[] = [];
  readonly pendientes: IntentoDiarioPendiente[] = [];
  readonly guardar = vi.fn(async (l: LoteEvidencia, resultados: Resultado[], proyectar?: ProcesarAceptados) => {
    this.guardados.push(...l.registros);
    await proyectar?.(l.registros, {
      actualizarLatidoPunto: vi.fn(), listarPuntosConLatidoVencido: vi.fn(async () => []),
      marcarSinComunicacion: vi.fn(),
    }, {
      crearSiNoExisteActivo: vi.fn(), resolverActivoPorPunto: vi.fn(),
      listar: vi.fn(async () => []), obtener: vi.fn(async () => null),
    }, {
      registrarPendiente: vi.fn(async (intento: IntentoDiarioPendiente) => { this.pendientes.push(intento); }),
    });
    this.acuses.set(l.idLote, {
      idLote: l.idLote, recibidoEn: l.emitidoEn, repetido: false,
      aceptados: resultados.length, duplicados: 0, resultados,
    });
  });
  async yaProcesado(idLote: string): Promise<AcuseLoteEvidencia | null> {
    return this.acuses.get(idLote) ?? null;
  }
  guardarLoteYRegistros = this.guardar;
}

class OutboxDoble implements OutboxPendiente {
  readonly fila: PendienteOutbox = { id: 1, eventoId: EVENTO, creadoEn: new Date(BASE), registro: historico };
  readonly acuses: number[] = [];
  async pendientes(): Promise<PendienteOutbox[]> { return this.acuses.length ? [] : [this.fila]; }
  async registrarAcuse(ids: readonly number[]): Promise<void> { this.acuses.push(...ids); }
  async resumen(): Promise<{ pendientes: number; edadMaxS: number }> {
    return { pendientes: this.acuses.length ? 0 : 1, edadMaxS: 0 };
  }
  async agregar(): Promise<void> {}
}

describe('PU-04: sincronización con dobles de los puertos E1', () => {
  it('PU-04-05 M2 proyecta un intento histórico sin decisión como pendiente, sin aceptación retroactiva', async () => {
    const repo = new LotesDobles();
    const ingesta = new ServicioIngestaEvidencia(repo);
    await ingesta.procesarLote(lote);
    await ingesta.procesarLote(lote);
    expect(repo.pendientes).toEqual([{
      eventoId: EVENTO, idOrigen: historico.idOrigen, referencia: 'COD-001', zonaSolicitada: 'Norte',
      proposito: 'ingreso', puntoId: 'P-01', lectorId: 'LEC-001', motivoLocal: 'SIN_COORDINADOR',
      instanteLector: historico.instanteLector, recibidoEnCoordinador: historico.recibidoEnCoordinador,
      estado: 'pendiente',
    }]);
    expect(repo.pendientes[0]).not.toHaveProperty('admision');
    expect(repo.pendientes[0]).not.toHaveProperty('decision');
  });

  it('PU-04-02 el mismo lote devuelve el mismo acuse sin volver a persistirlo', async () => {
    const repo = new LotesDobles();
    const ingesta = new ServicioIngestaEvidencia(repo);
    const primero = await ingesta.procesarLote(lote);
    expect(await ingesta.procesarLote(lote)).toEqual({ ...primero, repetido: true });
    expect(repo.guardar).toHaveBeenCalledOnce();
    expect(repo.guardados).toEqual([historico]);
  });

  it('PU-04-03 timeout tras la recepción mantiene pendiente el outbox y reintenta el mismo lote', async () => {
    const repo = new LotesDobles();
    const ingesta = new ServicioIngestaEvidencia(repo);
    const outbox = new OutboxDoble();
    const enviados: LoteEvidencia[] = [];
    let perderAcuse = true;
    const despachador = new DespachadorOutbox({
      outbox, latidos: new RegistroLatidos(), v1: new ContadorV1(),
      config: { eventoId: EVENTO, recintoId: 'REC-01', coordinadorId: 'COORD-A', loteEvidenciaMax: 10 },
      estado: () => ({ estado: 'operando', versionPermisos: 4, versionPoliticas: 3 }),
      reloj: { ahora: () => new Date(BASE) },
      generarIdLote: () => 'LOTE-REINTENTO-001',
      cliente: {
        async enviar(l) {
          enviados.push(l);
          const acuse = await ingesta.procesarLote(l);
          if (perderAcuse) throw new Error('timeout del receptor');
          return acuse;
        },
      },
    });
    expect(await despachador.ejecutarCiclo()).toMatchObject({ enviados: 0, pendientes: 1, error: 'timeout del receptor' });
    expect(outbox.acuses).toEqual([]);
    perderAcuse = false;
    expect(await despachador.ejecutarCiclo()).toMatchObject({ enviados: 1, pendientes: 0 });
    expect(enviados).toHaveLength(2);
    expect(enviados[1]).toEqual(enviados[0]);
    expect(outbox.acuses).toEqual([1]);
    expect(repo.guardar).toHaveBeenCalledOnce();
    expect(repo.guardados.filter((r) => r.idOrigen === historico.idOrigen)).toHaveLength(1);
  });

  it('PU-04-05 un intento histórico sin decisión se conserva como intento, no admisión', async () => {
    const repo = new LotesDobles();
    const acuse = await new ServicioIngestaEvidencia(repo).procesarLote(lote);
    expect(acuse).toMatchObject({
      aceptados: 1, resultados: [{ tipo: 'intento-diario', idOrigen: historico.idOrigen, estado: 'aceptado' }],
    });
    expect(repo.guardados).toEqual([historico]);
    expect(repo.guardados.some((r) => r.tipo === 'decision')).toBe(false);
    expect(repo.guardados.some((r) => r.tipo === 'decision' && r.admision)).toBe(false);
  });
});
