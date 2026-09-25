import { describe, expect, it, vi } from 'vitest';
import { LoteEvidencia } from '@nexo/shared/contracts';
import { crearClienteE1Http } from '../../../src/local-coordinator/infrastructure/e1/cliente-e1.ts';

const lote = LoteEvidencia.parse({
  idLote: 'COORD-A-123456', eventoId: 'EVT-2026-02', recintoId: 'REC-01',
  coordinadorId: 'COORD-A', emitidoEn: '2026-09-25T12:00:00.000Z',
  registros: [{
    tipo: 'estado-coordinador', idOrigen: 'COORD-A:estado:123456',
    coordinadorId: 'COORD-A', estado: 'operando', instante: '2026-09-25T12:00:00.000Z',
    versionPermisos: 1, versionPoliticas: 1, outboxPendientes: 0, outboxEdadMaxS: 0,
  }],
});

describe('crearClienteE1Http', () => {
  it('envía el JSON a E1 con POST y valida el acuse', async () => {
    const acuse = {
      idLote: lote.idLote, recibidoEn: '2026-09-25T12:00:01.000Z',
      aceptados: 1, duplicados: 0, repetido: false,
      resultados: [{ tipo: 'estado-coordinador', idOrigen: lote.registros[0]!.idOrigen, estado: 'aceptado' }],
    };
    const fetchFalso = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(acuse), { status: 200 }));
    const cliente = crearClienteE1Http('http://central:8080/', { fetch: fetchFalso });
    expect(await cliente.enviar(lote)).toEqual(acuse);
    expect(fetchFalso).toHaveBeenCalledWith('http://central:8080/v1/lotes-evidencia', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(lote), signal: expect.any(AbortSignal),
    }));
  });

  it('expone el status de respuestas no exitosas y rechaza acuses inválidos', async () => {
    const fetchFalso = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 413 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const cliente = crearClienteE1Http('http://central:8080', { fetch: fetchFalso });
    await expect(cliente.enviar(lote)).rejects.toMatchObject({ status: 413, message: 'E1 HTTP 413' });
    await expect(cliente.enviar(lote)).rejects.toThrow();
  });
});
