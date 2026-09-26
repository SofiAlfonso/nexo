import type {
  CredencialRevocada, MotivoRevocacion, ReemplazoRegistrado, RepositorioAsignaciones,
  RevocadorCredenciales, SolicitudReemplazoLector,
} from './puertos.ts';

/** Mismo formato que exige `scripts/certs.mjs` para un identificador de lector. */
const ID_LECTOR = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MOTIVOS: readonly MotivoRevocacion[] = ['lost', 'compromised', 'retired'];

export class ErrorReemplazoInvalido extends Error {
  readonly codigo = 'REEMPLAZO_INVALIDO';
}

export type EstadoRevocacion =
  | { estado: 'revocada'; credencial: CredencialRevocada }
  | { estado: 'pendiente'; error: string };

export interface ResultadoReemplazo extends ReemplazoRegistrado {
  revocacion: EstadoRevocacion;
}

export interface DependenciasReemplazo {
  asignaciones: RepositorioAsignaciones;
  revocador: RevocadorCredenciales;
  reloj: { ahora(): Date };
}

/**
 * PU-05-02: reemplaza el lector de un punto. D1 cierra la asignación anterior antes de pedir la
 * revocación, así el lector anterior deja de validar aunque la CA no esté disponible (ADR-008:
 * C2 conserva la revocación sin internet). Si la revocación de la credencial falla, la solicitud
 * queda pendiente en D1 y se reintenta con `revocarPendientes`.
 */
export class ReemplazarLector {
  private readonly deps: DependenciasReemplazo;

  constructor(deps: DependenciasReemplazo) {
    this.deps = deps;
  }

  async ejecutar(solicitud: SolicitudReemplazoLector): Promise<ResultadoReemplazo> {
    validar(solicitud);
    const registrado = await this.deps.asignaciones.reemplazar(solicitud, this.deps.reloj.ahora());
    const revocacion = await this.revocar(registrado.solicitudRevocacionId, solicitud.lectorAnterior, solicitud.motivo);
    return { ...registrado, revocacion };
  }

  async revocarPendientes(eventoId: string): Promise<Array<{ lectorId: string } & EstadoRevocacion>> {
    const pendientes = await this.deps.asignaciones.revocacionesPendientes(eventoId);
    const resultados: Array<{ lectorId: string } & EstadoRevocacion> = [];
    for (const pendiente of pendientes) {
      resultados.push({ lectorId: pendiente.lectorId, ...await this.revocar(pendiente.id, pendiente.lectorId, pendiente.motivo) });
    }
    return resultados;
  }

  private async revocar(solicitudId: number, lectorId: string, motivo: MotivoRevocacion): Promise<EstadoRevocacion> {
    let credencial: CredencialRevocada;
    try {
      credencial = await this.deps.revocador.revocar(lectorId, motivo);
    } catch (error) {
      return { estado: 'pendiente', error: error instanceof Error ? error.message : String(error) };
    }
    if (credencial.lectorId !== lectorId) {
      return { estado: 'pendiente', error: `La revocación devuelta es de ${credencial.lectorId}, no de ${lectorId}` };
    }
    await this.deps.asignaciones.registrarRevocacion(solicitudId, credencial, this.deps.reloj.ahora());
    return { estado: 'revocada', credencial };
  }
}

function validar(s: SolicitudReemplazoLector): void {
  if (!ID_LECTOR.test(s.lectorAnterior) || !ID_LECTOR.test(s.lectorNuevo)) {
    throw new ErrorReemplazoInvalido('Identificador de lector inválido');
  }
  if (s.lectorAnterior === s.lectorNuevo) {
    throw new ErrorReemplazoInvalido('El lector nuevo debe ser distinto del anterior: nunca se reutiliza una identidad');
  }
  if (!s.eventoId.trim() || !s.puntoId.trim()) throw new ErrorReemplazoInvalido('Evento y punto son obligatorios');
  if (!MOTIVOS.includes(s.motivo)) throw new ErrorReemplazoInvalido(`Motivo de revocación inválido: ${String(s.motivo)}`);
}
