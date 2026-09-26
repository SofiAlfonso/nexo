import { PaquetePermisos, RUTAS } from '@nexo/shared/contracts';

export class ErrorP2 extends Error {
  readonly estado: number;

  constructor(mensaje: string, estado: number) {
    super(mensaje);
    this.name = 'ErrorP2';
    this.estado = estado;
  }
}

export function crearClienteP2Http(
  centralUrl: string,
  opciones: { timeoutMs?: number; fetch?: typeof globalThis.fetch } = {},
): { obtener(eventoId: string, desdeVersion: number): Promise<PaquetePermisos> } {
  const { timeoutMs = 5_000, fetch: solicitar = globalThis.fetch } = opciones;
  return {
    async obtener(eventoId, desdeVersion) {
      const url = new URL(RUTAS.permisos.ruta, `${centralUrl.replace(/\/+$/, '')}/`);
      url.search = new URLSearchParams({ eventoId, desdeVersion: String(desdeVersion) }).toString();
      const respuesta = await solicitar(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (respuesta.status !== RUTAS.permisos.estado) {
        let mensaje = `P2 respondió HTTP ${respuesta.status}`;
        try {
          const cuerpo: unknown = await respuesta.json();
          if (cuerpo && typeof cuerpo === 'object' && 'mensaje' in cuerpo && typeof cuerpo.mensaje === 'string') {
            mensaje = cuerpo.mensaje;
          }
        } catch { /* Una respuesta de error sin JSON conserva el código HTTP. */ }
        throw new ErrorP2(mensaje, respuesta.status);
      }
      try {
        return PaquetePermisos.parse(await respuesta.json());
      } catch {
        throw new ErrorP2('Paquete P2 inválido', respuesta.status);
      }
    },
  };
}
