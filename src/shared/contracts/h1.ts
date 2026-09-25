import { z } from 'zod';
import {
  Contador,
  EstadoLector,
  EventoId,
  IdLote,
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
 * H1. Latido y recuperación histórica, C1 → C2 (HTTPS local con mTLS),
 * por un receptor separado de V1.
 */

/** `POST /v1/heartbeats`: cada 10 s. C4 marca "sin comunicación" a los 30 s sin latido (meta KR1.2: 60 s). */
export const Latido = z.object({
  lectorId: LectorId,
  puntoId: PuntoId,
  eventoId: EventoId,
  instanteLector: Instante,
  /** Secuencia monótona por lector; permite detectar latidos perdidos. */
  secuencia: Contador,
  estadoLector: EstadoLector,
  /** Intentos en el diario local sin decisión confirmada. */
  pendientesDiario: Contador,
  diarioTotal: Contador,
  versionPermisos: Version.nullable(),
});
export type Latido = z.infer<typeof Latido>;

export const AcuseLatido = z.object({
  recibidoEn: Instante,
  intervaloS: z.number().int().positive(),
});
export type AcuseLatido = z.infer<typeof AcuseLatido>;

/** Intento que el lector guardó en su diario sin decisión confirmada. */
export const RegistroDiario = z.object({
  idOrigen: IdOrigen,
  codigo: z.string().min(1).max(128),
  proposito: Proposito,
  zonaSolicitada: Zona,
  instanteLector: Instante,
  /** Motivo local (`SIN_COORDINADOR` o `PUNTO_SUSPENDIDO`). */
  motivoLocal: Motivo,
  latenciaMs: z.number().nonnegative().nullable(),
});
export type RegistroDiario = z.infer<typeof RegistroDiario>;

export const MAX_REGISTROS_DIARIO = 500;

/**
 * `POST /v1/diario/lotes`: entrega del diario al volver la comunicación.
 * Recupera evidencia SIN nueva autorización: C2 no decide estos intentos.
 * Idempotente por `idLote` y por `idOrigen`; si C2 ya había decidido ese
 * `idOrigen` (respuesta perdida), se informa en `yaDecididos`.
 */
export const LoteDiario = z.object({
  idLote: IdLote,
  lectorId: LectorId,
  puntoId: PuntoId,
  eventoId: EventoId,
  registros: z.array(RegistroDiario).min(1).max(MAX_REGISTROS_DIARIO),
});
export type LoteDiario = z.infer<typeof LoteDiario>;

export const AcuseLoteDiario = z.object({
  idLote: IdLote,
  recibidoEn: Instante,
  aceptados: z.array(IdOrigen),
  duplicados: z.array(IdOrigen),
  yaDecididos: z.array(IdOrigen),
  /** `true` si el `idLote` ya se había recibido. */
  repetido: z.boolean(),
});
export type AcuseLoteDiario = z.infer<typeof AcuseLoteDiario>;
