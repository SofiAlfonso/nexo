import { describe, expect, it, vi } from 'vitest';
import { AcuseLoteEvidencia, LoteEvidencia } from '@nexo/shared/contracts';
import type { RegistroEvidencia, RegistroLatidoPunto } from '@nexo/shared/contracts';
import type { OutboxPendiente, PendienteOutbox, RegistroOutbox } from '@nexo/shared/domain';
import { DespachadorOutbox } from '../../../src/local-coordinator/application/despachador-outbox.ts';
import type { ClienteE1 } from '../../../src/local-coordinator/application/despachador-outbox.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';

class OutboxMemoria implements OutboxPendiente {
  filas: PendienteOutbox[] = [];
  acuses: number[] = [];

  async pendientes(limite: number): Promise<PendienteOutbox[]> {
    return this.filas.filter((f) => !this.acuses.includes(f.id)).slice(0, limite);
  }
  async registrarAcuse(ids: readonly number[]): Promise<void> {
    this.acuses.push(...ids);
  }
  async resumen(ahora: Date): Promise<{ pendientes: number; edadMaxS: number }> {
    const filas = await this.pendientes(Number.MAX_SAFE_INTEGER);
    return { pendientes: filas.length, edadMaxS: filas.length ? Math.max(0, (ahora.getTime() - filas[0]!.creadoEn.getTime()) / 1000) : 0 };
  }
  async agregar(registros: readonly RegistroOutbox[]): Promise<void> {
    for (const registro of registros) this.filas.push({ ...registro, id: this.filas.length + 1, creadoEn: new Date() });
  }
}

function intento(n: number): RegistroEvidencia {
  return {
    tipo: 'intento-diario', idOrigen: `LECTOR:seq:${n}`, lectorId: 'LECTOR',
    puntoId: 'P-01', codigo: `TICKET-${n}`, zonaSolicitada: 'A',
    proposito: 'ingreso', motivoLocal: 'SIN_COORDINADOR',
    instanteLector: '2026-09-25T12:00:00.000Z', recibidoEnCoordinador: '2026-09-25T12:00:01.000Z',
  };
}

function acuse(lote: LoteEvidencia): AcuseLoteEvidencia {
  return AcuseLoteEvidencia.parse({
    idLote: lote.idLote, recibidoEn: new Date().toISOString(), aceptados: lote.registros.length,
    duplicados: 0, repetido: false,
    resultados: lote.registros.map((r) => ({ tipo: r.tipo, idOrigen: r.idOrigen, estado: 'aceptado' })),
  });
}

function preparar(cantidad = 0, cliente?: ClienteE1, parametros: { loteEvidenciaMax?: number; esperaMaxV1Ms?: number } = {}) {
  const outbox = new OutboxMemoria();
  const latidos = new RegistroLatidos();
  const v1 = new ContadorV1();
  const lotes: LoteEvidencia[] = [];
  const emisor: ClienteE1 = cliente ?? {
    async enviar(lote) { lotes.push(lote); return acuse(lote); },
  };
  const despachador = new DespachadorOutbox({
    outbox, latidos, v1, cliente: emisor,
    config: { eventoId: 'EVT-2026-02', recintoId: 'REC-01', coordinadorId: 'COORD-A', loteEvidenciaMax: parametros.loteEvidenciaMax ?? 100 },
    estado: () => ({ estado: 'operando', versionPermisos: 2, versionPoliticas: 3 }),
    intervaloMs: 10, esperaMaxV1Ms: parametros.esperaMaxV1Ms ?? 20,
  });
  const llenar = async () => {
    await outbox.agregar(Array.from({ length: cantidad }, (_, n) => ({ eventoId: 'EVT-2026-02', registro: intento(n) })));
  };
  return { outbox, latidos, v1, despachador, lotes, llenar };
}

describe('DespachadorOutbox', () => {
  it('drena 250 pendientes en tres lotes válidos de hasta 100, sin duplicar acuses', async () => {
    const { outbox, despachador, lotes, llenar } = preparar(250);
    await llenar();
    for (let i = 0; i < 3; i++) await despachador.ejecutarCiclo();
    expect(lotes).toHaveLength(3);
    expect(lotes.map((l) => l.registros.length)).toEqual([100, 100, 53]);
    expect(lotes.every((l) => LoteEvidencia.safeParse(l).success)).toBe(true);
    expect(new Set(outbox.acuses).size).toBe(250);
    expect(outbox.acuses).toHaveLength(250);
    expect(despachador.metricas()).toMatchObject({ pendientes: 0, fallosConsecutivos: 0, enLinea: true });
  });

  it('retiene el lote durante la caída, sin acusar filas, y lo reintenta idéntico al recuperarse', async () => {
    const lotes: LoteEvidencia[] = [];
    let caido = true;
    const cliente: ClienteE1 = {
      async enviar(lote) {
        lotes.push(lote);
        if (caido) throw new Error('red caída');
        return acuse(lote);
      },
    };
    const { outbox, despachador, llenar } = preparar(3, cliente);
    await llenar();
    await despachador.ejecutarCiclo();
    await despachador.ejecutarCiclo();
    expect(outbox.acuses).toHaveLength(0);
    expect(despachador.metricas()).toMatchObject({ pendientes: 3, fallosConsecutivos: 2, enLinea: false });
    await outbox.agregar([{ eventoId: 'EVT-2026-02', registro: intento(4) }]);
    caido = false;
    await despachador.ejecutarCiclo();
    await despachador.ejecutarCiclo();
    expect(lotes[0]).toEqual(lotes[1]);
    expect(lotes[1]).toEqual(lotes[2]);
    expect(new Set(lotes.map((l) => l.idLote)).size).toBe(2);
    expect(new Set(outbox.acuses).size).toBe(4);
    expect(despachador.metricas()).toMatchObject({ pendientes: 0, fallosConsecutivos: 0, enLinea: true });
  });

  it('incluye estado y latidos, y limita el estado vacío a un envío por cinco intervalos', async () => {
    const { despachador, latidos, lotes, llenar } = preparar(2);
    await llenar();
    latidos.registrar({
      eventoId: 'EVT-2026-02', lectorId: 'LECTOR', puntoId: 'P-01', secuencia: 1,
      estadoLector: 'operativo', pendientesDiario: 0, diarioTotal: 1, versionPermisos: 1,
      instanteLector: new Date().toISOString(),
    });
    await despachador.ejecutarCiclo();
    const estado = lotes[0]!.registros.find((r) => r.tipo === 'estado-coordinador');
    expect(estado).toMatchObject({ outboxPendientes: 2, versionPermisos: 2, versionPoliticas: 3 });
    expect(lotes[0]!.registros.some((r) => r.tipo === 'latido-punto')).toBe(true);
    await despachador.ejecutarCiclo();
    expect(lotes).toHaveLength(1);
  });

  it('devuelve los latidos que exceden el límite del lote para ciclos posteriores', async () => {
    const { despachador, latidos, lotes } = preparar(0, undefined, { loteEvidenciaMax: 2 });
    for (let n = 1; n <= 3; n++) {
      latidos.registrar({
        eventoId: 'EVT-2026-02', lectorId: `LECTOR${n}`, puntoId: `P-0${n}`, secuencia: 1,
        estadoLector: 'operativo', pendientesDiario: 0, diarioTotal: 1, versionPermisos: 1,
        instanteLector: new Date().toISOString(),
      });
    }
    for (let n = 0; n < 3; n++) await despachador.ejecutarCiclo();
    expect(lotes.flatMap((l) => l.registros.filter((r): r is RegistroLatidoPunto => r.tipo === 'latido-punto'))).toHaveLength(3);
    expect(lotes.every((l) => LoteEvidencia.safeParse(l).success && l.registros.length <= 2)).toBe(true);
  });

  it('cede tiempo a V1 antes del envío', async () => {
    const { despachador, v1, lotes, llenar } = preparar(1, undefined, { esperaMaxV1Ms: 30 });
    await llenar();
    const terminar = v1.iniciar();
    const inicio = Date.now();
    await despachador.ejecutarCiclo();
    terminar();
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(25);
    expect(lotes).toHaveLength(1);
  });

  it('reduce a la mitad el lote tras un HTTP 413 y reconstruye un lote válido', async () => {
    const lotes: LoteEvidencia[] = [];
    const cliente: ClienteE1 = {
      async enviar(lote) {
        lotes.push(lote);
        if (lotes.length === 1) throw Object.assign(new Error('E1 HTTP 413'), { status: 413 });
        return acuse(lote);
      },
    };
    const { despachador, outbox, llenar } = preparar(8, cliente, { loteEvidenciaMax: 10 });
    await llenar();
    expect((await despachador.ejecutarCiclo()).error).toContain('413');
    expect(outbox.acuses).toHaveLength(0);
    await despachador.ejecutarCiclo();
    expect(lotes.map((l) => l.registros.length)).toEqual([9, 5]);
    expect(lotes[0]!.idLote).not.toBe(lotes[1]!.idLote);
    expect(LoteEvidencia.safeParse(lotes[1]).success).toBe(true);
    expect(outbox.acuses).toHaveLength(4);
  });

  it('no acusa filas si el acuse válido pertenece a otro lote', async () => {
    const { despachador, outbox, llenar } = preparar(1, {
      async enviar(lote) {
        return acuse({ ...lote, idLote: 'LOTE-AJENO-1234' });
      },
    });
    await llenar();
    expect((await despachador.ejecutarCiclo()).error).toContain('no corresponde');
    expect(outbox.acuses).toHaveLength(0);
    expect(despachador.metricas().enLinea).toBe(false);
  });

  it('el lazo en segundo plano se detiene sin lanzar tras fallos', async () => {
    const { despachador, llenar } = preparar(1, { enviar: vi.fn().mockRejectedValue(new Error('offline')) });
    await llenar();
    despachador.iniciar();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await despachador.detener();
    expect(despachador.metricas().enLinea).toBe(false);
  });

  it('incrementa el backoff de los reintentos del lazo y conserva el mismo lote', async () => {
    vi.useFakeTimers();
    const aleatorio = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const instantes: number[] = [];
      const lotes: LoteEvidencia[] = [];
      const { despachador, llenar } = preparar(1, {
        async enviar(lote) {
          instantes.push(Date.now());
          lotes.push(lote);
          throw new Error('offline');
        },
      });
      await llenar();
      despachador.iniciar();
      await vi.advanceTimersByTimeAsync(2300);
      await despachador.detener();
      expect(instantes).toEqual([instantes[0], instantes[0]! + 750, instantes[0]! + 2250]);
      expect(new Set(lotes.map((l) => l.idLote)).size).toBe(1);
      expect(despachador.metricas().fallosConsecutivos).toBe(3);
    } finally {
      aleatorio.mockRestore();
      vi.useRealTimers();
    }
  });
});
