import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PaquetePermisos } from '@nexo/shared/contracts';
import { canonicalizar } from './firma.ts';
import { SincronizadorPermisos } from './sincronizador.ts';

function paquete(eventoId = 'EVT-2026-02'): PaquetePermisos {
  const contenido: Omit<PaquetePermisos, 'firma'> = {
    eventoId, origen: 'M1', tipo: 'cambios', desdeVersion: 37, hastaVersion: 38,
    emitidoEn: '2026-09-25T12:00:00Z', vigenteHasta: '2026-09-25T12:05:00Z',
    ventana: { aperturaEn: '2026-09-25T11:00:00Z', cierreEn: '2026-09-26T01:00:00Z' },
    politicas: { version: 1, reingresoPermitido: false, reingresoTrasMin: 0, reingresoSuspendido: false },
    puntos: [], cambios: [{ tipo: 'alta', version: 38, referencia: 'A', zona: 'Norte' }],
  };
  return { ...contenido, firma: { algoritmo: 'HMAC-SHA256', kid: 'm1-v1',
    valor: createHmac('sha256', 'clave').update(canonicalizar(contenido)).digest('base64url') } };
}

function crear(obtener = vi.fn().mockResolvedValue(paquete()), instalar = vi.fn().mockResolvedValue({
  resultado: 'instalado', versionAnterior: 37, versionInstalada: 38, cambiosAplicados: 1, anulaciones: 0,
})) {
  const versionInstalada = vi.fn().mockResolvedValue(37);
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sincronizador = new SincronizadorPermisos({
    eventoId: 'EVT-2026-02', cliente: { obtener }, instalar, versionInstalada,
    secreto: 'clave', intervaloMs: 10_000, log, ahora: () => new Date('2026-09-25T12:00:01Z'),
  });
  return { sincronizador, obtener, instalar, versionInstalada, log };
}

describe('sincronizador P2', () => {
  it('instala y expone edad y versión', async () => {
    const { sincronizador, instalar, log } = crear();
    expect((await sincronizador.sincronizar()).resultado).toBe('instalado');
    expect(instalar).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledOnce();
    expect(sincronizador.estado(new Date('2026-09-25T12:00:11Z')))
      .toMatchObject({ versionInstalada: 38, antiguedadPermisosS: 10, ultimoError: null });
  });
  it('rechaza firma y evento ajeno sin instalar', async () => {
    const p = paquete();
    const invalido = crear(vi.fn().mockResolvedValue({ ...p, cambios: [] }));
    expect((await invalido.sincronizador.sincronizar()).resultado).toBe('firma-invalida');
    expect(invalido.instalar).not.toHaveBeenCalled();
    const ajeno = crear(vi.fn().mockResolvedValue(paquete('EVT-2026-03')));
    expect((await ajeno.sincronizador.sincronizar()).resultado).toBe('otro-evento');
    expect(ajeno.instalar).not.toHaveBeenCalled();
  });
  it('reintenta un hueco exactamente una vez con versión actualizada', async () => {
    const instalar = vi.fn().mockResolvedValueOnce({
      resultado: 'hueco', versionAnterior: 39, versionInstalada: 39, cambiosAplicados: 0, anulaciones: 0,
    }).mockResolvedValueOnce({
      resultado: 'instalado', versionAnterior: 39, versionInstalada: 40, cambiosAplicados: 1, anulaciones: 0,
    });
    const { sincronizador, obtener, versionInstalada } = crear(undefined, instalar);
    versionInstalada.mockResolvedValueOnce(37).mockResolvedValueOnce(39);
    expect((await sincronizador.sincronizar()).resultado).toBe('instalado');
    expect(obtener.mock.calls.map(c => c[1])).toEqual([37, 39]);
  });
  it('convierte errores en estado sin lanzarlos y evita ejecuciones simultáneas', async () => {
    let resolver!: (p: PaquetePermisos) => void;
    const obtener = vi.fn().mockImplementationOnce(() => new Promise<PaquetePermisos>(resolve => { resolver = resolve; }))
      .mockRejectedValueOnce(new Error('sin red'));
    const { sincronizador, instalar } = crear(obtener);
    const primera = sincronizador.sincronizar();
    const segunda = sincronizador.sincronizar();
    await vi.waitFor(() => expect(resolver).toBeDefined());
    resolver(paquete());
    expect((await primera).resultado).toBe('instalado');
    expect((await segunda).resultado).toBe('instalado');
    expect(instalar).toHaveBeenCalledOnce();
    expect((await sincronizador.sincronizar()).resultado).toBe('error');
    expect(sincronizador.estado().ultimoError).toBe('sin red');
  });
  it('detener espera el trabajo iniciado inmediatamente', async () => {
    let resolver!: (p: PaquetePermisos) => void;
    const { sincronizador } = crear(vi.fn().mockImplementation(() => new Promise<PaquetePermisos>(resolve => { resolver = resolve; })));
    sincronizador.iniciar();
    await vi.waitFor(() => expect(resolver).toBeDefined());
    const detener = sincronizador.detener();
    resolver(paquete());
    await detener;
  });
});
