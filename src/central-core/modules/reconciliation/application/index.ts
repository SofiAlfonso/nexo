import type { Rol } from '../../../../shared/contracts/common.ts';
import type { Conciliacion, Diferencia } from '../../../../shared/contracts/o2.ts';
import {
  type CondicionCierre,
  type DatosCondicionesCierre,
  type NuevaDiferencia,
  condicionesPendientes,
  diferenciaAnulacion,
  diferenciaDiario,
  evaluarCondicionesCierre,
} from '../domain/index.ts';

export type EstadoConciliacionAlmacen = 'sin-iniciar' | 'en-curso' | 'preliminar' | 'conciliado';

export interface EstadoConciliacionGuardado {
  estado: EstadoConciliacionAlmacen;
  preliminarEn: Date | null;
  definitivoEn: Date | null;
}

/** Errores de dominio del cierre; el mapeo a `CodigoError`/HTTP ocurre en la capa de rutas. */
export class ConflictoEstadoConciliacion extends Error {
  readonly codigo = 'CONFLICTO_ESTADO';
  readonly pendientes: string[];
  constructor(mensaje: string, pendientes: string[] = []) {
    super(mensaje);
    this.pendientes = pendientes;
  }
}

export class DiferenciaNoEncontrada extends Error {}
export class OpcionInvalida extends Error {}

export interface ConciliacionRepositorio {
  /** Evento vigente para cierre: `cerrado` más reciente, si no hay uno `abierto`/`preparacion`. */
  obtenerEventoActualId(): Promise<string | null>;
  obtenerEstado(eventoId: string): Promise<EstadoConciliacionGuardado>;
  marcarEnCurso(eventoId: string): Promise<void>;
  marcarPreliminar(eventoId: string, usuario: string, momento: Date): Promise<void>;
  marcarDefinitivo(eventoId: string, usuario: string, momento: Date): Promise<void>;
}

export interface DiferenciasRepositorio {
  listar(eventoId: string): Promise<Diferencia[]>;
  existeAbiertaPorReferencia(eventoId: string, referencia: string): Promise<boolean>;
  existeAbiertaDiario(eventoId: string): Promise<boolean>;
  crear(eventoId: string, diferencia: NuevaDiferencia): Promise<Diferencia>;
  obtener(eventoId: string, diferenciaId: string): Promise<Diferencia | null>;
  resolver(eventoId: string, diferenciaId: string, opcionId: string, operador: { usuario: string; rol: Rol }, momento: Date): Promise<Diferencia>;
}

export interface DeteccionRepositorio {
  obtenerCondicionesCierre(eventoId: string): Promise<DatosCondicionesCierre>;
  /** Referencias con anulación recibida pero cuya boleta ya tiene una decisión de admisión previa. */
  anulacionesConAdmisionPrevia(eventoId: string): Promise<{ referencia: string; intentoId: string }[]>;
  /** Intentos reportados por los diarios de los puntos sin decisión confirmada en D2. */
  intentosSinDecisionConfirmada(eventoId: string): Promise<number>;
  marcarBoletaExcluida(eventoId: string, referencia: string, excluida: boolean): Promise<void>;
}

/** Puerto hacia `contracting-settlement` (M4): la conciliación solo puede pedir el cobro. */
export interface LiquidacionPuerto {
  registrarCobro(eventoId: string): Promise<void>;
  saldoCobrado(eventoId: string): Promise<boolean>;
}

function segundosDelDia(fecha: Date): number {
  return fecha.getUTCHours() * 3600 + fecha.getUTCMinutes() * 60 + fecha.getUTCSeconds();
}

/**
 * M3: conciliación preliminar y definitiva de un evento contra las decisiones únicas de D2
 * (prototipo §9). El panel `#/cierre` consume `obtenerConciliacion`; las mutaciones exigen rol
 * `CIERRE` (o `FINANZAS` para el cobro), que valida la capa de rutas antes de invocar el servicio.
 */
export class ServicioConciliacion {
  private readonly conciliaciones: ConciliacionRepositorio;
  private readonly diferencias: DiferenciasRepositorio;
  private readonly deteccion: DeteccionRepositorio;
  private readonly liquidacion: LiquidacionPuerto;
  private readonly ahora: () => Date;

  constructor(
    conciliaciones: ConciliacionRepositorio,
    diferencias: DiferenciasRepositorio,
    deteccion: DeteccionRepositorio,
    liquidacion: LiquidacionPuerto,
    ahora: () => Date = () => new Date(),
  ) {
    this.conciliaciones = conciliaciones;
    this.diferencias = diferencias;
    this.deteccion = deteccion;
    this.liquidacion = liquidacion;
    this.ahora = ahora;
  }

  /** Compara las decisiones únicas de D2 contra el contador independiente (diarios/boletería) y abre diferencias nuevas. */
  async detectarDiferencias(eventoId: string): Promise<Diferencia[]> {
    const ahoraS = segundosDelDia(this.ahora());
    const nuevas: Diferencia[] = [];

    const anulaciones = await this.deteccion.anulacionesConAdmisionPrevia(eventoId);
    for (const caso of anulaciones) {
      if (await this.diferencias.existeAbiertaPorReferencia(eventoId, caso.referencia)) continue;
      nuevas.push(await this.diferencias.crear(eventoId, diferenciaAnulacion(caso.referencia, caso.intentoId, ahoraS)));
    }

    const intentosSinConfirmar = await this.deteccion.intentosSinDecisionConfirmada(eventoId);
    if (intentosSinConfirmar > 0 && !(await this.diferencias.existeAbiertaDiario(eventoId))) {
      nuevas.push(await this.diferencias.crear(eventoId, diferenciaDiario(intentosSinConfirmar, ahoraS)));
    }

    return nuevas;
  }

  private async condiciones(eventoId: string, estado: EstadoConciliacionAlmacen): Promise<CondicionCierre[]> {
    const datos = await this.deteccion.obtenerCondicionesCierre(eventoId);
    return evaluarCondicionesCierre({
      ...datos,
      preliminarEntregado: estado === 'preliminar' || estado === 'conciliado',
    });
  }

  async eventoActualId(): Promise<string | null> {
    return this.conciliaciones.obtenerEventoActualId();
  }

  async obtenerConciliacion(eventoId: string): Promise<Conciliacion> {
    const estado = await this.conciliaciones.obtenerEstado(eventoId);
    const [diferencias, condiciones, saldoCobrado] = await Promise.all([
      this.diferencias.listar(eventoId),
      this.condiciones(eventoId, estado.estado),
      this.liquidacion.saldoCobrado(eventoId),
    ]);
    return {
      estado: estado.estado,
      preliminarEnS: estado.preliminarEn ? segundosDelDia(estado.preliminarEn) : null,
      definitivoEnS: estado.definitivoEn ? segundosDelDia(estado.definitivoEn) : null,
      diferencias,
      saldoCobrado,
      condiciones,
    };
  }

  async entregarPreliminar(eventoId: string, usuario: string): Promise<Conciliacion> {
    const estado = await this.conciliaciones.obtenerEstado(eventoId);
    if (estado.estado === 'preliminar' || estado.estado === 'conciliado') {
      throw new ConflictoEstadoConciliacion('El informe preliminar ya fue entregado para este evento');
    }
    await this.detectarDiferencias(eventoId);
    const datos = await this.deteccion.obtenerCondicionesCierre(eventoId);
    if (!datos.ventanaCerrada) {
      throw new ConflictoEstadoConciliacion('La ventana de ingreso debe cerrarse antes de entregar el informe preliminar', ['ventana-cerrada']);
    }
    await this.conciliaciones.marcarPreliminar(eventoId, usuario, this.ahora());
    return this.obtenerConciliacion(eventoId);
  }

  async declararConciliado(eventoId: string, usuario: string): Promise<Conciliacion> {
    const estado = await this.conciliaciones.obtenerEstado(eventoId);
    if (estado.estado !== 'preliminar') {
      throw new ConflictoEstadoConciliacion('Solo se puede declarar conciliado tras entregar el informe preliminar');
    }
    const condiciones = await this.condiciones(eventoId, estado.estado);
    const pendientes = condicionesPendientes(condiciones);
    if (pendientes.length > 0) {
      throw new ConflictoEstadoConciliacion('Aún faltan condiciones para declarar el cierre definitivo', pendientes);
    }
    await this.conciliaciones.marcarDefinitivo(eventoId, usuario, this.ahora());
    return this.obtenerConciliacion(eventoId);
  }

  async resolverDiferencia(eventoId: string, diferenciaId: string, opcionId: string, operador: { usuario: string; rol: Rol }): Promise<Conciliacion> {
    const diferencia = await this.diferencias.obtener(eventoId, diferenciaId);
    if (!diferencia) throw new DiferenciaNoEncontrada(`No existe la diferencia ${diferenciaId} en el evento ${eventoId}`);
    if (diferencia.estado === 'resuelta') {
      throw new ConflictoEstadoConciliacion(`La diferencia ${diferenciaId} ya fue resuelta`);
    }
    const opcion = diferencia.opciones.find((candidata) => candidata.id === opcionId);
    if (!opcion) throw new OpcionInvalida(`La opción ${opcionId} no aplica a la diferencia ${diferenciaId}`);

    if (diferencia.tipo === 'anulacion' && opcionId === 'excluir-del-cobro' && diferencia.referencia) {
      await this.deteccion.marcarBoletaExcluida(eventoId, diferencia.referencia, true);
    }
    await this.diferencias.resolver(eventoId, diferenciaId, opcionId, operador, this.ahora());
    return this.obtenerConciliacion(eventoId);
  }

  async registrarCobro(eventoId: string): Promise<Conciliacion> {
    const estado = await this.conciliaciones.obtenerEstado(eventoId);
    if (estado.estado !== 'conciliado') {
      throw new ConflictoEstadoConciliacion('Solo se puede cobrar un evento declarado conciliado');
    }
    if (await this.liquidacion.saldoCobrado(eventoId)) {
      throw new ConflictoEstadoConciliacion('El saldo de este evento ya fue cobrado');
    }
    await this.liquidacion.registrarCobro(eventoId);
    return this.obtenerConciliacion(eventoId);
  }
}
