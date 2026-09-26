import type {
  Accion, Boleta, EntradaActividad, EstadoActual, EstadoPunto, Incidente, Intento, Preparacion, PuntoDetalle, PuntoResumen,
} from '@nexo/shared/contracts';
import { ControlPreparacion } from '@nexo/shared/contracts';
import type { EventoConfigRepositorio, PuntoConfigRepositorio } from '../../modules/configuration-permissions/application/index.ts';
import type { IncidenteRepositorio } from '../../modules/evidence-ingestion/application/index.ts';
import type {
  AccionesRepositorio, ActividadRepositorio, BoletasRepositorio, ConsultaIntentosOpciones, EstadoOperativoRepositorio,
  EstadoPuntoLeido, IntentosRepositorio, ResultadoDecisionAccion,
} from './puertos.ts';
import type { ConciliacionPuerto, PreparacionRepositorio } from './puertos-preparacion.ts';

const ESTADO_PUNTO_VACIO: EstadoPunto = 'sin-abrir';

/** Segundos desde la medianoche local; misma convención usada por M1 y M2 (ola 1, sin DST especial). */
function segundosDelDia(instante: Date): number {
  return instante.getHours() * 3600 + instante.getMinutes() * 60 + instante.getSeconds();
}

function resumenPunto(config: { id: string; nombre: string; zona: string; zonas: string[] }, operativo: EstadoPuntoLeido | null): PuntoResumen {
  return {
    id: config.id,
    nombre: config.nombre,
    zona: config.zona,
    zonas: config.zonas,
    estado: operativo?.estado ?? ESTADO_PUNTO_VACIO,
    ultimaComunicacionS: operativo?.ultimaComunicacion ? segundosDelDia(operativo.ultimaComunicacion) : null,
    pendientesDiario: operativo?.pendientesDiario ?? 0,
    diarioTotal: operativo?.diarioTotal ?? 0,
    // No proyectado en M1 (ola 1): sincronización de diario, series de decisiones y averías del lector.
    sincronizandoDesdeS: null,
    decisionesMinuto: 0,
    serie: [],
    averiadoDesdeS: null,
    redirigido: false,
    recuperacionS: null,
    lectorActual: null,
  };
}

/**
 * Composición O2 mínima (ola 1): junta configuración (M1), estado operativo (M2) e incidentes
 * (M2) en las formas que exige el panel C5. Los campos de M3/M4 (conciliación, liquidación,
 * métricas finas) usan valores por defecto documentados hasta que esas olas se implementen.
 */
export class ServicioO2 {
  private readonly eventosConfig: EventoConfigRepositorio;
  private readonly puntosConfig: PuntoConfigRepositorio;
  private readonly operativo: EstadoOperativoRepositorio;
  private readonly incidentes: IncidenteRepositorio;
  private readonly preparacion: PreparacionRepositorio;
  private readonly conciliacion: ConciliacionPuerto;
  private readonly intentos: IntentosRepositorio;
  private readonly acciones: AccionesRepositorio;
  private readonly boletas: BoletasRepositorio;
  private readonly actividad: ActividadRepositorio;
  private readonly ahora: () => Date;

  constructor(
    eventosConfig: EventoConfigRepositorio,
    puntosConfig: PuntoConfigRepositorio,
    operativo: EstadoOperativoRepositorio,
    incidentes: IncidenteRepositorio,
    preparacion: PreparacionRepositorio,
    conciliacion: ConciliacionPuerto,
    intentos: IntentosRepositorio,
    acciones: AccionesRepositorio,
    boletas: BoletasRepositorio,
    actividad: ActividadRepositorio,
    ahora: () => Date = () => new Date(),
  ) {
    this.eventosConfig = eventosConfig;
    this.puntosConfig = puntosConfig;
    this.operativo = operativo;
    this.incidentes = incidentes;
    this.preparacion = preparacion;
    this.conciliacion = conciliacion;
    this.intentos = intentos;
    this.acciones = acciones;
    this.boletas = boletas;
    this.actividad = actividad;
    this.ahora = ahora;
  }

  async listarPuntos(): Promise<PuntoResumen[]> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return [];
    const [config, operativos] = await Promise.all([
      this.puntosConfig.listarPuntosConfig(evento.id),
      this.operativo.listarPuntos(evento.id),
    ]);
    const porId = new Map(operativos.map(punto => [punto.id, punto]));
    return config.map(punto => resumenPunto(punto, porId.get(punto.id) ?? null));
  }

  async obtenerPunto(puntoId: string): Promise<PuntoDetalle | null> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return null;
    const [config, operativo, recientes] = await Promise.all([
      this.puntosConfig.listarPuntosConfig(evento.id),
      this.operativo.obtenerPunto(evento.id, puntoId),
      this.intentos.listar(evento.id, { limite: 10, puntoId }),
    ]);
    const puntoConfig = config.find(punto => punto.id === puntoId);
    if (!puntoConfig) return null;
    return {
      ...resumenPunto(puntoConfig, operativo),
      // No proyectado en M1 (ola 1): latencias, checklist de preparación y actividad/lectores del punto.
      latencias: [],
      recientes,
      preparacion: { lector: false, credencial: false, zonas: puntoConfig.zonas.length > 0, version: true, prueba: false },
      lectores: [],
      actividad: [],
    };
  }

  async obtenerEstadoActual(): Promise<EstadoActual | null> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return null;
    const ahora = this.ahora();
    const [coordinador, contadores, conciliacion, preparacion] = await Promise.all([
      this.operativo.obtenerEstadoCoordinador(evento.id),
      this.operativo.contarDecisiones(evento.id),
      this.conciliacion.obtenerConciliacion(evento.id),
      this.componerPreparacion(evento.id),
    ]);

    return {
      ahora: ahora.toISOString(),
      ahoraS: segundosDelDia(ahora),
      evento: {
        id: evento.id,
        nombre: evento.nombre,
        nombreCorto: evento.nombreCorto,
        recinto: evento.recinto,
        boleteria: evento.boleteria,
        aperturaS: evento.aperturaS,
        cierreS: evento.cierreS,
        admisionesEstimadas: evento.admisionesEstimadas,
        gratuito: evento.gratuito,
        estado: evento.estado,
        versionPermisos: evento.versionPermisos,
        ultimoCambioRecibidoS: evento.ultimoCambioRecibidoS,
        politicas: evento.politicas,
      },
      coordinador: {
        // Nodo único en el taller 3 (sin réplica ni repuesto, prototipo §6).
        id: coordinador?.coordinadorId ?? 'COORD-A',
        topologia: 'nodo-unico',
        estado: coordinador?.estado ?? 'sin-autoridad',
        desdeS: coordinador?.desde ? segundosDelDia(coordinador.desde) : segundosDelDia(ahora),
        ultimoReporteS: coordinador?.desde ? segundosDelDia(coordinador.desde) : null,
        // Historial de pausas del coordinador: no proyectado en M1 (ola 1).
        pausas: [],
      },
      nube: {
        enLinea: coordinador?.enlaceEnLinea ?? false,
        caidaDesdeS: coordinador?.enlaceCaidaDesde ? segundosDelDia(coordinador.enlaceCaidaDesde) : null,
        buzon: coordinador?.outboxPendientes ?? 0,
        // `enviados` acumulado no se proyecta todavía (solo el pendiente actual, ola 1).
        enviados: 0,
        buzonEdadMaxS: coordinador?.outboxEdadMaxS ?? 0,
      },
      integracion: {
        // Estado de la integración con boletería (P1/P2): asumido en línea hasta que M1 lo reporte.
        enLinea: true,
        enTransito: [],
        pendientesRevision: 0,
      },
      conteo: {
        intentos: contadores.intentos,
        decisiones: contadores.intentos,
        aceptados: contadores.aceptados,
        admisiones: contadores.admisiones,
        reingresos: contadores.reingresos,
        rechazados: contadores.rechazados,
        desconocidos: contadores.desconocidos,
        zonaIncorrecta: contadores.zonaIncorrecta,
        anuladas: contadores.anuladas,
        concurrentes: contadores.concurrentes,
        usoRegistrado: contadores.usoRegistrado,
        sinRespuesta: contadores.sinRespuesta,
        camposCompletos: contadores.intentos,
      },
      admisionesPorZona: contadores.admisionesPorZona,
      serie: contadores.serieUltimaHora.slice(-40),
      metricas: {
        // Métricas finas de latencia/plazo (M3/M4): pendientes de una ola posterior.
        dps: 0,
        p95Ms: 0,
        solicitudes: contadores.intentos,
        enPlazo: 0,
        visiblesTotal: 0,
        visiblesEnPlazo: 0,
        duranteCorte: 0,
        sincronizaciones: [],
      },
      conciliacion,
      preparacion,
    };
  }

  private async componerPreparacion(eventoId: string): Promise<Preparacion> {
    const leida = await this.preparacion.obtenerPreparacion(eventoId);
    const controles: Preparacion['controles'] = [];
    for (const control of leida.controles) {
      const validado = ControlPreparacion.safeParse({ id: control.id, titulo: control.titulo, ok: control.ok, detalle: '' });
      if (validado.success) controles.push(validado.data);
    }
    return { confirmada: leida.confirmada, controles };
  }

  /** `null` si `id` no es un control válido; `'evento-no-encontrado'` si no hay evento actual. */
  async alternarControlPreparacion(id: string, ok: boolean): Promise<Preparacion | 'evento-no-encontrado' | 'control-invalido'> {
    if (!ControlPreparacion.shape.id.safeParse(id).success) return 'control-invalido';
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return 'evento-no-encontrado';
    await this.preparacion.alternarControl(evento.id, id, ok);
    return this.componerPreparacion(evento.id);
  }

  /** `'controles-pendientes'` si algún control aún no está confirmado (regla del taller: un control
   * pendiente bloquea la apertura, sin excepciones desde la API). */
  async confirmarAperturaPreparacion(): Promise<Preparacion | 'evento-no-encontrado' | 'controles-pendientes'> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return 'evento-no-encontrado';
    const actual = await this.componerPreparacion(evento.id);
    if (actual.controles.length === 0 || actual.controles.some(control => !control.ok)) return 'controles-pendientes';
    await this.preparacion.confirmarApertura(evento.id);
    return this.componerPreparacion(evento.id);
  }

  async listarIncidentes(): Promise<Incidente[]> {
    return this.incidentes.listar();
  }

  async obtenerIncidente(id: string): Promise<Incidente | null> {
    return this.incidentes.obtener(id);
  }

  async listarIntentos(opciones: ConsultaIntentosOpciones): Promise<Intento[]> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return [];
    return this.intentos.listar(evento.id, opciones);
  }

  async listarAcciones(): Promise<Accion[]> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return [];
    return this.acciones.listar(evento.id);
  }

  /** `null` si no hay evento actual (se traduce a 404 en la ruta, igual que "acción no encontrada"). */
  async decidirAccion(id: string, aprobar: boolean, nota: string | undefined, usuario: string): Promise<ResultadoDecisionAccion | null> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return null;
    return this.acciones.decidir(evento.id, id, aprobar, nota, usuario);
  }

  async obtenerBoleta(referencia: string): Promise<Boleta | null> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return null;
    return this.boletas.obtener(evento.id, referencia);
  }

  async listarActividad(): Promise<EntradaActividad[]> {
    const evento = await this.eventosConfig.obtenerEventoActual();
    if (!evento) return [];
    return this.actividad.listar(evento.id);
  }
}
