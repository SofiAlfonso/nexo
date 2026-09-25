import type { AcuseLoteDiario, LoteDiario } from '@nexo/shared/contracts';
import type { FabricaUnidadValidacion, OutboxPendiente, RepositorioPermisos, ResolutorAlcance } from '@nexo/shared/domain';

/**
 * Recepción del diario de un lector (H1): recupera evidencia SIN nueva autorización.
 * En una transacción: idempotente por `idLote` (repite el acuse original con `repetido: true`)
 * y por `idOrigen`: ya decidido en V1 → `yaDecididos`; ya recibido por diario → `duplicados`;
 * nuevo → se guarda y se agrega al outbox como registro `intento-diario` → `aceptados`.
 */
export interface RepositorioDiario {
  registrarLote(lote: LoteDiario, recibidoEn: Date): Promise<AcuseLoteDiario>;
}

/** Todo lo que C2 necesita de D1 (adaptador PostgreSQL o en memoria con la misma semántica). */
export interface Almacen {
  unidades: FabricaUnidadValidacion;
  alcance: ResolutorAlcance;
  outbox: OutboxPendiente;
  diario: RepositorioDiario;
  permisos: RepositorioPermisos;
  /** `true` si D1 responde. */
  salud(): Promise<boolean>;
  cerrar(): Promise<void>;
}
