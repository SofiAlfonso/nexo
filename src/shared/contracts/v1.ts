import { z } from 'zod';
import {
  Decision,
  EventoId,
  Evidencia,
  IdOrigen,
  Instante,
  LectorId,
  Motivo,
  Proposito,
  PuntoId,
  Version,
  Zona,
} from './common.ts';

/**
 * V1. Validación, C1 → C2: `POST /v1/validaciones` (HTTPS con mTLS).
 *
 * - Mismo `idOrigen` y mismo contenido: C2 devuelve la decisión original con `repetida: true`.
 * - Mismo `idOrigen` y contenido distinto: 409 `CONFLICTO_IDEMPOTENCIA` (PB-04).
 * - Si C2 no puede confirmar (p. ej. D1 indisponible) responde 200 con `decision: "sin-respuesta"`.
 *   Un timeout del lector también cuenta como `sin-respuesta` y queda en su diario (H1).
 * - `sin-respuesta` nunca equivale a aceptación (regla 3, ADR-011).
 * - `lectorId` debe coincidir con la identidad de la credencial mTLS.
 */
export const SolicitudValidacion = z.object({
  idOrigen: IdOrigen,
  eventoId: EventoId,
  lectorId: LectorId,
  puntoId: PuntoId,
  codigo: z.string().min(1).max(128),
  proposito: Proposito.default('ingreso'),
  zonaSolicitada: Zona,
  instanteLector: Instante,
});
export type SolicitudValidacion = z.infer<typeof SolicitudValidacion>;

export const RespuestaValidacion = z.object({
  idOrigen: IdOrigen,
  decision: Decision,
  motivo: Motivo,
  /** Propósito resuelto: `ingreso` (genera admisión), `reingreso` o `null` si no se aceptó. */
  proposito: Proposito.nullable(),
  /** Primera aceptación correcta de la boleta: unidad facturable (regla 4). */
  admision: z.boolean(),
  concurrente: z.boolean(),
  anulacionEnTransito: z.boolean(),
  versionPermisos: Version,
  evidencia: Evidencia,
  instanteDecision: Instante,
  /** `true` si es la repetición idempotente de un `idOrigen` ya decidido. */
  repetida: z.boolean(),
});
export type RespuestaValidacion = z.infer<typeof RespuestaValidacion>;
