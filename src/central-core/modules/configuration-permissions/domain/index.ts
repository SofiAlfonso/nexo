import type { Evento, Politicas } from '@nexo/shared/contracts';

export type EventoConfigurado = Evento & {
  aperturaEn: string;
  cierreEn: string;
};
export type PoliticasEvento = Politicas;

export interface PuntoConfigurado {
  id: string;
  nombre: string;
  zona: string;
  zonas: string[];
}
