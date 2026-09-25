import { createHash } from 'node:crypto';
import type { RegistroDecision } from '../contracts/index.ts';
import {
  ErrorConflictoIdempotencia,
  ErrorConsumoDuplicado,
  ErrorEntradaInvalida,
  ErrorIntentoDuplicado,
  ErrorSinConfianza,
} from './errores.ts';
import type { ContextoIngreso, IntentoDeValidacion, ModoOperacion, ResultadoValidacion, VersionesInstaladas } from './modelo.ts';
import { PROPOSITO_CONSUMO } from './modelo.ts';
import { MotorPrimerIngreso } from './motor.ts';
import type { EstadoAutoridad, FabricaUnidadValidacion, Reloj, ResolutorAlcance, Telemetria, UnidadValidacion } from './puertos.ts';

export interface DependenciasValidar {
  unidades: FabricaUnidadValidacion;
  alcance: ResolutorAlcance;
  autoridad: EstadoAutoridad;
  reloj: Reloj;
  telemetria?: Telemetria;
  motor?: MotorPrimerIngreso;
  /** Reintentos ante carrera de consumo o de `idOrigen` (el segundo intento ve el estado confirmado). */
  reintentosCarrera?: number;
}

export interface SolicitudIngreso {
  idOrigen: string;
  eventoId: string;
  lectorId: string;
  puntoId: string;
  codigo: string;
  proposito?: IntentoDeValidacion['proposito'];
  zonaSolicitada?: string | null;
  instanteLector: Date;
  modo?: ModoOperacion;
}

/** Huella estable (SHA-256 hex) del contenido de un intento: distingue retransmisión de conflicto (PB-04). */
export function huellaIntento(i: IntentoDeValidacion): string {
  const canonico = JSON.stringify([
    i.eventoId,
    i.lectorId,
    i.puntoId,
    i.codigo,
    i.proposito,
    i.zonaSolicitada ?? null,
    i.instanteLector.toISOString(),
  ]);
  return createHash('sha256').update(canonico).digest('hex');
}

/**
 * Caso de uso "Validar una boleta para su primer ingreso" (taller 2 §6).
 * Una `UnidadValidacion` por solicitud; la respuesta sale después del commit.
 * - Retransmisión (mismo idOrigen y contenido): decisión original con `repetida: true`.
 * - Conflicto (mismo idOrigen, otro contenido): `ErrorConflictoIdempotencia`.
 * - Falla de la unidad: "sin confirmación" (`sin-respuesta`), sin consumo ni rechazo (PU-03-07, PB-12, PB-13).
 */
export class ValidarPrimerIngreso {
  private readonly deps: DependenciasValidar;
  private readonly motor: MotorPrimerIngreso;

  constructor(deps: DependenciasValidar) {
    this.deps = deps;
    this.motor = deps.motor ?? new MotorPrimerIngreso();
  }

  async ejecutar(solicitud: SolicitudIngreso): Promise<ResultadoValidacion> {
    const intento = normalizar(solicitud);
    const alcance = await this.deps.alcance.resolver(intento.lectorId);
    if (alcance.revocado) throw new ErrorSinConfianza(intento.lectorId, 'Credencial del lector revocada');
    if (alcance.eventoId !== intento.eventoId || alcance.puntoId !== intento.puntoId) {
      throw new ErrorSinConfianza(intento.lectorId, 'El lector no está asignado a este evento y punto');
    }

    const inicio = this.deps.reloj.ahora();
    const huella = huellaIntento(intento);
    const intentosMax = 1 + (this.deps.reintentosCarrera ?? 2);
    let versiones: VersionesInstaladas | null = null;

    for (let n = 1; ; n++) {
      let unidad: UnidadValidacion | null = null;
      try {
        unidad = await this.deps.unidades.abrir();
        const previo = await unidad.buscarIntento(intento.eventoId, intento.idOrigen);
        if (previo) {
          await unidad.cancelar();
          if (previo.huella !== huella) throw new ErrorConflictoIdempotencia(intento.idOrigen);
          return { ...previo.resultado, repetida: true };
        }

        const datos = await unidad.cargarParaActualizar(intento);
        versiones = datos.versiones;
        const instante = this.deps.reloj.ahora();
        if (!datos.evento) {
          await unidad.cancelar();
          return this.sinConfirmacion(intento, 'evento sin permisos instalados', versiones);
        }
        const ctx: ContextoIngreso = {
          intento,
          evento: datos.evento,
          punto: datos.punto,
          boleta: datos.boleta,
          versiones: datos.versiones,
          coordinador: this.deps.autoridad.actual(),
          modo: solicitud.modo ?? 'conectado',
          instante,
        };
        const evaluacion = this.motor.evaluar(ctx);
        const { zonaBoleta, ...decision } = evaluacion;
        const resultado: ResultadoValidacion = {
          ...decision,
          idOrigen: intento.idOrigen,
          versionPermisos: datos.versiones.versionPermisos,
          instanteDecision: instante,
          repetida: false,
        };

        // Sin respuesta del motor: nada se persiste ni se consume.
        if (resultado.decision === 'sin-respuesta') {
          await unidad.cancelar();
          this.notificarSinConfirmacion(intento, resultado.motivo);
          return resultado;
        }

        await unidad.registrarIntento(intento, huella, resultado);
        if (resultado.decision === 'aceptado' && resultado.admision && datos.boleta) {
          await unidad.registrarConsumo({
            clave: {
              clienteId: datos.evento.clienteId,
              eventoId: datos.evento.eventoId,
              boleteriaId: datos.evento.boleteriaId,
              referencia: datos.boleta.referencia,
              proposito: PROPOSITO_CONSUMO,
            },
            idOrigen: intento.idOrigen,
            puntoId: intento.puntoId,
            lectorId: intento.lectorId,
            consumidoEn: instante,
          });
        }
        const registro = registroDecision(intento, resultado, zonaBoleta);
        await unidad.agregarBitacora({
          eventoId: intento.eventoId,
          tipo: 'decision',
          idOrigen: intento.idOrigen,
          contenido: registro as unknown as Record<string, unknown>,
          registradoEn: instante,
        });
        await unidad.agregarOutbox({ eventoId: intento.eventoId, registro });
        await unidad.confirmar();

        this.notificarDecision(resultado, intento, inicio);
        return resultado;
      } catch (error) {
        if (unidad) await cancelarSilencioso(unidad);
        if (error instanceof ErrorConflictoIdempotencia) throw error;
        if ((error instanceof ErrorConsumoDuplicado || error instanceof ErrorIntentoDuplicado) && n < intentosMax) continue;
        return this.sinConfirmacion(intento, causa(error), versiones);
      }
    }
  }

  private sinConfirmacion(intento: IntentoDeValidacion, motivoTecnico: string, versiones: VersionesInstaladas | null): ResultadoValidacion {
    this.notificarSinConfirmacion(intento, motivoTecnico);
    const instante = this.deps.reloj.ahora();
    return resultadoSinConfirmacion(intento.idOrigen, instante, this.coordinadorId(), versiones);
  }

  private coordinadorId(): string {
    try {
      return this.deps.autoridad.actual().coordinadorId;
    } catch {
      return 'desconocido';
    }
  }

  private notificarDecision(r: ResultadoValidacion, i: IntentoDeValidacion, inicio: Date): void {
    try {
      this.deps.telemetria?.decisionConfirmada(r, i, this.deps.reloj.ahora().getTime() - inicio.getTime());
    } catch {
      // PB-21: la telemetría nunca cambia ni pierde la decisión.
    }
  }

  private notificarSinConfirmacion(i: IntentoDeValidacion, motivo: string): void {
    try {
      this.deps.telemetria?.sinConfirmacion(i, motivo);
    } catch {
      // PB-21
    }
  }
}

/** Respuesta "sin confirmación": nunca equivale a aceptación (regla 3, ADR-011). */
export function resultadoSinConfirmacion(
  idOrigen: string,
  instante: Date,
  coordinadorId: string,
  versiones: VersionesInstaladas | null,
): ResultadoValidacion {
  return {
    idOrigen,
    decision: 'sin-respuesta',
    motivo: 'SIN_COORDINADOR',
    proposito: null,
    admision: false,
    concurrente: false,
    anulacionEnTransito: false,
    versionPermisos: versiones?.versionPermisos ?? 0,
    evidencia: {
      via: `Coordinador ${coordinadorId}`,
      versionPermisos: versiones?.versionPermisos ?? 0,
      versionPoliticas: versiones?.versionPoliticas ?? 0,
      antiguedadPermisosS: 0,
    },
    instanteDecision: instante,
    repetida: false,
  };
}

export function registroDecision(i: IntentoDeValidacion, r: ResultadoValidacion, zonaBoleta: string | null): RegistroDecision {
  return {
    tipo: 'decision',
    idOrigen: i.idOrigen,
    lectorId: i.lectorId,
    puntoId: i.puntoId,
    codigo: i.codigo,
    zona: zonaBoleta,
    zonaSolicitada: i.zonaSolicitada ?? 'NO_IDENTIFICADA',
    decision: r.decision,
    motivo: r.motivo,
    proposito: r.proposito,
    admision: r.admision,
    concurrente: r.concurrente,
    anulacionEnTransito: r.anulacionEnTransito,
    evidencia: r.evidencia,
    instanteLector: i.instanteLector.toISOString(),
    instanteDecision: r.instanteDecision.toISOString(),
  };
}

function normalizar(s: SolicitudIngreso): IntentoDeValidacion {
  const texto = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const requeridos = { idOrigen: s.idOrigen, eventoId: s.eventoId, lectorId: s.lectorId, puntoId: s.puntoId, codigo: s.codigo };
  for (const [campo, valor] of Object.entries(requeridos)) {
    if (!texto(valor)) throw new ErrorEntradaInvalida(campo, `${campo} es obligatorio`);
  }
  if (!(s.instanteLector instanceof Date) || Number.isNaN(s.instanteLector.getTime())) {
    throw new ErrorEntradaInvalida('instanteLector', 'instanteLector inválido');
  }
  const zona = texto(s.zonaSolicitada);
  return {
    idOrigen: texto(s.idOrigen),
    eventoId: texto(s.eventoId),
    lectorId: texto(s.lectorId),
    puntoId: texto(s.puntoId),
    codigo: texto(s.codigo),
    proposito: s.proposito ?? 'ingreso',
    zonaSolicitada: zona || null,
    instanteLector: s.instanteLector,
  };
}

async function cancelarSilencioso(u: UnidadValidacion): Promise<void> {
  try {
    await u.cancelar();
  } catch {
    // La unidad ya está inválida; la transacción no se confirmó.
  }
}

function causa(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
