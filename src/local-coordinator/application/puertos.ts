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

/** Motivos de revocación admitidos por la lista rica de ADR-008 (`revoked.json`). */
export type MotivoRevocacion = 'lost' | 'compromised' | 'retired';

export interface SolicitudReemplazoLector {
  eventoId: string;
  puntoId: string;
  lectorAnterior: string;
  lectorNuevo: string;
  motivo: MotivoRevocacion;
}

/** Credencial anterior revocada según la lista de revocaciones de la CA de laboratorio. */
export interface CredencialRevocada {
  lectorId: string;
  serialNumber: string;
  fingerprint256: string;
  revokedAt: string;
}

export interface SolicitudRevocacionPendiente {
  id: number;
  eventoId: string;
  lectorId: string;
  motivo: MotivoRevocacion;
  solicitadaEn: Date;
}

export interface ReemplazoRegistrado {
  reemplazoId: number;
  solicitudRevocacionId: number;
  reemplazadoEn: Date;
  /** `true` si el mismo reemplazo ya estaba registrado (reintento del operador). */
  repetido: boolean;
}

/**
 * Gestión de la asignación lector–punto en D1 (PU-05-02). `reemplazar` es atómico: cierra la
 * asignación anterior (el lector queda revocado y deshabilitado), asigna el nuevo lector al punto
 * y deja una solicitud de revocación de la credencial anterior, todo en solo adición.
 */
export interface RepositorioAsignaciones {
  reemplazar(solicitud: SolicitudReemplazoLector, instante: Date): Promise<ReemplazoRegistrado>;
  revocacionesPendientes(eventoId: string): Promise<SolicitudRevocacionPendiente[]>;
  registrarRevocacion(solicitudId: number, credencial: CredencialRevocada, registradaEn: Date): Promise<void>;
}

/** Revoca la credencial mTLS de un lector (ADR-008) y devuelve su entrada de `revoked.json`. */
export interface RevocadorCredenciales {
  revocar(lectorId: string, motivo: MotivoRevocacion): Promise<CredencialRevocada>;
}
