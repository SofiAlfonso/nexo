import { ErrorConsumoDuplicado, ErrorIntentoDuplicado, PROPOSITO_CONSUMO } from '../../../src/shared/domain/index.ts';
import type {
  AlcanceAutenticado,
  Boleta,
  ClaveConsumo,
  ConsumoIngreso,
  ContextoIngreso,
  Coordinador,
  EntradaBitacora,
  Evento,
  FabricaUnidadValidacion,
  IntentoDeValidacion,
  IntentoRegistrado,
  PuntoDeValidacion,
  RegistroOutbox,
  Reloj,
  ResolutorAlcance,
  ResultadoValidacion,
  Telemetria,
  UnidadValidacion,
} from '../../../src/shared/domain/index.ts';
import type { DatosIngreso } from '../../../src/shared/domain/index.ts';

export const BASE = '2026-10-10T19:00:00-05:00';
export const EVENTO = 'EVT-2026-10';
export const REFERENCIA = 'EXT-001';
export const PUNTOS: readonly PuntoDeValidacion[] = [
  { eventoId: EVENTO, puntoId: 'P-01', zonas: ['Norte'], habilitado: true },
  { eventoId: EVENTO, puntoId: 'P-02', zonas: ['Sur'], habilitado: true },
];

export class RelojFijo implements Reloj {
  private instante: Date;
  constructor(instante = BASE) {
    this.instante = new Date(instante);
  }
  ahora(): Date {
    return new Date(this.instante);
  }
  fijar(instante: string): void {
    this.instante = new Date(instante);
  }
  avanzar(ms: number): void {
    this.instante = new Date(this.instante.getTime() + ms);
  }
}

export function contexto(cambios: Partial<ContextoIngreso> = {}): ContextoIngreso {
  const instante = cambios.instante ?? new Date(BASE);
  return {
    instante,
    intento: {
      idOrigen: 'INT-00001',
      eventoId: EVENTO,
      lectorId: 'LEC-001',
      puntoId: 'P-01',
      codigo: 'COD-001',
      proposito: 'ingreso',
      zonaSolicitada: 'Norte',
      instanteLector: new Date(BASE),
    },
    evento: {
      eventoId: EVENTO,
      clienteId: 'CLI-001',
      boleteriaId: 'BOL-001',
      estado: 'abierto',
      ventana: {
        aperturaEn: new Date('2026-10-10T18:00:00-05:00'),
        cierreEn: new Date('2026-10-10T22:00:00-05:00'),
      },
      politicas: { version: 3, reingresoPermitido: false, contingenciaLocal: false },
    },
    punto: PUNTOS.find((p) => p.puntoId === cambios.intento?.puntoId) ?? PUNTOS[0]!,
    boleta: { eventoId: EVENTO, referencia: REFERENCIA, zona: 'Norte', anulacion: null, consumo: null },
    versiones: { versionPermisos: 4, versionPoliticas: 3, permisosRecibidosEn: new Date(instante.getTime() - 42_000) },
    coordinador: { coordinadorId: 'COORD-A', estado: 'operando' },
    modo: 'conectado',
    ...cambios,
  };
}

export class AlcanceFijo implements ResolutorAlcance {
  llamadas = 0;
  valor: AlcanceAutenticado = { lectorId: 'LEC-001', eventoId: EVENTO, puntoId: 'P-01', revocado: false };
  async resolver(lectorId: string): Promise<AlcanceAutenticado> {
    this.llamadas++;
    return { ...this.valor, lectorId };
  }
}

export class AutoridadFija {
  valor: Coordinador = { coordinadorId: 'COORD-A', estado: 'operando' };
  actual(): Coordinador {
    return this.valor;
  }
}

export class TelemetriaEspia implements Telemetria {
  decisiones: ResultadoValidacion[] = [];
  faltas: string[] = [];
  falla = false;
  decisionConfirmada(resultado: ResultadoValidacion): void {
    this.decisiones.push(resultado);
    if (this.falla) throw new Error('telemetría no disponible');
  }
  sinConfirmacion(_intento: IntentoDeValidacion, causa: string): void {
    this.faltas.push(causa);
    if (this.falla) throw new Error('telemetría no disponible');
  }
}

type Metodo = 'abrir' | 'buscarIntento' | 'cargarParaActualizar' | 'registrarIntento' | 'registrarConsumo' | 'agregarBitacora' | 'agregarOutbox' | 'confirmar' | 'cancelar';
export type Falla = Error | (() => void);

function clave(c: ClaveConsumo): string {
  return JSON.stringify([c.clienteId, c.eventoId, c.boleteriaId, c.referencia, c.proposito]);
}

/** T1 en memoria: todos los cambios son privados hasta confirmar; el bloqueo es por boleta. */
export class UnidadesEnMemoria implements FabricaUnidadValidacion {
  readonly datos: DatosIngreso;
  readonly intentos = new Map<string, IntentoRegistrado>();
  readonly consumos = new Map<string, ConsumoIngreso>();
  readonly bitacora: EntradaBitacora[] = [];
  readonly outbox: RegistroOutbox[] = [];
  puntoPorIntento?: (intento: IntentoDeValidacion) => PuntoDeValidacion | null;
  readonly llamadas: Record<Metodo, number> = {
    abrir: 0, buscarIntento: 0, cargarParaActualizar: 0, registrarIntento: 0,
    registrarConsumo: 0, agregarBitacora: 0, agregarOutbox: 0, confirmar: 0, cancelar: 0,
  };
  readonly fallas: Partial<Record<Metodo, Falla>> = {};
  private readonly bloqueos = new Map<string, Promise<void>>();

  constructor(datos: DatosIngreso = contexto()) {
    this.datos = datos;
  }

  fallar(metodo: Metodo): void {
    this.llamadas[metodo]++;
    const falla = this.fallas[metodo];
    if (typeof falla === 'function') falla();
    else if (falla) throw falla;
  }

  async abrir(): Promise<UnidadValidacion> {
    this.fallar('abrir');
    return new UnidadMemoria(this);
  }

  llave(eventoId: string, idOrigen: string): string {
    return `${eventoId}:${idOrigen}`;
  }

  registrarConsumoExterno(idOrigen = 'INT-EXTERNO', consumidoEn = new Date(BASE)): void {
    const { evento, boleta } = this.datos;
    if (!evento || !boleta) throw new Error('Se requiere boleta y evento');
    const c: ConsumoIngreso = {
      clave: {
        clienteId: evento.clienteId, eventoId: evento.eventoId, boleteriaId: evento.boleteriaId,
        referencia: boleta.referencia, proposito: PROPOSITO_CONSUMO,
      },
      idOrigen, puntoId: 'P-02', lectorId: 'LEC-002', consumidoEn,
    };
    this.consumos.set(clave(c.clave), c);
  }

  consumoDe(boleta: Boleta, evento: Evento): ConsumoIngreso | undefined {
    return this.consumos.get(clave({
      clienteId: evento.clienteId, eventoId: evento.eventoId, boleteriaId: evento.boleteriaId,
      referencia: boleta.referencia, proposito: PROPOSITO_CONSUMO,
    }));
  }

  async bloquear(referencia: string): Promise<() => void> {
    const anterior = this.bloqueos.get(referencia) ?? Promise.resolve();
    let liberar!: () => void;
    const siguiente = new Promise<void>((resolve) => { liberar = resolve; });
    const cola = anterior.then(() => siguiente);
    this.bloqueos.set(referencia, cola);
    await anterior;
    return () => {
      liberar();
      if (this.bloqueos.get(referencia) === cola) this.bloqueos.delete(referencia);
    };
  }
}

class UnidadMemoria implements UnidadValidacion {
  private intento: { clave: string; valor: IntentoRegistrado } | null = null;
  private consumo: ConsumoIngreso | null = null;
  private readonly entradas: EntradaBitacora[] = [];
  private readonly salidas: RegistroOutbox[] = [];
  private liberar: (() => void) | null = null;
  private readonly db: UnidadesEnMemoria;
  constructor(db: UnidadesEnMemoria) {
    this.db = db;
  }

  async buscarIntento(eventoId: string, idOrigen: string): Promise<IntentoRegistrado | null> {
    this.db.fallar('buscarIntento');
    return this.db.intentos.get(this.db.llave(eventoId, idOrigen)) ?? null;
  }
  async cargarParaActualizar(intento: IntentoDeValidacion): Promise<DatosIngreso> {
    this.db.fallar('cargarParaActualizar');
    const datos = this.db.datos;
    if (datos.boleta) this.liberar = await this.db.bloquear(`${intento.eventoId}:${datos.boleta.referencia}`);
    const consumo = datos.evento && datos.boleta && this.db.consumoDe(datos.boleta, datos.evento);
    return {
      ...datos,
      punto: this.db.puntoPorIntento ? this.db.puntoPorIntento(intento) : datos.punto,
      boleta: datos.boleta && {
        ...datos.boleta,
        consumo: consumo ? { idOrigen: consumo.idOrigen, puntoId: consumo.puntoId, consumidoEn: consumo.consumidoEn } : datos.boleta.consumo,
      },
    };
  }
  async registrarIntento(intento: IntentoDeValidacion, huella: string, resultado: ResultadoValidacion): Promise<void> {
    this.db.fallar('registrarIntento');
    const claveIntento = this.db.llave(intento.eventoId, intento.idOrigen);
    if (this.db.intentos.has(claveIntento)) throw new ErrorIntentoDuplicado();
    this.intento = { clave: claveIntento, valor: { huella, resultado } };
  }
  async registrarConsumo(consumo: ConsumoIngreso): Promise<void> {
    this.db.fallar('registrarConsumo');
    if (this.db.consumos.has(clave(consumo.clave))) throw new ErrorConsumoDuplicado();
    this.consumo = consumo;
  }
  async agregarBitacora(entrada: EntradaBitacora): Promise<void> {
    this.db.fallar('agregarBitacora');
    this.entradas.push(entrada);
  }
  async agregarOutbox(registro: RegistroOutbox): Promise<void> {
    this.db.fallar('agregarOutbox');
    this.salidas.push(registro);
  }
  async confirmar(): Promise<void> {
    this.db.fallar('confirmar');
    if (this.intento && this.db.intentos.has(this.intento.clave)) throw new ErrorIntentoDuplicado();
    if (this.consumo && this.db.consumos.has(clave(this.consumo.clave))) throw new ErrorConsumoDuplicado();
    if (this.intento) this.db.intentos.set(this.intento.clave, this.intento.valor);
    if (this.consumo) this.db.consumos.set(clave(this.consumo.clave), this.consumo);
    this.db.bitacora.push(...this.entradas);
    this.db.outbox.push(...this.salidas);
    this.liberar?.();
    this.liberar = null;
  }
  async cancelar(): Promise<void> {
    this.db.fallar('cancelar');
    this.liberar?.();
    this.liberar = null;
  }
}
