import {
  Latido,
  LoteDiario,
  MAX_REGISTROS_DIARIO,
  RegistroDiario,
  RespuestaValidacion,
  AcuseLatido,
  AcuseLoteDiario,
  SolicitudValidacion,
} from '@nexo/shared/contracts';
import type { Decision, Proposito } from '@nexo/shared/contracts';
import { ClienteHttpCoordinador, ErrorHttpCoordinador } from '../infrastructure/cliente-coordinador.ts';
import type { CoordinadorLector, CredencialesCoordinador } from '../infrastructure/cliente-coordinador.ts';
import { DiarioJsonl } from '../infrastructure/diario-jsonl.ts';
import { registrarResultadoLector } from '../infrastructure/telemetria/metricas-lector.ts';

export interface OpcionesLector {
  lectorId: string;
  puntoId: string;
  eventoId: string;
  /** Ruta absoluta externa al repositorio, exclusiva para la instancia local del lector. */
  directorio: string;
  coordinador: string | URL | CoordinadorLector;
  tls?: CredencialesCoordinador;
  timeoutMs?: number;
  heartbeatMs?: number;
  logger?: Pick<Console, 'warn' | 'error'>;
}

export interface ResultadoPresentacion {
  solicitud: SolicitudValidacion;
  respuesta?: RespuestaValidacion;
  decision: Decision;
  latenciaMs: number;
}

/**
 * C1 no concede acceso: únicamente retransmite la decisión de C2.
 * `sin-respuesta` (incluida una respuesta V1 no confirmada) nunca autoriza.
 */
export class LectorEmulado {
  private readonly opciones: OpcionesLector;
  private readonly diario: DiarioJsonl;
  private readonly coordinador: CoordinadorLector;
  private readonly clientePropio?: ClienteHttpCoordinador;
  private readonly timeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly logger: Pick<Console, 'warn' | 'error'>;
  private readonly enVuelo = new Map<string, Promise<ResultadoPresentacion>>();
  private intervalo?: NodeJS.Timeout;
  private sincronizacion?: Promise<number>;
  private latidoEnVuelo?: Promise<void>;
  private iniciado = false;
  private errorFondo?: unknown;
  private versionPermisos: number | null = null;

  constructor(opciones: OpcionesLector) {
    this.opciones = opciones;
    this.timeoutMs = opciones.timeoutMs ?? 500;
    this.heartbeatMs = opciones.heartbeatMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 ||
        !Number.isFinite(this.heartbeatMs) || this.heartbeatMs <= 0) {
      throw new RangeError('timeoutMs y heartbeatMs deben ser positivos');
    }
    if (typeof opciones.coordinador === 'string' || opciones.coordinador instanceof URL) {
      this.clientePropio = new ClienteHttpCoordinador(opciones.coordinador, opciones.tls);
      this.coordinador = this.clientePropio;
    } else {
      if (opciones.tls) throw new Error('TLS requiere URL de coordinador');
      this.coordinador = opciones.coordinador;
    }
    this.logger = opciones.logger ?? console;
    this.diario = new DiarioJsonl(opciones.directorio, opciones);
  }

  async iniciar(): Promise<void> {
    if (this.iniciado) return;
    await this.diario.abrir();
    this.iniciado = true;
    this.intervalo = setInterval(() => {
      void this.enviarLatido().catch((error: unknown) => this.reportar('latido', error));
      void this.sincronizarDiario().catch((error: unknown) => this.reportar('diario', error));
    }, this.heartbeatMs);
    this.intervalo.unref();
    // Se recuperan intentos previos sin bloquear la operación del lector.
    void this.sincronizarDiario().catch((error: unknown) => this.reportar('recuperación', error));
  }

  async detener(): Promise<void> {
    if (!this.iniciado) return;
    if (this.intervalo) clearInterval(this.intervalo);
    this.intervalo = undefined;
    await Promise.allSettled([...this.enVuelo.values(), this.sincronizacion, this.latidoEnVuelo]);
    await this.diario.cerrar();
    await this.clientePropio?.cerrar();
    this.iniciado = false;
  }

  private exigirInicio(): void {
    if (!this.iniciado) throw new Error('El lector debe iniciarse primero');
  }

  private reportar(operacion: string, error: unknown): void {
    this.errorFondo = error;
    this.logger.error(`Error de ${operacion} del lector ${this.opciones.lectorId}:`, error);
  }

  private async conTiempo<T>(operacion: Promise<T>): Promise<T> {
    let temporizador: NodeJS.Timeout | undefined;
    const limite = new Promise<never>((_, reject) => {
      temporizador = setTimeout(() => reject(new DOMException('Tiempo agotado', 'TimeoutError')), this.timeoutMs);
    });
    try {
      return await Promise.race([operacion, limite]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }

  async presentar(datos: { codigo: string; zonaSolicitada: string; proposito?: Proposito }): Promise<ResultadoPresentacion> {
    this.exigirInicio();
    const solicitud = await this.diario.nuevoIntento({
      eventoId: this.opciones.eventoId,
      lectorId: this.opciones.lectorId,
      puntoId: this.opciones.puntoId,
      codigo: datos.codigo,
      zonaSolicitada: datos.zonaSolicitada,
      proposito: datos.proposito ?? 'ingreso',
      instanteLector: new Date().toISOString(),
    });
    return this.enviar(solicitud);
  }

  async reintentar(idOrigen: string): Promise<ResultadoPresentacion> {
    this.exigirInicio();
    const intento = this.diario.obtener(idOrigen);
    if (!intento) throw new Error(`Intento desconocido: ${idOrigen}`);
    return this.enviar(intento.solicitud);
  }

  private enviar(solicitud: SolicitudValidacion): Promise<ResultadoPresentacion> {
    const anterior = this.enVuelo.get(solicitud.idOrigen);
    if (anterior) return anterior;
    const envio = this.enviarUnaVez(solicitud);
    this.enVuelo.set(solicitud.idOrigen, envio);
    void envio.finally(() => this.enVuelo.delete(solicitud.idOrigen)).catch(() => undefined);
    return envio;
  }

  private async enviarUnaVez(solicitud: SolicitudValidacion): Promise<ResultadoPresentacion> {
    const inicio = performance.now();
    let respuesta: RespuestaValidacion | undefined;
    let errorFatal: unknown;
    try {
      const recibida = RespuestaValidacion.parse(
        await this.conTiempo(this.coordinador.validar(SolicitudValidacion.parse(solicitud), this.timeoutMs)),
      );
      if (recibida.idOrigen !== solicitud.idOrigen) throw new Error('C2 respondió con otro idOrigen');
      respuesta = recibida;
    } catch (error) {
      if (!(error instanceof ErrorHttpCoordinador && error.status >= 500) &&
          !(error instanceof DOMException && error.name === 'TimeoutError') &&
          !(error instanceof TypeError)) errorFatal = error;
      this.logger.warn(`V1 sin confirmación del lector ${this.opciones.lectorId}, idOrigen ${solicitud.idOrigen}:`, error);
    }
    const latenciaMs = Math.max(0, performance.now() - inicio);
    const decision = respuesta?.decision ?? 'sin-respuesta';
    registrarResultadoLector(decision, latenciaMs);
    await this.diario.resultado(solicitud.idOrigen, decision, latenciaMs, respuesta);
    if (respuesta) this.versionPermisos = respuesta.versionPermisos;
    if (errorFatal) throw errorFatal;
    return { solicitud, ...(respuesta ? { respuesta } : {}), decision, latenciaMs };
  }

  async enviarLatido(): Promise<void> {
    this.exigirInicio();
    if (this.latidoEnVuelo) return this.latidoEnVuelo;
    const tarea = (async () => {
      const secuencia = await this.diario.nuevoLatido();
      const estado = this.diario.estado();
      const latido = Latido.parse({
        lectorId: this.opciones.lectorId,
        puntoId: this.opciones.puntoId,
        eventoId: this.opciones.eventoId,
        instanteLector: new Date().toISOString(),
        secuencia,
        estadoLector: 'operativo',
        pendientesDiario: estado.pendientesDiario,
        diarioTotal: estado.diarioTotal,
        versionPermisos: this.versionPermisos,
      });
      AcuseLatido.parse(await this.conTiempo(this.coordinador.latido(latido, this.timeoutMs)));
    })();
    this.latidoEnVuelo = tarea;
    try { await tarea; } finally { this.latidoEnVuelo = undefined; }
  }

  async sincronizarDiario(): Promise<number> {
    this.exigirInicio();
    if (this.sincronizacion) return this.sincronizacion;
    const tarea = this.enviarDiario();
    this.sincronizacion = tarea;
    try { return await tarea; } finally { this.sincronizacion = undefined; }
  }

  private async enviarDiario(): Promise<number> {
    let total = 0;
    while (true) {
      let lote = this.diario.lotePendiente();
      if (!lote) {
        const pendientes = this.diario.pendientes(new Set(this.enVuelo.keys())).slice(0, MAX_REGISTROS_DIARIO);
        if (!pendientes.length) return total;
        lote = LoteDiario.parse({
          idLote: this.diario.siguienteIdLote(),
          lectorId: this.opciones.lectorId,
          puntoId: this.opciones.puntoId,
          eventoId: this.opciones.eventoId,
          registros: pendientes.map((intento): RegistroDiario => RegistroDiario.parse({
            idOrigen: intento.solicitud.idOrigen,
            codigo: intento.solicitud.codigo,
            proposito: intento.solicitud.proposito,
            zonaSolicitada: intento.solicitud.zonaSolicitada,
            instanteLector: intento.solicitud.instanteLector,
            motivoLocal: 'SIN_COORDINADOR',
            latenciaMs: intento.latenciaMs ?? null,
          })),
        });
        await this.diario.crearLote(lote);
      }
      const acuse = AcuseLoteDiario.parse(await this.conTiempo(this.coordinador.loteDiario(lote, this.timeoutMs)));
      if (acuse.idLote !== lote.idLote) throw new Error('Acuse de lote con idLote distinto');
      const confirmados = [...acuse.aceptados, ...acuse.duplicados, ...acuse.yaDecididos];
      if (confirmados.length !== lote.registros.length ||
          new Set(confirmados).size !== lote.registros.length ||
          confirmados.some((id) => !lote.registros.some((r) => r.idOrigen === id))) {
        throw new Error(`Acuse incompleto del lote ${lote.idLote}; se reintentará sin cambiar el lote`);
      }
      await this.diario.confirmarLote(acuse);
      total += lote.registros.length;
    }
  }

  estado(): ReturnType<DiarioJsonl['estado']> & {
    lectorId: string; puntoId: string; iniciado: boolean; ultimoError?: unknown;
  } {
    return {
      ...this.diario.estado(),
      lectorId: this.opciones.lectorId,
      puntoId: this.opciones.puntoId,
      iniciado: this.iniciado,
      ...(this.errorFondo ? { ultimoError: this.errorFondo } : {}),
    };
  }
}
