import { z } from 'zod';
import { EventoId, Instante, PuntoId, Version, Zona } from './common.ts';

/**
 * P2. Distribución de permisos, C4 (M1) → C2: `GET /v1/permisos?eventoId=&desdeVersion=n`,
 * solicitado por el recinto (HTTPS saliente).
 *
 * - `desdeVersion=0` devuelve una instantánea (`tipo: "instantanea"`) con todas las boletas vigentes
 *   como cambios `alta`; `desdeVersion=n` devuelve los cambios con versión > n (`tipo: "cambios"`).
 * - C2 rechaza firma inválida, paquete de otro evento, retroceso (`hastaVersion` menor que la instalada)
 *   y huecos (`desdeVersion` distinto de su versión instalada); ante un hueco pide de nuevo.
 * - La firma cubre el JSON canónico del paquete sin el campo `firma`.
 * - Sin datos personales: solo referencias técnicas de boleta (privacidad, ADR-009).
 */
export const ConsultaPermisos = z.object({
  eventoId: EventoId,
  desdeVersion: z.coerce.number().int().nonnegative(),
});
export type ConsultaPermisos = z.infer<typeof ConsultaPermisos>;

export const Politicas = z.object({
  version: Version,
  reingresoPermitido: z.boolean(),
  reingresoTrasMin: z.number().int().nonnegative(),
  reingresoSuspendido: z.boolean(),
});
export type Politicas = z.infer<typeof Politicas>;

export const CambioPermiso = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('alta'), version: Version, referencia: z.string().min(1), zona: Zona }),
  z.object({ tipo: z.literal('anulacion'), version: Version, referencia: z.string().min(1), anuladaEn: Instante }),
  z.object({ tipo: z.literal('cambio-zona'), version: Version, referencia: z.string().min(1), zona: Zona }),
]);
export type CambioPermiso = z.infer<typeof CambioPermiso>;

export const Firma = z.object({
  algoritmo: z.enum(['HMAC-SHA256', 'Ed25519']),
  /** Identificador de la clave usada. */
  kid: z.string().min(1),
  /** Firma en base64url. */
  valor: z.string().min(1),
});
export type Firma = z.infer<typeof Firma>;

export const PaquetePermisos = z.object({
  eventoId: EventoId,
  origen: z.string().min(1), // p. ej. "M1 · TaquillaAndina"
  tipo: z.enum(['instantanea', 'cambios']),
  desdeVersion: Version,
  hastaVersion: Version,
  emitidoEn: Instante,
  vigenteHasta: Instante,
  ventana: z.object({ aperturaEn: Instante, cierreEn: Instante }),
  politicas: Politicas,
  puntos: z.array(z.object({ puntoId: PuntoId, zonas: z.array(Zona).min(1) })),
  cambios: z.array(CambioPermiso),
  firma: Firma,
});
export type PaquetePermisos = z.infer<typeof PaquetePermisos>;
