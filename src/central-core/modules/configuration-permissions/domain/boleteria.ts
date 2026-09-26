import type { VersionBoleteria } from '@nexo/shared/contracts';

/**
 * Traducción C3 (ADR-007): el modelo externo de la boletería (localidades, emisiones) se convierte
 * al modelo canónico de M1 (zonas, permisos). Los datos del comprador se descartan aquí y nunca
 * llegan a D2 (control de preparación `privacidad`).
 */
export type OperacionCanonica = 'emision' | 'anulacion' | 'cambio-zona';

export interface CambioCanonico {
  operacion: OperacionCanonica;
  referencia: string;
  zonaId: string;
  instante: string;
}

export class LocalidadDesconocida extends Error {
  readonly localidad: string;
  constructor(localidad: string) {
    super(`La localidad "${localidad}" de la boletería no corresponde a ninguna zona del evento`);
    this.name = 'LocalidadDesconocida';
    this.localidad = localidad;
  }
}

/** Compara localidad externa y nombre de zona sin mayúsculas, tildes ni espacios. */
export function normalizarLocalidad(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** `zonasPorLocalidad`: nombre de zona normalizado → id interno de zona en D2. */
export function traducirVersion(version: VersionBoleteria, zonasPorLocalidad: ReadonlyMap<string, string>): CambioCanonico[] {
  return version.cambios.map(cambio => {
    const zonaId = zonasPorLocalidad.get(normalizarLocalidad(cambio.localidad));
    if (!zonaId) throw new LocalidadDesconocida(cambio.localidad);
    return {
      operacion: cambio.operacion === 'cambio-localidad' ? 'cambio-zona' : cambio.operacion,
      referencia: cambio.referenciaExterna,
      zonaId,
      instante: cambio.instante,
    };
  });
}

/** Contenido que identifica una versión externa para la idempotencia: sin comprador ni `publicadaEn`. */
export function contenidoIdempotente(version: VersionBoleteria): unknown {
  return {
    numero: version.numero,
    eventoExterno: version.eventoExterno,
    instantanea: version.instantanea,
    cambios: version.cambios.map(c => ({
      operacion: c.operacion, referenciaExterna: c.referenciaExterna, localidad: c.localidad, instante: c.instante,
    })),
  };
}
