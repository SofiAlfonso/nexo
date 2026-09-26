import { describe, expect, it, vi } from 'vitest';
import { crearClienteP2Http, ErrorP2 } from './cliente-p2.ts';

describe('cliente HTTP P2', () => {
  it('envía los parámetros codificados y valida el contrato de respuesta', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ eventoId: 'incorrecto' }), { status: 200 }));
    const cliente = crearClienteP2Http('https://central.example/', { fetch });
    await expect(cliente.obtener('EVT-2026-02', 37)).rejects.toMatchObject({
      name: 'ErrorP2', estado: 200, message: 'Paquete P2 inválido',
    });
    expect(String(fetch.mock.calls[0]![0])).toBe('https://central.example/v1/permisos?eventoId=EVT-2026-02&desdeVersion=37');
    expect(fetch.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal);
  });
  it('propaga el mensaje y estado HTTP de un error remoto', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ mensaje: 'Versión adelantada' }), { status: 409 }));
    await expect(crearClienteP2Http('https://central.example', { fetch }).obtener('EVT-2026-02', 42))
      .rejects.toEqual(new ErrorP2('Versión adelantada', 409));
  });
  it('no acepta un estado exitoso diferente al del contrato', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    await expect(crearClienteP2Http('https://central.example', { fetch }).obtener('EVT-2026-02', 37))
      .rejects.toMatchObject({ estado: 201 });
  });
});
