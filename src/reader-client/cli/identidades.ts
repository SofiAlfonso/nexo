import { EventoId, LectorId, PuntoId, Zona } from '@nexo/shared/contracts';
import type { PerfilCarga } from '../load/index.ts';

export interface Identidad {
  lectorId: string;
  puntoId: string;
  eventoId: string;
  zonas: string[];
}

export function identidades(archivo: unknown, perfil: PerfilCarga): Identidad[] {
  if (typeof archivo === 'object' && archivo !== null && 'lectores' in archivo && Array.isArray(archivo.lectores)) {
    const resultado = archivo.lectores.map((item: unknown) => {
      if (typeof item !== 'object' || item === null ||
        !('lectorId' in item) || typeof item.lectorId !== 'string' ||
        !('puntoId' in item) || typeof item.puntoId !== 'string' ||
        !('eventoId' in item) || typeof item.eventoId !== 'string' ||
        !('zonas' in item) || !Array.isArray(item.zonas) ||
        !item.zonas.every((z: unknown) => typeof z === 'string')) {
        throw new Error('Identidad de lector inválida en la exportación');
      }
      return {
        lectorId: LectorId.parse(item.lectorId),
        puntoId: PuntoId.parse(item.puntoId),
        eventoId: EventoId.parse(item.eventoId),
        zonas: item.zonas.map((zona: string) => Zona.parse(zona)),
      };
    });
    const seleccionados = resultado.filter((item) => perfil.eventos.includes(item.eventoId));
    if (seleccionados.length < perfil.lectores) {
      throw new Error(`Exportación con ${seleccionados.length} lectores, se requieren ${perfil.lectores}`);
    }
    if (new Set(seleccionados.map((item) => item.lectorId)).size !== seleccionados.length) {
      throw new Error('La exportación contiene lectores duplicados');
    }
    const porEvento = new Map(perfil.eventos.map((eventoId) => [
      eventoId, seleccionados.filter((item) => item.eventoId === eventoId),
    ] as const));
    const identidadesElegidas: Identidad[] = [];
    for (let indice = 0; indice < perfil.lectores; indice++) {
      const eventoId = perfil.eventos[indice % perfil.eventos.length]!;
      const identidad = porEvento.get(eventoId)?.shift();
      if (!identidad) throw new Error(`No hay suficientes lectores para el evento ${eventoId}`);
      identidadesElegidas.push(identidad);
    }
    return identidadesElegidas;
  }
  return Array.from({ length: perfil.lectores }, (_, indice) => ({
    lectorId: `LX-2210-${String(indice + 1).padStart(4, '0')}`,
    puntoId: `P-${String(indice % 20 + 1).padStart(2, '0')}`,
    eventoId: perfil.eventos[indice % perfil.eventos.length]!,
    zonas: [perfil.zonas[Math.floor(indice / perfil.eventos.length) % perfil.zonas.length]!],
  }));
}
