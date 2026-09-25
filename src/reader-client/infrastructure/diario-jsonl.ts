import { createHash, randomBytes } from 'node:crypto';
import { mkdir, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AcuseLoteDiario,
  LoteDiario,
  RespuestaValidacion,
  SolicitudValidacion,
} from '@nexo/shared/contracts';
import type { Decision } from '@nexo/shared/contracts';

type Registro =
  | { tipo: 'identidad'; lectorId: string; puntoId: string; eventoId: string; epoca?: string }
  | { tipo: 'intento'; secuencia: number; solicitud: SolicitudValidacion }
  | { tipo: 'resultado'; idOrigen: string; decision: Decision; respuesta?: RespuestaValidacion; latenciaMs: number }
  | { tipo: 'latido'; secuencia: number }
  | { tipo: 'lote'; lote: LoteDiario }
  | { tipo: 'acuse'; acuse: AcuseLoteDiario };

export interface IntentoPersistido {
  solicitud: SolicitudValidacion;
  decision?: Decision;
  respuesta?: RespuestaValidacion;
  latenciaMs?: number;
  confirmado: boolean;
}

const raizRepositorio = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Diario append-only por lector: cada línea se sincroniza antes de confirmar su escritura. */
export class DiarioJsonl {
  private readonly directorio: string;
  private readonly identidad: { lectorId: string; puntoId: string; eventoId: string };
  private archivo?: FileHandle;
  private cola: Promise<unknown> = Promise.resolve();
  private readonly intentos = new Map<string, IntentoPersistido>();
  private lote?: LoteDiario;
  private secuencia = 0;
  private secuenciaLatido = 0;
  private numeroLote = 0;
  private epoca = '';
  private secuenciaReservada = 0;
  private latidoReservado = 0;
  private fallo?: unknown;

  constructor(directorio: string, identidad: { lectorId: string; puntoId: string; eventoId: string }) {
    this.directorio = directorio;
    this.identidad = identidad;
  }

  async abrir(): Promise<void> {
    if (this.archivo) return;
    if (!isAbsolute(this.directorio)) throw new Error('El directorio del diario debe ser absoluto y externo al repositorio');
    await mkdir(this.directorio, { recursive: true });
    const directorioReal = await realpath(this.directorio);
    const relativo = relative(raizRepositorio, directorioReal);
    if (!relativo || (relativo !== '..' && !relativo.startsWith(`..${sep}`) && !isAbsolute(relativo))) {
      throw new Error('El directorio del diario debe estar fuera del repositorio');
    }
    const nombre = createHash('sha256').update(this.identidad.lectorId).digest('hex');
    const ruta = join(directorioReal, `${nombre}.jsonl`);
    const archivo = await open(ruta, 'a+');
    try {
      const rutaReal = await realpath(ruta);
      const relativaArchivo = relative(raizRepositorio, rutaReal);
      if (!relativaArchivo || (relativaArchivo !== '..' &&
          !relativaArchivo.startsWith(`..${sep}`) && !isAbsolute(relativaArchivo))) {
        throw new Error('Archivo de diario dentro del repositorio');
      }
      this.intentos.clear();
      this.lote = undefined;
      this.secuencia = 0;
      this.secuenciaLatido = 0;
      this.numeroLote = 0;
      this.epoca = randomBytes(8).toString('hex');
      this.identidadPersistida = false;
      this.fallo = undefined;
      const contenido = await archivo.readFile('utf8');
      const fin = contenido.lastIndexOf('\n') + 1;
      // La única línea incompleta pudo ser interrumpida durante un corte de energía.
      if (fin < contenido.length) {
        await archivo.truncate(Buffer.byteLength(contenido.slice(0, fin)));
        await archivo.sync();
      }
      for (const linea of contenido.slice(0, fin).split('\n')) {
        if (linea) this.aplicar(JSON.parse(linea) as Registro);
      }
      this.secuenciaReservada = this.secuencia;
      this.latidoReservado = this.secuenciaLatido;
      this.archivo = archivo;
      if (fin === 0) await this.anexar({ tipo: 'identidad', ...this.identidad, epoca: this.epoca });
      else if (!this.identidadPersistida) throw new Error('Diario sin identidad de lector');
    } catch (error) {
      this.archivo = undefined;
      await archivo.close();
      throw error;
    }
  }

  private identidadPersistida = false;

  private aplicar(registro: Registro): void {
    switch (registro.tipo) {
      case 'identidad':
        if (this.identidadPersistida || registro.lectorId !== this.identidad.lectorId ||
            registro.puntoId !== this.identidad.puntoId || registro.eventoId !== this.identidad.eventoId) {
          throw new Error('Identidad incompatible en diario de lector');
        }
        if (registro.epoca !== undefined && !/^[0-9a-f]{16}$/.test(registro.epoca)) {
          throw new Error('Época inválida en diario de lector');
        }
        this.epoca = registro.epoca ?? '';
        this.identidadPersistida = true;
        break;
      case 'intento': {
        const solicitud = SolicitudValidacion.parse(registro.solicitud);
        if (this.intentos.has(solicitud.idOrigen) || registro.secuencia <= this.secuencia) {
          throw new Error('Secuencia de diario inválida');
        }
        this.secuencia = registro.secuencia;
        this.intentos.set(solicitud.idOrigen, { solicitud, confirmado: false });
        break;
      }
      case 'resultado': {
        const intento = this.intentos.get(registro.idOrigen);
        if (!intento) throw new Error('Resultado sin intento en diario');
        const respuesta = registro.respuesta && RespuestaValidacion.parse(registro.respuesta);
        if (respuesta?.idOrigen !== undefined && respuesta.idOrigen !== registro.idOrigen) {
          throw new Error('Respuesta de otro intento en diario');
        }
        intento.decision = registro.decision;
        intento.respuesta = respuesta;
        intento.latenciaMs = registro.latenciaMs;
        break;
      }
      case 'latido':
        if (registro.secuencia <= this.secuenciaLatido) throw new Error('Secuencia de latido inválida');
        this.secuenciaLatido = registro.secuencia;
        break;
      case 'lote':
        if (this.lote) throw new Error('Lote pendiente sin acuse');
        this.lote = LoteDiario.parse(registro.lote);
        this.numeroLote++;
        break;
      case 'acuse': {
        const acuse = AcuseLoteDiario.parse(registro.acuse);
        if (!this.lote || acuse.idLote !== this.lote.idLote) throw new Error('Acuse de lote desconocido');
        const ids = new Set(this.lote.registros.map((r) => r.idOrigen));
        const confirmados = [...acuse.aceptados, ...acuse.duplicados, ...acuse.yaDecididos];
        if (confirmados.length !== ids.size || new Set(confirmados).size !== ids.size ||
            confirmados.some((id) => !ids.has(id))) throw new Error('Acuse incompleto o incompatible');
        for (const id of confirmados) this.intentos.get(id)!.confirmado = true;
        this.lote = undefined;
        break;
      }
      default:
        throw new Error('Registro desconocido en diario');
    }
  }

  private async anexar(registro: Registro): Promise<void> {
    const operacion = this.cola.then(async () => {
      if (this.fallo) throw new Error('Diario dañado: reiniciar y recuperar desde disco', { cause: this.fallo });
      if (!this.archivo) throw new Error('Diario cerrado');
      await this.archivo.writeFile(`${JSON.stringify(registro)}\n`);
      await this.archivo.sync();
      this.aplicar(registro);
    });
    this.cola = operacion.catch((error: unknown) => { this.fallo = error; });
    await operacion;
  }

  private prefijoId(): string {
    return /^[A-Za-z0-9._:-]+$/.test(this.identidad.lectorId)
      ? this.identidad.lectorId
      : createHash('sha256').update(this.identidad.lectorId).digest('hex').slice(0, 20);
  }

  async nuevoIntento(datos: Omit<SolicitudValidacion, 'idOrigen'>): Promise<SolicitudValidacion> {
    const secuencia = ++this.secuenciaReservada;
    const solicitud = SolicitudValidacion.parse({
      ...datos, idOrigen: `${this.prefijoId().slice(0, 100)}:${this.epoca ? `${this.epoca}:` : ''}${String(secuencia).padStart(8, '0')}`,
    });
    await this.anexar({ tipo: 'intento', secuencia, solicitud });
    return solicitud;
  }

  async resultado(idOrigen: string, decision: Decision, latenciaMs: number, respuesta?: RespuestaValidacion): Promise<void> {
    if (!this.intentos.has(idOrigen)) throw new Error(`Intento desconocido: ${idOrigen}`);
    if (respuesta && (respuesta.idOrigen !== idOrigen || respuesta.decision !== decision)) {
      throw new Error('Respuesta incompatible con intento de diario');
    }
    await this.anexar({ tipo: 'resultado', idOrigen, decision, latenciaMs, ...(respuesta ? { respuesta } : {}) });
  }

  obtener(idOrigen: string): IntentoPersistido | undefined {
    return this.intentos.get(idOrigen);
  }

  pendientes(excluir: ReadonlySet<string> = new Set()): IntentoPersistido[] {
    return [...this.intentos.values()].filter((intento) =>
      !intento.confirmado && (!intento.respuesta || intento.respuesta.decision === 'sin-respuesta') &&
      !excluir.has(intento.solicitud.idOrigen));
  }

  estado(): { diarioTotal: number; pendientesDiario: number; secuencia: number; secuenciaLatido: number } {
    return {
      diarioTotal: this.intentos.size,
      pendientesDiario: this.pendientes().length,
      secuencia: this.secuencia,
      secuenciaLatido: this.secuenciaLatido,
    };
  }

  async nuevoLatido(): Promise<number> {
    const secuencia = ++this.latidoReservado;
    await this.anexar({ tipo: 'latido', secuencia });
    return secuencia;
  }

  lotePendiente(): LoteDiario | undefined {
    return this.lote;
  }

  async crearLote(lote: LoteDiario): Promise<void> {
    if (this.lote) throw new Error('Hay un lote pendiente sin acuse');
    await this.anexar({ tipo: 'lote', lote: LoteDiario.parse(lote) });
  }

  siguienteIdLote(): string {
    return `${this.prefijoId()}:${this.epoca ? `${this.epoca}:` : ''}lote:${this.numeroLote + 1}`;
  }

  async confirmarLote(acuse: AcuseLoteDiario): Promise<void> {
    if (!this.lote || acuse.idLote !== this.lote.idLote) throw new Error('Acuse de lote desconocido');
    const ids = new Set(this.lote.registros.map((r) => r.idOrigen));
    const confirmados = [...acuse.aceptados, ...acuse.duplicados, ...acuse.yaDecididos];
    if (confirmados.length !== ids.size || new Set(confirmados).size !== ids.size ||
        confirmados.some((id) => !ids.has(id))) throw new Error('Acuse incompleto o incompatible');
    await this.anexar({ tipo: 'acuse', acuse });
  }

  async cerrar(): Promise<void> {
    await this.cola;
    const archivo = this.archivo;
    this.archivo = undefined;
    await archivo?.close();
  }
}
