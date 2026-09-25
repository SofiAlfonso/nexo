import { z } from 'zod';
import { Instante } from './common.ts';

/**
 * P1. Importación desde la boletería (externa, simulada en `src/ticketing-sim`) hacia C3 (dentro de M1).
 *
 * - `GET /versiones`: índice de versiones publicadas.
 * - `GET /versiones/{n}`: cambios de la versión n. Repetir versión y contenido es idempotente y nunca
 *   reinicia consumos (T2 §5.4).
 *
 * Es el modelo EXTERNO de la boletería (localidades, emisiones); C3 lo traduce al modelo canónico
 * (zonas, permisos, versión) dentro de M1. La boletería puede enviar datos del comprador: C3 los
 * descarta antes de guardar nada (control de preparación `privacidad`).
 */
export const IndiceVersiones = z.object({
  boleteria: z.string().min(1), // "TaquillaAndina"
  eventoExterno: z.string().min(1),
  ultimaVersion: z.number().int().nonnegative(),
  versiones: z.array(
    z.object({
      numero: z.number().int().nonnegative(),
      publicadaEn: Instante,
      cambios: z.number().int().nonnegative(),
    }),
  ),
});
export type IndiceVersiones = z.infer<typeof IndiceVersiones>;

export const Comprador = z.object({
  nombre: z.string().optional(),
  documento: z.string().optional(),
  correo: z.string().optional(),
});

export const CambioBoleteria = z.object({
  operacion: z.enum(['emision', 'anulacion', 'cambio-localidad']),
  referenciaExterna: z.string().min(1), // "TA-88dd-dddd"
  localidad: z.string().min(1), // "NORTE", "SUR", "ORIENTAL", "OCCIDENTAL", "PALCOS"
  instante: Instante,
  /** Datos personales que C3 debe descartar. */
  comprador: Comprador.optional(),
});
export type CambioBoleteria = z.infer<typeof CambioBoleteria>;

export const VersionBoleteria = z.object({
  numero: z.number().int().nonnegative(),
  eventoExterno: z.string().min(1),
  publicadaEn: Instante,
  /** `true` en la versión 0: instantánea completa de emisiones vigentes. */
  instantanea: z.boolean(),
  cambios: z.array(CambioBoleteria),
});
export type VersionBoleteria = z.infer<typeof VersionBoleteria>;
