import { AcuseLoteEvidencia, RUTAS } from '@nexo/shared/contracts';
import type { LoteEvidencia } from '@nexo/shared/contracts';
import { conSpan, inyectarCabeceras, SpanKind, trace } from '@nexo/shared/telemetry';
import type { ClienteE1 } from '../../application/despachador-outbox.ts';

const tracer = trace.getTracer('nexo.local-coordinator');

export function crearClienteE1Http(
  centralUrl: string,
  opciones: { timeoutMs?: number; fetch?: typeof fetch } = {},
): ClienteE1 {
  return {
    async enviar(lote: LoteEvidencia, signal?: AbortSignal) {
      return conSpan(tracer, 'evidence.dispatch', async (span) => {
        span.setAttributes({ 'nexo.id_lote': lote.idLote, 'nexo.registros': lote.registros.length });
        const combinada = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(opciones.timeoutMs ?? 5000)])
          : AbortSignal.timeout(opciones.timeoutMs ?? 5000);
        // W3C Trace Context (T40): permite a C4 enlazar el span de recepción ('evidence.receive')
        // con este despacho, aunque el envío sea asíncrono respecto de las validaciones que agrupa.
        const cabeceras = inyectarCabeceras({ 'content-type': 'application/json' });
        const respuesta = await (opciones.fetch ?? fetch)(`${centralUrl.replace(/\/+$/, '')}${RUTAS.loteEvidencia.ruta}`, {
          method: 'POST',
          headers: cabeceras,
          body: JSON.stringify(lote),
          signal: combinada,
        });
        if (!respuesta.ok) {
          throw Object.assign(new Error(`E1 HTTP ${respuesta.status}`), { status: respuesta.status });
        }
        return AcuseLoteEvidencia.parse(await respuesta.json());
      }, { kind: SpanKind.CLIENT });
    },
  };
}
