import type { AcuseLoteEvidencia, LoteEvidencia, RegistroEvidencia } from '../../../../shared/contracts/e1.ts';
import type { AccionIncidente, Incidente } from '../../../../shared/contracts/o2.ts';
import { conSpan, metrics, trace } from '../../../../shared/telemetry/index.ts';
import {
  incidenteSinComunicacion, intentoDiarioPendiente, sinComunicacion, UMBRAL_SIN_COMUNICACION_MS,
  type IntentoDiarioPendiente, type NuevoIncidente,
} from '../domain/index.ts';

const tracer = trace.getTracer('nexo.central-core.evidence-ingestion');
const meter = metrics.getMeter('nexo.central-core');

/** `nexo_c4_lotes_evidencia_total{resultado}`: N1 (volumen ingresado) y N3 (integridad: conflictos). */
const lotesEvidenciaTotal = meter.createCounter('nexo_c4_lotes_evidencia_total', {
  description: 'Lotes E1 recibidos por C4, por resultado (aceptado, repetido o conflicto de idempotencia)',
});

/** `nexo_c4_registros_evidencia_total`: N1, volumen de registros de decisión ingeridos por C4. */
const registrosEvidenciaTotal = meter.createCounter('nexo_c4_registros_evidencia_total', {
  description: 'Registros de evidencia (decisiones) ingeridos por C4 dentro de lotes E1 aceptados',
});

export type Resultado = AcuseLoteEvidencia['resultados'][number];

/** Autor de una acción sobre un incidente: sale siempre del operador autenticado (ADR-016). */
export interface AutorAccion {
  usuario: string;
  rol: string;
}

export type ResultadoAccionIncidente = { tipo: 'no-encontrada' } | { tipo: 'ok'; incidente: Incidente };

export interface IncidenteRepositorio {
  crearSiNoExisteActivo(eventoId: string, incidente: NuevoIncidente, detectadoEn?: Date): Promise<Incidente>;
  resolverActivoPorPunto(eventoId: string, puntoId: string, instante: Date): Promise<void>;
  listar(): Promise<Incidente[]>;
  obtener(id: string): Promise<Incidente | null>;
  /** Aplica una acción de operador (T31/KR1.3): persiste el cambio y su entrada de bitácora en D2. */
  aplicarAccion(id: string, accion: AccionIncidente, autor: AutorAccion): Promise<ResultadoAccionIncidente>;
}

export interface ProyeccionPuntosRepositorio {
  actualizarLatidoPunto(eventoId: string, puntoId: string, instanteLector: string, pendientesDiario: number, diarioTotal: number, lectorId: string): Promise<void>;
  listarPuntosConLatidoVencido(umbralMs: number): Promise<Array<{ eventoId: string; puntoId: string; ultimaComunicacionInstante: Date }>>;
  marcarSinComunicacion(eventoId: string, puntoId: string): Promise<void>;
}

/** Proyección de intentos del diario (PU-04-05), escrita en la misma transacción que su evidencia. */
export interface ProyeccionIntentosDiarioRepositorio {
  registrarPendiente(intento: IntentoDiarioPendiente): Promise<void>;
}

export type ProcesarAceptados = (
  registros: RegistroEvidencia[],
  puntos: ProyeccionPuntosRepositorio,
  incidentes: IncidenteRepositorio,
  intentos: ProyeccionIntentosDiarioRepositorio,
) => Promise<void>;

export interface LoteEvidenciaRepositorio {
  yaProcesado(idLote: string, lote: LoteEvidencia): Promise<AcuseLoteEvidencia | null>;
  guardarLoteYRegistros(lote: LoteEvidencia, resultados: Resultado[], procesarAceptados?: ProcesarAceptados): Promise<void>;
}

export class ConflictoEvidencia extends Error {
  readonly codigo = 'CONFLICTO_IDEMPOTENCIA';
  /** Qué chocó: el lote entero (mismo idLote) o un registro de ese tipo (mismo idOrigen). */
  readonly tipo: 'lote' | RegistroEvidencia['tipo'];
  constructor(mensaje: string, tipo: 'lote' | RegistroEvidencia['tipo'] = 'lote') {
    super(mensaje);
    this.tipo = tipo;
  }
}

export class ServicioIngestaEvidencia {
  private readonly lotes: LoteEvidenciaRepositorio;

  constructor(lotes: LoteEvidenciaRepositorio) {
    this.lotes = lotes;
  }

  async procesarLote(lote: LoteEvidencia): Promise<AcuseLoteEvidencia> {
    const anterior = await conSpan(tracer, 'idempotency.check', () => this.lotes.yaProcesado(lote.idLote, lote));
    if (anterior) {
      lotesEvidenciaTotal.add(1, { resultado: 'repetido' });
      return { ...anterior, repetido: true };
    }

    const resultados: Resultado[] = lote.registros.map(({ tipo, idOrigen }) => ({
      tipo, idOrigen, estado: 'aceptado',
    }));
    try {
      await conSpan(tracer, 'evidence.persist', () => this.lotes.guardarLoteYRegistros(lote, resultados, async (registros, puntos, incidentes, intentos) => {
        for (const registro of registros) {
          if (registro.tipo === 'latido-punto') {
            await puntos.actualizarLatidoPunto(
              lote.eventoId, registro.puntoId, registro.instanteLector,
              registro.pendientesDiario, registro.diarioTotal, registro.lectorId,
            );
            await incidentes.resolverActivoPorPunto(lote.eventoId, registro.puntoId, new Date());
          }
          if (registro.tipo === 'intento-diario') {
            await intentos.registrarPendiente(intentoDiarioPendiente(lote.eventoId, registro));
          }
        }
      }));
    } catch (error) {
      // `tipo` separa los conflictos de decisiones (N3, A1) de los de latidos o estado, que no son de integridad.
      lotesEvidenciaTotal.add(1, { resultado: 'conflicto', tipo: error instanceof ConflictoEvidencia ? error.tipo : 'desconocido' });
      throw error;
    }
    const acuse = await this.lotes.yaProcesado(lote.idLote, lote);
    if (!acuse) throw new Error(`Lote ${lote.idLote} no persistido`);
    lotesEvidenciaTotal.add(1, { resultado: 'aceptado' });
    registrosEvidenciaTotal.add(lote.registros.length);
    return acuse;
  }
}

export class ServicioVigilanciaLatidos {
  private readonly puntos: ProyeccionPuntosRepositorio;
  private readonly incidentes: IncidenteRepositorio;
  private readonly ahora: () => Date;

  constructor(
    puntos: ProyeccionPuntosRepositorio,
    incidentes: IncidenteRepositorio,
    ahora: () => Date = () => new Date(),
  ) {
    this.puntos = puntos;
    this.incidentes = incidentes;
    this.ahora = ahora;
  }

  async revisarPuntosSinComunicacion(): Promise<Incidente[]> {
    const vencidos = await this.puntos.listarPuntosConLatidoVencido(UMBRAL_SIN_COMUNICACION_MS);
    const resultado: Incidente[] = [];
    for (const punto of vencidos) {
      const detectadoEn = this.ahora();
      if (!sinComunicacion(punto.ultimaComunicacionInstante, detectadoEn)) continue;
      const incidente = await this.incidentes.crearSiNoExisteActivo(
        punto.eventoId, incidenteSinComunicacion(punto.puntoId, detectadoEn), detectadoEn,
      );
      await this.puntos.marcarSinComunicacion(punto.eventoId, punto.puntoId);
      resultado.push(incidente);
    }
    return resultado;
  }
}
