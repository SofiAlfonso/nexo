import type { PaquetePermisos } from '@nexo/shared/contracts';
import type { EventoConfigRepositorio, PermisosRepositorio, PuntoConfigRepositorio } from './puertos.ts';
import { firmarPaquete } from './firma.ts';

export class EventoPermisosNoEncontrado extends Error {
  constructor(eventoId: string) {
    super(`No se encontró el evento actual ${eventoId}`);
    this.name = 'EventoPermisosNoEncontrado';
  }
}

export class VersionPermisosInvalida extends Error {
  constructor() {
    super('La versión solicitada supera la versión vigente');
    this.name = 'VersionPermisosInvalida';
  }
}

export class ServicioPermisos {
  private readonly eventos: EventoConfigRepositorio;
  private readonly puntos: PuntoConfigRepositorio;
  private readonly permisos: PermisosRepositorio;
  private readonly secreto: string;
  private readonly ahora: () => Date;

  constructor(
    eventos: EventoConfigRepositorio,
    puntos: PuntoConfigRepositorio,
    permisos: PermisosRepositorio,
    secreto: string,
    ahora: () => Date = () => new Date(),
  ) {
    if (!secreto) throw new Error('La clave de firma de permisos no puede estar vacía');
    this.eventos = eventos;
    this.puntos = puntos;
    this.permisos = permisos;
    this.secreto = secreto;
    this.ahora = ahora;
  }

  async construirPaquete(eventoId: string, desdeVersion: number): Promise<PaquetePermisos> {
    const evento = await this.eventos.obtenerEventoActual();
    if (!evento || evento.id !== eventoId) throw new EventoPermisosNoEncontrado(eventoId);
    const hastaVersion = await this.eventos.obtenerVersionPermisosVigente(eventoId);
    if (!Number.isSafeInteger(desdeVersion) || desdeVersion < 0 || desdeVersion > hastaVersion) {
      throw new VersionPermisosInvalida();
    }
    const [puntos, permisos] = await Promise.all([
      this.puntos.listarPuntosConfig(eventoId),
      this.permisos.obtenerCambiosDesde(eventoId, desdeVersion, hastaVersion),
    ]);
    if (permisos.hastaVersion !== hastaVersion) throw new VersionPermisosInvalida();
    const ahora = this.ahora();
    const sinFirma: Omit<PaquetePermisos, 'firma'> = {
      eventoId,
      origen: `M1 · ${evento.boleteria}`,
      tipo: desdeVersion === 0 ? 'instantanea' : 'cambios',
      desdeVersion,
      hastaVersion,
      emitidoEn: ahora.toISOString(),
      // La vigencia de transporte dura cinco minutos; C2 decide localmente cuándo renovar.
      vigenteHasta: new Date(ahora.getTime() + 5 * 60_000).toISOString(),
      ventana: { aperturaEn: evento.aperturaEn, cierreEn: evento.cierreEn },
      politicas: evento.politicas,
      puntos: puntos.map(punto => ({ puntoId: punto.id, zonas: punto.zonas })),
      cambios: permisos.cambios,
    };
    return { ...sinFirma, firma: firmarPaquete(sinFirma, this.secreto) };
  }
}
