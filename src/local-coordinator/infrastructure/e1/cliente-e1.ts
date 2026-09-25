import { AcuseLoteEvidencia, RUTAS } from '@nexo/shared/contracts';
import type { LoteEvidencia } from '@nexo/shared/contracts';
import type { ClienteE1 } from '../../application/despachador-outbox.ts';

export function crearClienteE1Http(
  centralUrl: string,
  opciones: { timeoutMs?: number; fetch?: typeof fetch } = {},
): ClienteE1 {
  return {
    async enviar(lote: LoteEvidencia, signal?: AbortSignal) {
      const combinada = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(opciones.timeoutMs ?? 5000)])
        : AbortSignal.timeout(opciones.timeoutMs ?? 5000);
      const respuesta = await (opciones.fetch ?? fetch)(`${centralUrl.replace(/\/+$/, '')}${RUTAS.loteEvidencia.ruta}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(lote),
        signal: combinada,
      });
      if (!respuesta.ok) {
        throw Object.assign(new Error(`E1 HTTP ${respuesta.status}`), { status: respuesta.status });
      }
      return AcuseLoteEvidencia.parse(await respuesta.json());
    },
  };
}
