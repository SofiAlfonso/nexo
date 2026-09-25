import { z } from 'zod';
import {
  Contador,
  CoordinadorId,
  Decision,
  EstadoCoordinador,
  EstadoLector,
  EventoId,
  Evidencia,
  IdLote,
  IdOrigen,
  Instante,
  LectorId,
  Motivo,
  Proposito,
  PuntoId,
  RecintoId,
  Version,
  Zona,
} from './common.ts';

/**
 * E1. Consolidación, C2 → C4 (M2): `POST /v1/lotes-evidencia`, HTTPS saliente desde el recinto.
 *
 * - Al menos una vez: C2 reintenta con espera creciente y tope; prioridad inferior a V1.
 * - Idempotente por `idLote` (mismo lote → mismo acuse con `repetido: true`) y por
 *   registro: M2 deduplica por (`eventoId`, `tipo`, `idOrigen`).
 * - Hasta `MAX_REGISTROS_LOTE` (100, `loteEvidenciaMax`) registros por lote.
 * - El acuse no basta para borrar copias locales (ADR-011).
 */
export const MAX_REGISTROS_LOTE = 100;

/** Decisión tomada por C2 en V1 (misma transacción que el consumo, T1). */
export const RegistroDecision = z.object({
  tipo: z.literal('decision'),
  idOrigen: IdOrigen,
  lectorId: LectorId,
  puntoId: PuntoId,
  codigo: z.string().min(1).max(128),
  /** Zona de la boleta; `null` si el código es desconocido. */
  zona: Zona.nullable(),
  zonaSolicitada: Zona,
  decision: Decision,
  motivo: Motivo,
  proposito: Proposito.nullable(),
  admision: z.boolean(),
  concurrente: z.boolean(),
  anulacionEnTransito: z.boolean(),
  evidencia: Evidencia,
  instanteLector: Instante,
  instanteDecision: Instante,
});

/** Intento recuperado del diario de un lector (H1), sin decisión confirmada. */
export const RegistroIntentoDiario = z.object({
  tipo: z.literal('intento-diario'),
  idOrigen: IdOrigen,
  lectorId: LectorId,
  puntoId: PuntoId,
  codigo: z.string().min(1).max(128),
  zonaSolicitada: Zona,
  proposito: Proposito,
  motivoLocal: Motivo,
  instanteLector: Instante,
  recibidoEnCoordinador: Instante,
});

/** Último latido de un punto (C2 puede agrupar varios latidos en uno por punto y lote). `idOrigen` lo genera C2. */
export const RegistroLatidoPunto = z.object({
  tipo: z.literal('latido-punto'),
  idOrigen: IdOrigen,
  lectorId: LectorId,
  puntoId: PuntoId,
  estadoLector: EstadoLector,
  instanteLector: Instante,
  pendientesDiario: Contador,
  diarioTotal: Contador,
});

/** Estado del coordinador y de su outbox en el momento de armar el lote. `idOrigen` lo genera C2. */
export const RegistroEstadoCoordinador = z.object({
  tipo: z.literal('estado-coordinador'),
  idOrigen: IdOrigen,
  coordinadorId: CoordinadorId,
  estado: EstadoCoordinador,
  instante: Instante,
  versionPermisos: Version,
  versionPoliticas: Version,
  outboxPendientes: Contador,
  /** Edad en segundos del pendiente más antiguo del outbox (T2). */
  outboxEdadMaxS: z.number().nonnegative(),
});

export const RegistroEvidencia = z.discriminatedUnion('tipo', [
  RegistroDecision,
  RegistroIntentoDiario,
  RegistroLatidoPunto,
  RegistroEstadoCoordinador,
]);
export type RegistroEvidencia = z.infer<typeof RegistroEvidencia>;
export type RegistroDecision = z.infer<typeof RegistroDecision>;
export type RegistroIntentoDiario = z.infer<typeof RegistroIntentoDiario>;
export type RegistroLatidoPunto = z.infer<typeof RegistroLatidoPunto>;
export type RegistroEstadoCoordinador = z.infer<typeof RegistroEstadoCoordinador>;

export const LoteEvidencia = z.object({
  idLote: IdLote,
  recintoId: RecintoId,
  eventoId: EventoId,
  coordinadorId: CoordinadorId,
  emitidoEn: Instante,
  registros: z.array(RegistroEvidencia).min(1).max(MAX_REGISTROS_LOTE),
});
export type LoteEvidencia = z.infer<typeof LoteEvidencia>;

export const ResultadoRegistro = z.object({
  tipo: z.enum(['decision', 'intento-diario', 'latido-punto', 'estado-coordinador']),
  idOrigen: IdOrigen,
  estado: z.enum(['aceptado', 'duplicado']),
});

export const AcuseLoteEvidencia = z.object({
  idLote: IdLote,
  recibidoEn: Instante,
  aceptados: Contador,
  duplicados: Contador,
  /** `true` si el `idLote` ya se había procesado; el acuse es el original. */
  repetido: z.boolean(),
  resultados: z.array(ResultadoRegistro),
});
export type AcuseLoteEvidencia = z.infer<typeof AcuseLoteEvidencia>;
