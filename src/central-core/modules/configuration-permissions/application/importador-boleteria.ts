import { createHash } from 'node:crypto';
import type { IndiceVersiones, VersionBoleteria } from '@nexo/shared/contracts';
import { contenidoIdempotente, traducirVersion, type CambioCanonico } from '../domain/index.ts';
import { canonicalizar } from './firma.ts';
import type { EventoConfigRepositorio } from './puertos.ts';

/** P1: lectura de la boletería externa (HTTP en producción, doble en pruebas). */
export interface FuenteBoleteria {
  indice(): Promise<IndiceVersiones>;
  version(numero: number): Promise<VersionBoleteria>;
}

export interface ImportacionRegistrada {
  eventoExterno: string;
  versionExterna: number;
  huella: string;
}

export interface SolicitudImportacion {
  eventoId: string;
  eventoExterno: string;
  versionExterna: number;
  huella: string;
  instantanea: boolean;
  cambios: CambioCanonico[];
  recibidoEn: Date;
}

export interface ResultadoImportacion {
  repetida: boolean;
  versionPermisosDesde: number;
  versionPermisosHasta: number;
  cambiosAplicados: number;
}

export interface ImportacionesRepositorio {
  ultimaImportacion(eventoId: string): Promise<ImportacionRegistrada | null>;
  huellaImportada(eventoId: string, versionExterna: number): Promise<string | null>;
  /** Nombre de zona normalizado → id de zona del evento. */
  zonasPorLocalidad(eventoId: string): Promise<Map<string, string>>;
  /** Aplica una versión externa en una transacción de D2: todo o nada, idempotente por (evento, versión externa). */
  importar(solicitud: SolicitudImportacion): Promise<ResultadoImportacion>;
}

export class ConflictoImportacion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ConflictoImportacion';
  }
}

export type ResultadoSincronizacionBoleteria =
  | { resultado: 'sin-evento' }
  | { resultado: 'al-dia'; versionExterna: number | null; versionPermisos: number }
  | { resultado: 'importado'; versiones: number[]; versionPermisos: number; cambiosAplicados: number }
  | { resultado: 'conflicto' | 'error'; mensaje: string };

export function huellaVersion(version: VersionBoleteria): string {
  return createHash('sha256').update(canonicalizar(contenidoIdempotente(version)), 'utf8').digest('hex');
}

/**
 * Adaptador C3 dentro de M1: sondea P1, traduce al modelo canónico y deja en D2 las versiones de
 * permisos que P2 distribuye a C2. C3 no decide ingresos; solo propaga emisiones y anulaciones.
 */
export class ServicioImportacionBoleteria {
  private readonly fuente: FuenteBoleteria;
  private readonly eventos: EventoConfigRepositorio;
  private readonly importaciones: ImportacionesRepositorio;
  private readonly eventoExterno: string;
  private readonly ahora: () => Date;

  constructor(
    fuente: FuenteBoleteria,
    eventos: EventoConfigRepositorio,
    importaciones: ImportacionesRepositorio,
    eventoExterno: string,
    ahora: () => Date = () => new Date(),
  ) {
    this.fuente = fuente;
    this.eventos = eventos;
    this.importaciones = importaciones;
    this.eventoExterno = eventoExterno;
    this.ahora = ahora;
  }

  async sincronizar(): Promise<ResultadoSincronizacionBoleteria> {
    try {
      return await this.sincronizarOFallar();
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      return { resultado: error instanceof ConflictoImportacion ? 'conflicto' : 'error', mensaje };
    }
  }

  private async sincronizarOFallar(): Promise<ResultadoSincronizacionBoleteria> {
    const evento = await this.eventos.obtenerEventoActual();
    if (!evento) return { resultado: 'sin-evento' };
    const indice = await this.fuente.indice();
    if (indice.boleteria !== evento.boleteria || indice.eventoExterno !== this.eventoExterno) {
      throw new ConflictoImportacion(
        `La boletería publica ${indice.boleteria}/${indice.eventoExterno}; se esperaba ${evento.boleteria}/${this.eventoExterno}`,
      );
    }
    const ultima = await this.importaciones.ultimaImportacion(evento.id);
    if (ultima && ultima.eventoExterno !== this.eventoExterno) {
      throw new ConflictoImportacion(`El evento ${evento.id} ya importa el evento externo ${ultima.eventoExterno}`);
    }
    if (ultima) {
      // Una boletería reiniciada que vuelve a numerar versiones no puede reescribir lo ya importado.
      if (indice.ultimaVersion < ultima.versionExterna) {
        throw new ConflictoImportacion(`La boletería retrocedió a la versión ${indice.ultimaVersion}; ya se importó la ${ultima.versionExterna}`);
      }
      const publicada = await this.fuente.version(ultima.versionExterna);
      if (huellaVersion(publicada) !== ultima.huella) {
        throw new ConflictoImportacion(`La versión ${ultima.versionExterna} de la boletería cambió de contenido`);
      }
    }
    const pendientes = indice.versiones.map(v => v.numero)
      .filter(n => ultima === null || n > ultima.versionExterna)
      .sort((a, b) => a - b);
    if (pendientes.length === 0) {
      const version = await this.eventos.obtenerVersionPermisosVigente(evento.id);
      return { resultado: 'al-dia', versionExterna: ultima?.versionExterna ?? null, versionPermisos: version };
    }
    const zonas = await this.importaciones.zonasPorLocalidad(evento.id);
    const importadas: number[] = [];
    let cambiosAplicados = 0;
    let versionPermisos = 0;
    for (const numero of pendientes) {
      const version = await this.fuente.version(numero);
      if (version.numero !== numero || version.eventoExterno !== this.eventoExterno) {
        throw new ConflictoImportacion(`La versión ${numero} no corresponde a ${this.eventoExterno}`);
      }
      const resultado = await this.importaciones.importar({
        eventoId: evento.id,
        eventoExterno: this.eventoExterno,
        versionExterna: numero,
        huella: huellaVersion(version),
        instantanea: version.instantanea,
        cambios: traducirVersion(version, zonas),
        recibidoEn: this.ahora(),
      });
      importadas.push(numero);
      cambiosAplicados += resultado.cambiosAplicados;
      versionPermisos = resultado.versionPermisosHasta;
    }
    return { resultado: 'importado', versiones: importadas, versionPermisos, cambiosAplicados };
  }
}
