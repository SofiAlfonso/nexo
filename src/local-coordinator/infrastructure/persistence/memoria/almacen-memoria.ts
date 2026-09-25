import type { AcuseLoteDiario, LoteDiario } from '@nexo/shared/contracts';
import { ErrorConflictoIdempotencia, ErrorConsumoDuplicado, ErrorIntentoDuplicado } from '@nexo/shared/domain';
import type {
  Boleta, ConsumoIngreso, EntradaBitacora, Evento, IntentoDeValidacion, IntentoRegistrado,
  PendienteOutbox, PuntoDeValidacion, RegistroOutbox, ResultadoValidacion, UnidadValidacion,
  VersionesInstaladas,
} from '@nexo/shared/domain';
import type { Almacen } from '../../../application/puertos.ts';

export interface SemillaMemoria {
  evento: Evento;
  versiones: VersionesInstaladas;
  puntos: PuntoDeValidacion[];
  lectores: { lectorId: string; eventoId: string; puntoId: string; revocado?: boolean }[];
  boletas: { referencia: string; zona: string; anulacion?: Boleta['anulacion'] }[];
}

const clave = (...partes: string[]) => JSON.stringify(partes);

export function crearAlmacenMemoria(opciones: { fallar?: (operacion: string) => boolean } = {}) {
  let caido = false;
  let semilla: SemillaMemoria | null = null;
  const intentos = new Map<string, IntentoRegistrado>();
  const consumos = new Map<string, ConsumoIngreso>();
  const bitacora: EntradaBitacora[] = [];
  const filas: PendienteOutbox[] = [];
  const clavesOutbox = new Set<string>();
  const acuses = new Map<number, { idLote: string; acusadoEn: Date }>();
  const lotes = new Map<string, { contenido: string; acuse: AcuseLoteDiario }>();
  const diario = new Set<string>();
  const bloqueos = new Map<string, Promise<void>>();
  const claveConsumo = (c: ConsumoIngreso['clave']) =>
    clave(c.clienteId, c.eventoId, c.boleteriaId, c.referencia, c.proposito);

  function disponible(operacion: string): void {
    if (caido || opciones.fallar?.(operacion)) throw new Error(`D1 no disponible: ${operacion}`);
  }
  function agregar(registro: RegistroOutbox): void {
    const k = clave(registro.eventoId, registro.registro.tipo, registro.registro.idOrigen);
    if (clavesOutbox.has(k)) return;
    clavesOutbox.add(k);
    filas.push({ ...registro, id: filas.length + 1, creadoEn: new Date() });
  }

  const almacen: Almacen & {
    sembrar(datos: SemillaMemoria): void;
    simularCaida(caido: boolean): void;
    volcado(): { intentos: IntentoRegistrado[]; consumos: ConsumoIngreso[]; bitacora: EntradaBitacora[]; outbox: PendienteOutbox[]; diario: string[] };
  } = {
    sembrar(datos) {
      disponible('sembrar');
      semilla = structuredClone(datos);
      intentos.clear();
      consumos.clear();
      bitacora.length = 0;
      filas.length = 0;
      clavesOutbox.clear();
      acuses.clear();
      lotes.clear();
      diario.clear();
    },
    simularCaida(valor) { caido = valor; },
    volcado() {
      disponible('volcado');
      return structuredClone({
        intentos: [...intentos.values()], consumos: [...consumos.values()],
        bitacora, outbox: filas, diario: [...diario],
      });
    },
    unidades: {
      async abrir(): Promise<UnidadValidacion> {
        disponible('abrir');
        let cerrado = false;
        let liberar: (() => void) | null = null;
        const nuevosIntentos = new Map<string, IntentoRegistrado>();
        const nuevosConsumos = new Map<string, ConsumoIngreso>();
        const nuevasEntradas: EntradaBitacora[] = [];
        const nuevosOutbox: RegistroOutbox[] = [];
        const activo = (operacion: string) => {
          disponible(operacion);
          if (cerrado) throw new Error('Unidad cerrada');
        };
        const cerrar = () => {
          cerrado = true;
          liberar?.();
          liberar = null;
        };
        return {
          async buscarIntento(eventoId, idOrigen) {
            activo('buscarIntento');
            return structuredClone(intentos.get(clave(eventoId, idOrigen)) ?? null);
          },
          async cargarParaActualizar(intento: IntentoDeValidacion) {
            activo('cargarParaActualizar');
            const llave = clave(intento.eventoId, intento.codigo);
            const anterior = bloqueos.get(llave);
            let soltar!: () => void;
            const turno = new Promise<void>((resolve) => { soltar = resolve; });
            bloqueos.set(llave, turno);
            if (anterior) await anterior;
            liberar = () => {
              if (bloqueos.get(llave) === turno) bloqueos.delete(llave);
              soltar();
            };
            activo('cargarParaActualizar');
            const datos = semilla?.evento.eventoId === intento.eventoId ? semilla : null;
            const boleta = datos?.boletas.find((b) => b.referencia === intento.codigo);
            const consumo = datos && boleta
              ? consumos.get(claveConsumo({
                clienteId: datos.evento.clienteId, eventoId: intento.eventoId,
                boleteriaId: datos.evento.boleteriaId, referencia: boleta.referencia, proposito: 'PRIMER_INGRESO',
              }))
              : null;
            return structuredClone({
              evento: datos?.evento ?? null,
              punto: datos?.puntos.find((p) => p.puntoId === intento.puntoId) ?? null,
              boleta: boleta ? {
                eventoId: intento.eventoId, referencia: boleta.referencia, zona: boleta.zona,
                anulacion: boleta.anulacion ?? null,
                consumo: consumo ? { idOrigen: consumo.idOrigen, puntoId: consumo.puntoId, consumidoEn: consumo.consumidoEn } : null,
              } : null,
              versiones: datos?.versiones ?? { versionPermisos: 0, versionPoliticas: 0, permisosRecibidosEn: null },
            });
          },
          async registrarIntento(intento, huella, resultado: ResultadoValidacion) {
            activo('registrarIntento');
            const k = clave(intento.eventoId, intento.idOrigen);
            if (intentos.has(k) || nuevosIntentos.has(k)) throw new ErrorIntentoDuplicado();
            nuevosIntentos.set(k, structuredClone({ huella, resultado }));
          },
          async registrarConsumo(consumo) {
            activo('registrarConsumo');
            const k = claveConsumo(consumo.clave);
            if (consumos.has(k) || nuevosConsumos.has(k)) throw new ErrorConsumoDuplicado();
            nuevosConsumos.set(k, structuredClone(consumo));
          },
          async agregarBitacora(entrada) { activo('agregarBitacora'); nuevasEntradas.push(structuredClone(entrada)); },
          async agregarOutbox(registro) { activo('agregarOutbox'); nuevosOutbox.push(structuredClone(registro)); },
          async confirmar() {
            activo('confirmar');
            for (const k of nuevosIntentos.keys()) if (intentos.has(k)) throw new ErrorIntentoDuplicado();
            for (const k of nuevosConsumos.keys()) if (consumos.has(k)) throw new ErrorConsumoDuplicado();
            for (const [k, v] of nuevosIntentos) intentos.set(k, v);
            for (const [k, v] of nuevosConsumos) consumos.set(k, v);
            bitacora.push(...nuevasEntradas);
            for (const r of nuevosOutbox) agregar(r);
            cerrar();
          },
          async cancelar() { if (!cerrado) cerrar(); },
        };
      },
    },
    alcance: {
      async resolver(lectorId) {
        disponible('resolver');
        const lector = semilla?.lectores.find((l) => l.lectorId === lectorId);
        return { lectorId, eventoId: lector?.eventoId ?? null, puntoId: lector?.puntoId ?? null, revocado: lector?.revocado ?? false };
      },
    },
    permisos: {
      async versionInstalada(eventoId) {
        disponible('versionInstalada');
        return semilla?.evento.eventoId === eventoId ? structuredClone(semilla.versiones) : null;
      },
    },
    outbox: {
      async pendientes(limite) {
        disponible('pendientes');
        return structuredClone(filas.filter((f) => !acuses.has(f.id)).slice(0, Math.max(0, limite)));
      },
      async registrarAcuse(ids, idLote, acusadoEn) {
        disponible('registrarAcuse');
        for (const id of ids) if (filas.some((f) => f.id === id) && !acuses.has(id)) acuses.set(id, { idLote, acusadoEn });
      },
      async resumen(ahora) {
        disponible('resumen');
        const pendientes = filas.filter((f) => !acuses.has(f.id));
        return { pendientes: pendientes.length, edadMaxS: pendientes.length
          ? Math.max(0, (ahora.getTime() - pendientes[0]!.creadoEn.getTime()) / 1000) : 0 };
      },
      async agregar(registros) {
        disponible('agregar');
        for (const registro of registros) agregar(structuredClone(registro));
      },
    },
    diario: {
      async registrarLote(lote: LoteDiario, recibidoEn) {
        disponible('registrarLote');
        const k = clave(lote.eventoId, lote.idLote);
        const contenido = JSON.stringify(lote);
        const previo = lotes.get(k);
        if (previo) {
          if (previo.contenido !== contenido) throw new ErrorConflictoIdempotencia(lote.idLote);
          return { ...structuredClone(previo.acuse), repetido: true };
        }
        const acuse: AcuseLoteDiario = {
          idLote: lote.idLote, recibidoEn: recibidoEn.toISOString(),
          aceptados: [], duplicados: [], yaDecididos: [], repetido: false,
        };
        const nuevos: RegistroOutbox[] = [];
        for (const r of lote.registros) {
          const origen = clave(lote.eventoId, r.idOrigen);
          if (intentos.has(origen)) acuse.yaDecididos.push(r.idOrigen);
          else if (diario.has(origen) || nuevos.some((n) => n.registro.idOrigen === r.idOrigen)) acuse.duplicados.push(r.idOrigen);
          else {
            acuse.aceptados.push(r.idOrigen);
            nuevos.push({
              eventoId: lote.eventoId,
              registro: {
                tipo: 'intento-diario', idOrigen: r.idOrigen, lectorId: lote.lectorId,
                puntoId: lote.puntoId, codigo: r.codigo, zonaSolicitada: r.zonaSolicitada,
                proposito: r.proposito, motivoLocal: r.motivoLocal,
                instanteLector: r.instanteLector, recibidoEnCoordinador: recibidoEn.toISOString(),
              },
            });
          }
        }
        for (const r of nuevos) { diario.add(clave(r.eventoId, r.registro.idOrigen)); agregar(r); }
        lotes.set(k, { contenido, acuse: structuredClone(acuse) });
        return acuse;
      },
    },
    async salud() { try { disponible('salud'); return true; } catch { return false; } },
    async cerrar() { disponible('cerrar'); },
  };
  return almacen;
}

export function semillaDemo(ahora: Date): SemillaMemoria {
  const nombres = ['Norte', 'Sur', 'Oriental', 'Occidental', 'Palcos'];
  const zonaPunto = (i: number) => i <= 5 ? nombres[0]! : i <= 9 ? nombres[1]! : i <= 14 ? nombres[2]! : i <= 18 ? nombres[3]! : nombres[4]!;
  return {
    evento: {
      eventoId: 'EVT-2026-02', clienteId: 'CLI-001', boleteriaId: 'BOL-01',
      estado: 'abierto',
      ventana: { aperturaEn: new Date(ahora.getTime() - 3_600_000), cierreEn: new Date(ahora.getTime() + 43_200_000) },
      politicas: { version: 2, reingresoPermitido: false, contingenciaLocal: false },
    },
    versiones: { versionPermisos: 37, versionPoliticas: 2, permisosRecibidosEn: ahora },
    puntos: Array.from({ length: 20 }, (_, n) => {
      const i = n + 1;
      return { eventoId: 'EVT-2026-02', puntoId: `P-${String(i).padStart(2, '0')}`,
        zonas: i === 1 || i === 7 ? [zonaPunto(i), 'Palcos'] : [zonaPunto(i)], habilitado: true };
    }),
    lectores: Array.from({ length: 20 }, (_, n) => ({
      lectorId: `LX-2210-${100 + 7 * (n + 1)}`, eventoId: 'EVT-2026-02',
      puntoId: `P-${String(n + 1).padStart(2, '0')}`,
    })),
    boletas: Array.from({ length: 25 }, (_, n) => ({
      referencia: `TA-8800-${String(n + 1).padStart(4, '0')}`,
      zona: nombres[Math.floor(n / 5)]!,
      ...(n === 24 ? { anulacion: { anuladaEn: new Date(ahora.getTime() - 120_000), recibidaEn: new Date(ahora.getTime() - 60_000) } } : {}),
    })),
  };
}
