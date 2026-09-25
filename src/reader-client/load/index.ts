import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const TIPOS_CASO = ['valid', 'used', 'cancelled', 'wrong-zone', 'unknown'] as const;
export type TipoCaso = (typeof TIPOS_CASO)[number];
export type Decision = 'aceptado' | 'rechazado' | 'sin-respuesta';

const exportSchema = z.object({
  eventos: z.array(z.object({
    eventoId: z.string().min(1),
    boletas: z.array(z.object({
      codigo: z.string().min(1),
      zona: z.string().min(1),
      estado: z.enum(['vigente', 'anulada']),
      usada: z.boolean().default(false),
    })),
  })).min(1),
});

export type ExportacionBoletas = z.infer<typeof exportSchema>;

const profileSchema = z.object({
  nombre: z.string().min(1),
  eventos: z.array(z.string().min(1)).min(1),
  lectores: z.number().int().positive(),
  ciclos: z.number().int().positive().default(1),
  fases: z.array(z.object({
    duracionSegundos: z.number().positive(),
    tps: z.number().positive(),
  })).min(1),
  mezcla: z.object({
    valid: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    'wrong-zone': z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
  }),
  zonas: z.array(z.string().min(1)).min(2),
  semilla: z.number().int().default(1),
  timeoutMs: z.number().positive().default(2000),
}).refine((p) => Object.values(p.mezcla).some((n) => n > 0), 'La mezcla no puede estar vacía');

export type PerfilCarga = z.infer<typeof profileSchema>;

export async function cargarPerfil(ruta: string): Promise<PerfilCarga> {
  return profileSchema.parse(JSON.parse(await readFile(ruta, 'utf8')));
}

export async function cargarBoletas(ruta: string): Promise<ExportacionBoletas> {
  return exportSchema.parse(JSON.parse(await readFile(ruta, 'utf8')));
}

export interface PresentacionCarga {
  lectorIndex: number;
  codigo: string;
  zonaSolicitada: string;
  eventoId: string;
  /** Correlación del generador; nunca se envía como idOrigen al coordinador. */
  idCarga: string;
  caso: TipoCaso | 'pair';
  expected: Decision | 'uno-de-dos';
  parId?: string;
}

export interface ResultadoPresentacion {
  decision: Decision;
  motivo?: string;
  /** Identificador real devuelto por el lector (directo o dentro de solicitud). */
  idOrigen?: string;
  solicitud?: { idOrigen: string };
}

export type Present = (intento: PresentacionCarga) => Promise<ResultadoPresentacion>;

export interface RegistroIntento extends PresentacionCarga {
  /** Ausente si el callback falló o venció antes de devolver la solicitud durable. */
  idOrigen?: string;
  obtained: Decision;
  motivo?: string;
  timeout: boolean;
  error?: string;
  programadoMs: number;
  inicioMs: number;
  latenciaMs: number;
}

export interface ResumenEvento {
  eventoId: string;
  intentos: number;
  aceptacionesEsperadas: number;
  aceptacionesObtenidas: number;
  falsosRechazos: number;
  timeouts: number;
}

export interface ReporteCarga {
  perfil: string;
  inicio: string;
  fin: string;
  duracionProgramadaMs: number;
  duracionRealMs: number;
  tpsProgramado: number;
  tpsDespachado: number;
  intentos: number;
  falsosRechazos: number;
  timeouts: number;
  discrepancias: number;
  paresEvaluados: number;
  paresIncorrectos: number;
  latenciaMs: { min: number; promedio: number; p50: number; p95: number; p99: number; max: number };
  eventos: ResumenEvento[];
  registros: RegistroIntento[];
}

function aleatorio(semilla: number): () => number {
  let estado = semilla >>> 0;
  return () => {
    estado = (Math.imul(1664525, estado) + 1013904223) >>> 0;
    return estado / 0x100000000;
  };
}

function percentil(valores: number[], p: number): number {
  return valores.length ? valores[Math.ceil(valores.length * p) - 1]! : 0;
}

function seleccionar<T>(valores: T[], azar: () => number): T {
  if (!valores.length) throw new Error('Exportación sin boletas para un caso solicitado');
  return valores[Math.floor(azar() * valores.length)]!;
}

function validarEntrada(perfil: PerfilCarga, exportacion: ExportacionBoletas): void {
  if (new Set(perfil.eventos).size !== perfil.eventos.length) throw new Error('Eventos duplicados en perfil');
  if (new Set(perfil.zonas).size !== perfil.zonas.length) throw new Error('Zonas duplicadas en perfil');
  if (perfil.lectores < perfil.eventos.length) throw new Error('Hace falta al menos un lector por evento');
  if (new Set(exportacion.eventos.map((e) => e.eventoId)).size !== exportacion.eventos.length) {
    throw new Error('Eventos duplicados en exportación');
  }
  for (const id of perfil.eventos) {
    const evento = exportacion.eventos.find((e) => e.eventoId === id);
    if (!evento) throw new Error(`Falta exportación del evento ${id}`);
    if (new Set(evento.boletas.map((b) => b.codigo)).size !== evento.boletas.length) {
      throw new Error(`Códigos duplicados en ${id}`);
    }
    if (evento.boletas.some((b) => !perfil.zonas.includes(b.zona))) {
      throw new Error(`Zona de boleta no incluida en perfil: ${id}`);
    }
    if (perfil.mezcla.valid && !evento.boletas.some((b) => b.estado === 'vigente' && !b.usada)) {
      throw new Error(`No hay boletas válidas en ${id}`);
    }
    if (perfil.mezcla.used && !evento.boletas.some((b) => b.usada && b.estado === 'vigente')) {
      throw new Error(`No hay boletas usadas en ${id}`);
    }
    if (perfil.mezcla.cancelled && !evento.boletas.some((b) => b.estado === 'anulada')) {
      throw new Error(`No hay boletas anuladas en ${id}`);
    }
    if (perfil.mezcla['wrong-zone'] && !evento.boletas.some((b) => b.estado === 'vigente' && !b.usada)) {
      throw new Error(`No hay boletas para otra zona en ${id}`);
    }
  }
}

interface Pool {
  valid: string[];
  used: { codigo: string; zona: string }[];
  cancelled: { codigo: string; zona: string }[];
  wrong: { codigo: string; zona: string }[];
  zonas: Map<string, string>;
  unknown: number;
}

function prepararPools(perfil: PerfilCarga, exportacion: ExportacionBoletas): Map<string, Pool> {
  const pools = new Map<string, Pool>();
  for (const id of perfil.eventos) {
    const boletas = exportacion.eventos.find((e) => e.eventoId === id)!.boletas;
    const disponibles = boletas.filter((b) => b.estado === 'vigente' && !b.usada);
    // Reservar códigos de otra zona: nunca presentarlos como válidos en esta ejecución.
    const reservadas = perfil.mezcla['wrong-zone'] ? Math.max(1, Math.floor(disponibles.length * 0.05)) : 0;
    if (perfil.mezcla.valid && disponibles.length <= reservadas) {
      throw new Error(`Boletas válidas insuficientes tras reservar otra zona en ${id}`);
    }
    const wrong = disponibles.splice(0, reservadas);
    pools.set(id, {
      valid: disponibles.map((b) => b.codigo),
      used: boletas.filter((b) => b.usada && b.estado === 'vigente'),
      cancelled: boletas.filter((b) => b.estado === 'anulada'),
      wrong,
      zonas: new Map(boletas.map((b) => [b.codigo, b.zona])),
      unknown: 0,
    });
  }
  return pools;
}

function elegirCaso(perfil: PerfilCarga, azar: () => number): TipoCaso {
  const total = Object.values(perfil.mezcla).reduce((a, b) => a + b, 0);
  let posicion = azar() * total;
  for (const caso of TIPOS_CASO) {
    posicion -= perfil.mezcla[caso];
    if (posicion < 0) return caso;
  }
  return 'unknown';
}

function nuevaPresentacion(
  perfil: PerfilCarga, pools: Map<string, Pool>, id: string, lectorIndex: number,
  indice: number, ejecucionId: string, azar: () => number,
): PresentacionCarga {
  const pool = pools.get(id)!;
  const caso = elegirCaso(perfil, azar);
  let codigo: string;
  let zonaSolicitada: string;
  if (caso === 'unknown') {
    do {
      codigo = `NEXO-UNKNOWN-${id}-${pool.unknown++}`;
    } while (pool.zonas.has(codigo));
    zonaSolicitada = seleccionar(perfil.zonas, azar);
  } else if (caso === 'valid') {
    if (!pool.valid.length) throw new Error(`Boletas válidas agotadas en ${id}; amplíe la exportación`);
    const posicion = Math.floor(azar() * pool.valid.length);
    codigo = pool.valid.splice(posicion, 1)[0]!;
    zonaSolicitada = pool.zonas.get(codigo)!;
  } else {
    const boleta = seleccionar(caso === 'used' ? pool.used : caso === 'cancelled' ? pool.cancelled : pool.wrong, azar);
    codigo = boleta.codigo;
    zonaSolicitada = caso === 'wrong-zone'
      ? seleccionar(perfil.zonas.filter((z) => z !== boleta.zona), azar)
      : boleta.zona;
  }
  return {
    lectorIndex, codigo, zonaSolicitada, eventoId: id, caso,
    expected: caso === 'valid' ? 'aceptado' : 'rechazado',
    idCarga: `LOAD-${ejecucionId}-${id}-${indice}`,
  };
}

async function esperarHasta(instante: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  const restante = instante - performance.now();
  if (restante > 0) await new Promise<void>((resolve) => {
    const terminar = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', terminar);
      resolve();
    };
    const timer = setTimeout(terminar, restante);
    signal?.addEventListener('abort', terminar, { once: true });
  });
}

async function ejecutarUno(
  intento: PresentacionCarga, programadoMs: number, inicio: number,
  timeoutMs: number, present: Present,
): Promise<RegistroIntento> {
  const inicioMs = performance.now() - inicio;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let obtained: Decision = 'sin-respuesta';
  let motivo: string | undefined;
  let idOrigen: string | undefined;
  let error: string | undefined;
  let timeout = false;
  try {
    const respuesta = await Promise.race([
      Promise.resolve().then(() => present(intento)).then((r) => ({ tipo: 'respuesta' as const, r })),
      new Promise<{ tipo: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ tipo: 'timeout' }), timeoutMs);
      }),
    ]);
    if (respuesta.tipo === 'timeout') {
      timeout = true;
    } else if (['aceptado', 'rechazado', 'sin-respuesta'].includes(respuesta.r.decision)) {
      obtained = respuesta.r.decision;
      motivo = respuesta.r.motivo;
      idOrigen = respuesta.r.solicitud?.idOrigen ?? respuesta.r.idOrigen;
    } else {
      error = 'Decisión inválida del callback';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    if (timer) clearTimeout(timer);
  }
  timeout ||= obtained === 'sin-respuesta';
  return {
    ...intento, idOrigen, obtained, motivo, timeout, error, programadoMs,
    inicioMs, latenciaMs: performance.now() - inicio - inicioMs,
  };
}

function resumir(
  perfil: PerfilCarga, registros: RegistroIntento[], inicio: string, fin: string,
  duracionProgramadaMs: number, duracionRealMs: number,
): ReporteCarga {
  const latencias = registros.map((r) => r.latenciaMs).sort((a, b) => a - b);
  const pares = new Map<string, RegistroIntento[]>();
  for (const r of registros) {
    if (r.parId) pares.set(r.parId, [...(pares.get(r.parId) ?? []), r]);
  }
  const fallosPar = new Set([...pares.values()].filter(
    (grupo) => grupo.length !== 2 || grupo.filter((r) => r.obtained === 'aceptado').length !== 1,
  ).flatMap((grupo) => grupo.map((r) => r.parId!)));
  const falsosRechazosPar = [...pares.values()].filter(
    (grupo) => grupo.length === 2 && grupo.every((r) => r.obtained === 'rechazado'),
  );
  const falseReject = (r: RegistroIntento): boolean =>
    r.expected === 'aceptado' && r.obtained === 'rechazado';
  const discrepancia = (r: RegistroIntento): boolean =>
    r.expected === 'uno-de-dos' ? fallosPar.has(r.parId!) : r.expected !== r.obtained;
  const eventos = perfil.eventos.map((eventoId) => {
    const filas = registros.filter((r) => r.eventoId === eventoId);
    return {
      eventoId, intentos: filas.length,
      aceptacionesEsperadas: filas.filter((r) => r.expected === 'aceptado').length
        + new Set(filas.filter((r) => r.parId).map((r) => r.parId)).size,
      aceptacionesObtenidas: filas.filter((r) => r.obtained === 'aceptado').length,
      falsosRechazos: filas.filter(falseReject).length
        + falsosRechazosPar.filter((grupo) => grupo[0]?.eventoId === eventoId).length,
      timeouts: filas.filter((r) => r.timeout).length,
    };
  });
  return {
    perfil: perfil.nombre, inicio, fin, duracionProgramadaMs, duracionRealMs,
    tpsProgramado: duracionProgramadaMs ? registros.length * 1000 / duracionProgramadaMs : 0,
    tpsDespachado: duracionRealMs ? registros.length * 1000 / duracionRealMs : 0,
    intentos: registros.length,
    falsosRechazos: registros.filter(falseReject).length + falsosRechazosPar.length,
    timeouts: registros.filter((r) => r.timeout).length,
    discrepancias: registros.filter(discrepancia).length,
    paresEvaluados: pares.size,
    paresIncorrectos: fallosPar.size,
    latenciaMs: {
      min: latencias[0] ?? 0,
      promedio: latencias.reduce((a, b) => a + b, 0) / (latencias.length || 1),
      p50: percentil(latencias, 0.5), p95: percentil(latencias, 0.95),
      p99: percentil(latencias, 0.99), max: latencias.at(-1) ?? 0,
    },
    eventos, registros,
  };
}

export interface OpcionesCarga {
  perfil: PerfilCarga;
  exportacion: ExportacionBoletas;
  present: Present;
  /** Detiene nuevos envíos; espera los ya iniciados y devuelve el informe parcial. */
  signal?: AbortSignal;
  /** Publica el resumen en stdout. El JSON íntegro se devuelve para que el CLI lo persista. */
  stdout?: (linea: string) => void;
}

export async function ejecutarCarga(opciones: OpcionesCarga): Promise<ReporteCarga> {
  const perfil = profileSchema.parse(opciones.perfil);
  const exportacion = exportSchema.parse(opciones.exportacion);
  validarEntrada(perfil, exportacion);
  const pools = prepararPools(perfil, exportacion);
  const azar = aleatorio(perfil.semilla);
  const ejecucionId = randomUUID();
  const inicio = performance.now();
  const inicioIso = new Date().toISOString();
  let offset = 0;
  let indice = 0;
  let interrumpido = false;
  const pendientes: Promise<RegistroIntento>[] = [];
  for (let ciclo = 0; ciclo < perfil.ciclos; ciclo++) {
    for (const fase of perfil.fases) {
      const cantidad = Math.floor(fase.tps * fase.duracionSegundos + 1e-9);
      for (let i = 0; i < cantidad; i++) {
        if (opciones.signal?.aborted) { interrumpido = true; break; }
        const programadoMs = offset + i * 1000 / fase.tps;
        await esperarHasta(inicio + programadoMs, opciones.signal);
        if (opciones.signal?.aborted) { interrumpido = true; break; }
        const eventoId = perfil.eventos[indice % perfil.eventos.length]!;
        const lectorIndex = indice % perfil.lectores;
        const intento = nuevaPresentacion(perfil, pools, eventoId, lectorIndex, indice++, ejecucionId, azar);
        pendientes.push(ejecutarUno(intento, programadoMs, inicio, perfil.timeoutMs, opciones.present));
      }
      if (interrumpido) break;
      offset += fase.duracionSegundos * 1000;
    }
    if (interrumpido) break;
  }
  if (!interrumpido) await esperarHasta(inicio + offset, opciones.signal);
  const duracionProgramadaMs = interrumpido || opciones.signal?.aborted
    ? performance.now() - inicio : offset;
  const registros = await Promise.all(pendientes);
  const reporte = resumir(perfil, registros, inicioIso, new Date().toISOString(),
    duracionProgramadaMs, performance.now() - inicio);
  opciones.stdout?.(formatearResumen(reporte));
  return reporte;
}

export interface OpcionesPares extends Omit<OpcionesCarga, 'perfil'> {
  perfil: PerfilCarga;
  pares: number;
}

export async function ejecutarPares(opciones: OpcionesPares): Promise<ReporteCarga> {
  const perfil = profileSchema.parse(opciones.perfil);
  const exportacion = exportSchema.parse(opciones.exportacion);
  validarEntrada(perfil, exportacion);
  if (!Number.isInteger(opciones.pares) || opciones.pares < 1) throw new Error('Se requiere al menos un par');
  if (perfil.lectores < 2 * perfil.eventos.length) {
    throw new Error('El modo pares exige dos lectores por evento');
  }
  const pools = prepararPools({ ...perfil, mezcla: { ...perfil.mezcla, 'wrong-zone': 0 } }, exportacion);
  const azar = aleatorio(perfil.semilla);
  const ejecucionId = randomUUID();
  const inicio = performance.now();
  const inicioIso = new Date().toISOString();
  const pendientes: Promise<RegistroIntento>[] = [];
  const intervaloParMs = 2000 / perfil.fases[0]!.tps;
  let interrumpido = false;
  for (let i = 0; i < opciones.pares; i++) {
    if (opciones.signal?.aborted) { interrumpido = true; break; }
    const programadoMs = i * intervaloParMs;
    await esperarHasta(inicio + programadoMs, opciones.signal);
    if (opciones.signal?.aborted) { interrumpido = true; break; }
    const eventoId = perfil.eventos[i % perfil.eventos.length]!;
    const pool = pools.get(eventoId)!;
    if (!pool.valid.length) throw new Error(`Boletas válidas agotadas en ${eventoId}`);
    const codigo = pool.valid.splice(Math.floor(azar() * pool.valid.length), 1)[0]!;
    const zonaSolicitada = pool.zonas.get(codigo)!;
    const parId = `PAIR-${ejecucionId}-${eventoId}-${i}`;
    const base = { codigo, zonaSolicitada, eventoId, caso: 'pair' as const, expected: 'uno-de-dos' as const, parId };
    const lectorBase = ((2 * i * perfil.eventos.length) + (i % perfil.eventos.length)) % perfil.lectores;
    // Iniciar ambas promesas en el mismo turno, sin esperar el resultado de ninguna.
    pendientes.push(ejecutarUno({ ...base, lectorIndex: lectorBase, idCarga: `${parId}-A` },
      programadoMs, inicio, perfil.timeoutMs, opciones.present));
    pendientes.push(ejecutarUno({
      ...base, lectorIndex: (lectorBase + perfil.eventos.length) % perfil.lectores, idCarga: `${parId}-B`,
    },
      programadoMs, inicio, perfil.timeoutMs, opciones.present));
  }
  if (!interrumpido) await esperarHasta(inicio + opciones.pares * intervaloParMs, opciones.signal);
  const duracionProgramadaMs = interrumpido || opciones.signal?.aborted
    ? performance.now() - inicio : opciones.pares * intervaloParMs;
  const registros = await Promise.all(pendientes);
  const duracion = performance.now() - inicio;
  const reporte = resumir(perfil, registros, inicioIso, new Date().toISOString(),
    duracionProgramadaMs, duracion);
  opciones.stdout?.(formatearResumen(reporte));
  return reporte;
}

export async function guardarReporteJson(ruta: string, reporte: ReporteCarga): Promise<void> {
  await writeFile(ruta, `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');
}

export function formatearResumen(reporte: ReporteCarga): string {
  return [
    `${reporte.perfil}: ${reporte.intentos} intentos en ${(reporte.duracionRealMs / 1000).toFixed(2)} s`,
    `TPS programado=${reporte.tpsProgramado.toFixed(2)} observado=${reporte.tpsDespachado.toFixed(2)}`,
    `p50=${reporte.latenciaMs.p50.toFixed(1)} ms p95=${reporte.latenciaMs.p95.toFixed(1)} ms p99=${reporte.latenciaMs.p99.toFixed(1)} ms`,
    `falsos rechazos=${reporte.falsosRechazos} timeouts=${reporte.timeouts} discrepancias=${reporte.discrepancias}`,
    `pares incorrectos=${reporte.paresIncorrectos}/${reporte.paresEvaluados}`,
    ...reporte.eventos.map((e) => `${e.eventoId}: esperadas=${e.aceptacionesEsperadas} obtenidas=${e.aceptacionesObtenidas}`),
  ].join('\n');
}
