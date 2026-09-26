import { IndiceVersiones, RUTAS, VersionBoleteria } from '@nexo/shared/contracts';
import type { FuenteBoleteria } from '../application/index.ts';

export class ErrorP1 extends Error {
  readonly estado: number | null;
  constructor(mensaje: string, estado: number | null = null) {
    super(mensaje);
    this.name = 'ErrorP1';
    this.estado = estado;
  }
}

export interface OpcionesClienteP1 {
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Cliente P1 (`GET /versiones`, `GET /versiones/{n}`) con validación zod de las respuestas. */
export function crearClienteP1Http(baseUrl: string, opciones: OpcionesClienteP1 = {}): FuenteBoleteria {
  const base = baseUrl.replace(/\/+$/, '');
  const timeoutMs = opciones.timeoutMs ?? 5_000;
  const hacerFetch = opciones.fetch ?? globalThis.fetch;

  async function obtener(ruta: string): Promise<unknown> {
    let respuesta: Response;
    try {
      respuesta = await hacerFetch(`${base}${ruta}`, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw new ErrorP1(`Boletería inalcanzable en ${ruta}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (respuesta.status !== 200) {
      throw new ErrorP1(`La boletería respondió ${respuesta.status} en ${ruta}`, respuesta.status);
    }
    return respuesta.json();
  }

  return {
    async indice() {
      const cuerpo = await obtener(RUTAS.versiones.ruta);
      const r = IndiceVersiones.safeParse(cuerpo);
      if (!r.success) throw new ErrorP1('Índice de versiones inválido');
      return r.data;
    },
    async version(numero) {
      const cuerpo = await obtener(RUTAS.version.ruta.replace(':n', String(numero)));
      const r = VersionBoleteria.safeParse(cuerpo);
      if (!r.success) throw new ErrorP1(`Versión ${numero} inválida`);
      return r.data;
    },
  };
}
