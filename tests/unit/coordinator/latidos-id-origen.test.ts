import { describe, expect, it } from 'vitest';
import { RegistroLatidos, idOrigenLatido } from '../../../src/local-coordinator/application/latidos.ts';

const latido = (secuencia: number, instanteLector: string) => ({
  eventoId: 'EVT-2026-02', lectorId: 'LECTOR-01', puntoId: 'P-01', secuencia,
  estadoLector: 'operativo' as const, pendientesDiario: 0, diarioTotal: 1, versionPermisos: 1, instanteLector,
});

describe('idOrigen de latidos E1', () => {
  it('el mismo latido reintentado conserva el idOrigen', () => {
    const registro = new RegistroLatidos();
    registro.registrar(latido(7, '2026-09-25T12:00:00.000Z'));
    const [primero] = registro.tomarPendientes();
    registro.devolver([primero!]);
    const [reintento] = registro.tomarPendientes();
    expect(reintento).toEqual(primero);
    expect(primero!.idOrigen).toBe('LECTOR-01:latido:7:2026-09-25T12:00:00.000Z');
  });

  it('tras reiniciar la secuencia del lector, el idOrigen es distinto', () => {
    const antes = idOrigenLatido(latido(1, '2026-09-25T12:00:00.000Z'));
    const despues = idOrigenLatido(latido(1, '2026-09-25T12:30:00.000Z'));
    expect(despues).not.toBe(antes);
  });
});
