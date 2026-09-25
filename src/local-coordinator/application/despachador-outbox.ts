import { randomUUID } from 'node:crypto';
import {
  AcuseLoteEvidencia,
  LoteEvidencia,
  MAX_REGISTROS_LOTE,
} from '@nexo/shared/contracts';
import type { EstadoCoordinador, RegistroLatidoPunto } from '@nexo/shared/contracts';
import type { OutboxPendiente, PendienteOutbox } from '@nexo/shared/domain';
import type { ConfigCoordinador } from '../config.ts';
import type { RegistroLatidos } from './latidos.ts';
import type { ContadorV1 } from './prioridad.ts';

export interface EstadoParaE1 {
  estado: EstadoCoordinador;
  versionPermisos: number;
  versionPoliticas: number;
}

export interface ClienteE1 {
  enviar(lote: LoteEvidencia, signal?: AbortSignal): Promise<AcuseLoteEvidencia>;
}

export interface OpcionesDespachador {
  outbox: OutboxPendiente;
  latidos: RegistroLatidos;
  v1: ContadorV1;
  cliente: ClienteE1;
  config: Pick<ConfigCoordinador, 'eventoId' | 'recintoId' | 'coordinadorId' | 'loteEvidenciaMax'>;
  estado: () => EstadoParaE1;
  reloj?: { ahora(): Date };
  intervaloMs?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  esperaMaxV1Ms?: number;
  generarIdLote?: () => string;
  log?: { info(o: object, m?: string): void; warn(o: object, m?: string): void; error(o: object, m?: string): void };
}

interface LotePendiente {
  lote: LoteEvidencia;
  filas: PendienteOutbox[];
  latidos: RegistroLatidoPunto[];
}

export class DespachadorOutbox {
  private readonly o: OpcionesDespachador;
  private readonly intervaloMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly esperaMaxV1Ms: number;
  private capacidad: number;
  private pendiente: LotePendiente | null = null;
  private ultimoEstadoEnviado: Date | null = null;
  private ultimoEnvioOk: Date | null = null;
  private fallosConsecutivos = 0;
  private pendientes = 0;
  private edadMaxS = 0;
  private enLinea = false;
  private activo = false;
  private timer: NodeJS.Timeout | null = null;
  private ciclo: Promise<{ enviados: number; pendientes: number; error?: string }> | null = null;

  constructor(o: OpcionesDespachador) {
    this.o = o;
    this.intervaloMs = o.intervaloMs ?? 1000;
    this.backoffBaseMs = o.backoffBaseMs ?? 500;
    this.backoffMaxMs = o.backoffMaxMs ?? 30_000;
    this.esperaMaxV1Ms = o.esperaMaxV1Ms ?? 200;
    this.capacidad = this.capacidadMax();
  }

  /** Al menos 2: un registro de estado más, como mínimo, uno del outbox. */
  private capacidadMax(): number {
    return Math.max(2, Math.min(MAX_REGISTROS_LOTE, this.o.config.loteEvidenciaMax));
  }

  iniciar(): void {
    if (this.activo) return;
    this.activo = true;
    this.programar(0);
  }

  async detener(): Promise<void> {
    this.activo = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.ciclo) await this.ciclo;
  }

  ejecutarCiclo(): Promise<{ enviados: number; pendientes: number; error?: string }> {
    if (this.ciclo) return this.ciclo;
    const ciclo = this.procesarCiclo();
    this.ciclo = ciclo;
    void ciclo.finally(() => {
      if (this.ciclo === ciclo) this.ciclo = null;
    });
    return ciclo;
  }

  metricas(): { pendientes: number; edadMaxS: number; ultimoEnvioOk: Date | null; fallosConsecutivos: number; enLinea: boolean } {
    return {
      pendientes: this.pendientes,
      edadMaxS: this.edadMaxS,
      ultimoEnvioOk: this.ultimoEnvioOk,
      fallosConsecutivos: this.fallosConsecutivos,
      enLinea: this.enLinea,
    };
  }

  private programar(ms: number): void {
    if (!this.activo) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.ejecutarCiclo().then((r) => {
        const espera = r.error
          ? Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** Math.min(this.fallosConsecutivos, 30)) * (0.5 + Math.random() * 0.5)
          : r.enviados > 0 && r.pendientes > 0 ? 0 : this.intervaloMs;
        this.programar(espera);
      }).catch((error: unknown) => {
        this.o.log?.error({ error }, 'Fallo inesperado del despachador E1');
        this.programar(this.backoffMaxMs);
      });
    }, ms);
    this.timer.unref();
  }

  private async procesarCiclo(): Promise<{ enviados: number; pendientes: number; error?: string }> {
    let latidosTomados: RegistroLatidoPunto[] = [];
    try {
      await this.o.v1.esperarLibre(this.esperaMaxV1Ms);
      const ahora = this.o.reloj?.ahora() ?? new Date();
      if (!this.pendiente) {
        const resumen = await this.o.outbox.resumen(ahora);
        this.pendientes = resumen.pendientes;
        this.edadMaxS = resumen.edadMaxS;
        const latidos = this.o.latidos.tomarPendientes();
        latidosTomados = latidos;
        const disponibles = this.capacidad - 1;
        // Las decisiones tienen prioridad sobre los latidos: estos solo ocupan el espacio sobrante.
        const filas = await this.o.outbox.pendientes(disponibles);
        const seleccionados = latidos.slice(0, disponibles - filas.length);
        this.o.latidos.devolver(latidos.slice(seleccionados.length));
        latidosTomados = seleccionados;
        // Sin novedades, el estado solo se publica cada cinco sondeos.
        if (filas.length === 0 && seleccionados.length === 0 &&
          this.ultimoEstadoEnviado && ahora.getTime() - this.ultimoEstadoEnviado.getTime() < this.intervaloMs * 5) {
          return { enviados: 0, pendientes: this.pendientes };
        }
        const estado = this.o.estado();
        const lote = LoteEvidencia.parse({
          idLote: this.o.generarIdLote?.() ?? `${this.o.config.coordinadorId}-${ahora.getTime()}-${randomUUID()}`,
          recintoId: this.o.config.recintoId,
          eventoId: this.o.config.eventoId,
          coordinadorId: this.o.config.coordinadorId,
          emitidoEn: ahora.toISOString(),
          registros: [
            ...filas.map((fila) => fila.registro),
            ...seleccionados,
            {
              tipo: 'estado-coordinador',
              idOrigen: `${this.o.config.coordinadorId}:estado:${ahora.getTime()}`,
              coordinadorId: this.o.config.coordinadorId,
              estado: estado.estado,
              instante: ahora.toISOString(),
              versionPermisos: estado.versionPermisos,
              versionPoliticas: estado.versionPoliticas,
              outboxPendientes: resumen.pendientes,
              outboxEdadMaxS: resumen.edadMaxS,
            },
          ],
        });
        this.pendiente = { lote, filas, latidos: seleccionados };
        latidosTomados = [];
      }
      const actual = this.pendiente;
      const acuse = AcuseLoteEvidencia.parse(await this.o.cliente.enviar(actual.lote));
      if (acuse.idLote !== actual.lote.idLote ||
        acuse.resultados.length !== actual.lote.registros.length ||
        acuse.aceptados + acuse.duplicados !== actual.lote.registros.length ||
        actual.lote.registros.some((r, i) => acuse.resultados[i]?.tipo !== r.tipo || acuse.resultados[i]?.idOrigen !== r.idOrigen)) {
        throw new Error('Acuse E1 no corresponde al lote enviado');
      }
      await this.o.outbox.registrarAcuse(actual.filas.map((fila) => fila.id), actual.lote.idLote, this.o.reloj?.ahora() ?? new Date());
      this.pendiente = null;
      // Tras un 413, la capacidad se recupera gradualmente con cada lote aceptado.
      this.capacidad = Math.min(this.capacidadMax(), this.capacidad * 2);
      this.ultimoEnvioOk = this.o.reloj?.ahora() ?? new Date();
      this.ultimoEstadoEnviado = this.ultimoEnvioOk;
      this.fallosConsecutivos = 0;
      this.enLinea = true;
      const resumen = await this.o.outbox.resumen(this.ultimoEnvioOk);
      this.pendientes = resumen.pendientes;
      this.edadMaxS = resumen.edadMaxS;
      this.o.log?.info({ idLote: actual.lote.idLote, enviados: actual.filas.length }, 'Lote E1 confirmado');
      return { enviados: actual.filas.length, pendientes: this.pendientes };
    } catch (error) {
      if (latidosTomados.length) this.o.latidos.devolver(latidosTomados);
      this.fallosConsecutivos++;
      this.enLinea = false;
      if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413 && this.pendiente) {
        this.capacidad = Math.max(2, Math.floor(this.capacidad / 2));
        this.o.latidos.devolver(this.pendiente.latidos);
        this.pendiente = null;
      }
      const mensaje = error instanceof Error ? error.message : String(error);
      this.o.log?.warn({ error: mensaje, fallosConsecutivos: this.fallosConsecutivos }, 'Fallo de envío E1');
      return { enviados: 0, pendientes: this.pendientes, error: mensaje };
    }
  }
}
