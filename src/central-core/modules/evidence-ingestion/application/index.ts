import type { AcuseLoteEvidencia, LoteEvidencia, RegistroEvidencia } from '../../../../shared/contracts/e1.ts';
import type { Incidente } from '../../../../shared/contracts/o2.ts';
import { incidenteSinComunicacion, sinComunicacion, UMBRAL_SIN_COMUNICACION_MS, type NuevoIncidente } from '../domain/index.ts';

export type Resultado = AcuseLoteEvidencia['resultados'][number];

export interface IncidenteRepositorio {
  crearSiNoExisteActivo(eventoId: string, incidente: NuevoIncidente, detectadoEn?: Date): Promise<Incidente>;
  resolverActivoPorPunto(eventoId: string, puntoId: string, instante: Date): Promise<void>;
  listar(): Promise<Incidente[]>;
  obtener(id: string): Promise<Incidente | null>;
}

export interface ProyeccionPuntosRepositorio {
  actualizarLatidoPunto(eventoId: string, puntoId: string, instanteLector: string, pendientesDiario: number, diarioTotal: number, lectorId: string): Promise<void>;
  listarPuntosConLatidoVencido(umbralMs: number): Promise<Array<{ eventoId: string; puntoId: string; ultimaComunicacionInstante: Date }>>;
  marcarSinComunicacion(eventoId: string, puntoId: string): Promise<void>;
}

export type ProcesarAceptados = (
  registros: RegistroEvidencia[],
  puntos: ProyeccionPuntosRepositorio,
  incidentes: IncidenteRepositorio,
) => Promise<void>;

export interface LoteEvidenciaRepositorio {
  yaProcesado(idLote: string, lote: LoteEvidencia): Promise<AcuseLoteEvidencia | null>;
  guardarLoteYRegistros(lote: LoteEvidencia, resultados: Resultado[], procesarAceptados?: ProcesarAceptados): Promise<void>;
}

export class ConflictoEvidencia extends Error {
  readonly codigo = 'CONFLICTO_IDEMPOTENCIA';
}

export class ServicioIngestaEvidencia {
  private readonly lotes: LoteEvidenciaRepositorio;

  constructor(lotes: LoteEvidenciaRepositorio) {
    this.lotes = lotes;
  }

  async procesarLote(lote: LoteEvidencia): Promise<AcuseLoteEvidencia> {
    const anterior = await this.lotes.yaProcesado(lote.idLote, lote);
    if (anterior) return { ...anterior, repetido: true };

    const resultados: Resultado[] = lote.registros.map(({ tipo, idOrigen }) => ({
      tipo, idOrigen, estado: 'aceptado',
    }));
    await this.lotes.guardarLoteYRegistros(lote, resultados, async (registros, puntos, incidentes) => {
      for (const registro of registros) {
        if (registro.tipo === 'latido-punto') {
          await puntos.actualizarLatidoPunto(
            lote.eventoId, registro.puntoId, registro.instanteLector,
            registro.pendientesDiario, registro.diarioTotal, registro.lectorId,
          );
          await incidentes.resolverActivoPorPunto(lote.eventoId, registro.puntoId, new Date());
        }
        // TODO(M2): proyectar intentos del diario y agregados de decisiones para O2.
      }
    });
    const acuse = await this.lotes.yaProcesado(lote.idLote, lote);
    if (!acuse) throw new Error(`Lote ${lote.idLote} no persistido`);
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
