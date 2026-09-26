import type { PaquetePermisos } from '@nexo/shared/contracts';
import { verificarFirma } from './firma.ts';
import type { ResultadoInstalacion } from './instalador-d1.ts';

export type ResultadoSincronizacion = {
  resultado: ResultadoInstalacion['resultado'] | 'firma-invalida' | 'otro-evento' | 'error';
  versionInstalada: number;
  versionAnterior?: number;
  cambiosAplicados?: number;
  anulaciones?: number;
};

type Log = {
  info(obj: object, mensaje: string): void;
  warn(obj: object, mensaje: string): void;
  error(obj: object, mensaje: string): void;
};

export interface OpcionesSincronizador {
  eventoId: string;
  cliente: { obtener(eventoId: string, desdeVersion: number): Promise<PaquetePermisos> };
  instalar(paquete: PaquetePermisos, recibidoEn: Date): Promise<ResultadoInstalacion>;
  versionInstalada(): Promise<number>;
  secreto: string;
  intervaloMs: number;
  log: Log;
  ahora?: () => Date;
}

export class SincronizadorPermisos {
  private readonly opciones: OpcionesSincronizador;
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private enCurso: Promise<ResultadoSincronizacion> | null = null;
  private version = 0;
  private ultimaSincronizacionEn: Date | null = null;
  private ultimoError: string | null = null;

  constructor(opciones: OpcionesSincronizador) {
    this.opciones = opciones;
  }

  sincronizar(): Promise<ResultadoSincronizacion> {
    if (this.enCurso) return this.enCurso;
    const tarea = this.ejecutar();
    this.enCurso = tarea;
    void tarea.finally(() => { this.enCurso = null; });
    return tarea;
  }

  private async ejecutar(): Promise<ResultadoSincronizacion> {
    const { eventoId, cliente, instalar, versionInstalada, secreto, log } = this.opciones;
    try {
      this.version = await versionInstalada();
      for (let intento = 0; intento < 2; intento++) {
        const paquete = await cliente.obtener(eventoId, this.version);
        if (!verificarFirma(paquete, secreto)) {
          this.ultimoError = 'firma-invalida';
          log.warn({ eventoId }, 'Firma P2 inválida');
          return { resultado: 'firma-invalida', versionInstalada: this.version };
        }
        if (paquete.eventoId !== eventoId) {
          this.ultimoError = 'otro-evento';
          log.warn({ eventoId, eventoRecibido: paquete.eventoId }, 'Paquete P2 de otro evento');
          return { resultado: 'otro-evento', versionInstalada: this.version };
        }
        const recibidoEn = (this.opciones.ahora ?? (() => new Date()))();
        const resultado = await instalar(paquete, recibidoEn);
        this.version = resultado.versionInstalada;
        if (resultado.resultado === 'hueco' && intento === 0) {
          this.version = await versionInstalada();
          continue;
        }
        if (resultado.resultado === 'hueco' || resultado.resultado === 'retroceso') {
          this.ultimoError = resultado.resultado;
          log.warn({ eventoId, ...resultado }, 'Paquete P2 rechazado');
        } else {
          this.ultimaSincronizacionEn = recibidoEn;
          this.ultimoError = null;
          if (resultado.cambiosAplicados > 0) {
            log.info({ eventoId, versionAnterior: resultado.versionAnterior,
              versionInstalada: resultado.versionInstalada, cambios: resultado.cambiosAplicados,
              anulaciones: resultado.anulaciones }, 'Permisos P2 instalados');
          }
        }
        return resultado;
      }
      throw new Error('No se pudo recuperar el hueco P2');
    } catch (error) {
      this.ultimoError = error instanceof Error ? error.message : String(error);
      log.warn({ eventoId, error: this.ultimoError }, 'Error al sincronizar permisos P2');
      return { resultado: 'error', versionInstalada: this.version };
    }
  }

  iniciar(): void {
    if (this.temporizador) return;
    void this.sincronizar();
    this.temporizador = setInterval(() => { void this.sincronizar(); }, this.opciones.intervaloMs);
    this.temporizador.unref();
  }

  async detener(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
    await this.enCurso;
  }

  estado(ahora: Date = new Date()): {
    versionInstalada: number; ultimaSincronizacionEn: Date | null;
    ultimoError: string | null; antiguedadPermisosS: number | null;
  } {
    return {
      versionInstalada: this.version,
      ultimaSincronizacionEn: this.ultimaSincronizacionEn,
      ultimoError: this.ultimoError,
      antiguedadPermisosS: this.ultimaSincronizacionEn === null ? null
        : Math.max(0, (ahora.getTime() - this.ultimaSincronizacionEn.getTime()) / 1_000),
    };
  }
}
