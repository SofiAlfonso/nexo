import type { CambioPermiso } from '@nexo/shared/contracts';
import type { PuntoConfigurado } from '../domain/index.ts';
import type { EventoConfigurado } from '../domain/index.ts';

export interface EventoConfigRepositorio {
  obtenerEventoActual(): Promise<EventoConfigurado | null>;
  obtenerVersionPermisosVigente(eventoId: string): Promise<number>;
}

export interface PuntoConfigRepositorio {
  listarPuntosConfig(eventoId: string): Promise<PuntoConfigurado[]>;
}

export interface PermisosRepositorio {
  obtenerCambiosDesde(
    eventoId: string,
    desdeVersion: number,
    hastaVersion: number,
  ): Promise<{ hastaVersion: number; cambios: CambioPermiso[] }>;
}
