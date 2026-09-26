import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LectorEmulado } from '../application/index.ts';
import { cargarBoletas, cargarPerfil, ejecutarCarga, ejecutarPares, guardarReporteJson } from '../load/index.ts';
import type { PresentacionCarga } from '../load/index.ts';
import { guardarEjecucion, limpiarControl, paradaSolicitada, rutasControl } from './control.ts';
import { identidades } from './identidades.ts';
import type { Identidad } from './identidades.ts';
import { cargarTls, validarTls } from './tls.ts';
import type { Configuracion } from './index.ts';

function elegirLector(
  lectores: LectorEmulado[], identidadesLector: Identidad[], intento: PresentacionCarga, zonaBoleta?: string,
): LectorEmulado {
  const compatibles = lectores.filter((_, indice) =>
    identidadesLector[indice]!.eventoId === intento.eventoId &&
    identidadesLector[indice]!.zonas.includes(intento.zonaSolicitada) &&
    (intento.caso !== 'wrong-zone' ||
      (zonaBoleta !== undefined && !identidadesLector[indice]!.zonas.includes(zonaBoleta))));
  if (!compatibles.length) {
    throw new Error(`No hay lector en ${intento.eventoId} para la zona ${intento.zonaSolicitada}`);
  }
  if (intento.parId) {
    const distintos = [...new Set(compatibles)];
    if (distintos.length < 2) throw new Error(`El par necesita dos lectores para ${intento.zonaSolicitada}`);
    return distintos[intento.idCarga.endsWith('-B') ? 1 : 0]!;
  }
  return compatibles[intento.lectorIndex % compatibles.length]!;
}

export async function ejecutar(configuracion: Configuracion): Promise<void> {
  validarTls(configuracion.coordinador, configuracion.lectores, configuracion);
  const nombrePerfil = configuracion.perfil === 'estres' ? 'stress' : configuracion.perfil;
  if (!['nominal', 'pico', 'stress'].includes(nombrePerfil)) throw new Error(`Perfil desconocido: ${configuracion.perfil}`);
  const perfil = await cargarPerfil(fileURLToPath(new URL(`../../../tests/load/${nombrePerfil}.json`, import.meta.url)));
  if (configuracion.eventoId) perfil.eventos = [configuracion.eventoId];
  perfil.lectores = configuracion.lectores;
  perfil.timeoutMs = configuracion.timeoutMs;
  if (configuracion.duracionS) {
    const duracionFases = perfil.fases.reduce((suma, fase) => suma + fase.duracionSegundos, 0);
    perfil.fases = perfil.fases.map((fase) => ({
      ...fase, duracionSegundos: configuracion.duracionS! * fase.duracionSegundos / duracionFases,
    }));
    perfil.ciclos = 1;
  }
  const exportacion = await cargarBoletas(configuracion.boletas);
  const zonasBoletas = new Map(exportacion.eventos.map((evento) => [
    evento.eventoId, new Map(evento.boletas.map((boleta) => [boleta.codigo, boleta.zona])),
  ] as const));
  const datosExportados: unknown = JSON.parse(await readFile(configuracion.boletas, 'utf8'));
  const asignaciones = identidades(datosExportados, perfil);
  if (configuracion.ca && (typeof datosExportados !== 'object' || datosExportados === null ||
    !('lectores' in datosExportados) || !Array.isArray(datosExportados.lectores))) {
    throw new Error('HTTPS requiere identidades de lector en el export de boletas');
  }
  const credenciales = configuracion.ca
    ? await Promise.all(asignaciones.map((identidad) => cargarTls(configuracion, identidad.lectorId)))
    : [];
  const lectores = asignaciones.map((identidad, indice) => new LectorEmulado({
    lectorId: identidad.lectorId,
    puntoId: identidad.puntoId,
    eventoId: identidad.eventoId,
    directorio: join(configuracion.datos, 'diarios'),
    coordinador: configuracion.coordinador,
    tls: credenciales[indice],
    timeoutMs: configuracion.timeoutMs,
  }));
  const detener = new AbortController();
  const reintentos = new Set<Promise<void>>();
  let intervalo: ReturnType<typeof setInterval> | undefined;
  try {
    for (const lector of lectores) await lector.iniciar();
    await guardarEjecucion(configuracion.datos, {
      pid: process.pid, iniciadoEn: new Date().toISOString(),
      perfil: perfil.nombre, lectores: perfil.lectores, coordinador: configuracion.coordinador,
      eventoId: perfil.eventos.join(','), boletas: configuracion.boletas,
    });
    intervalo = setInterval(() => {
      void paradaSolicitada(configuracion.datos).then((parar) => {
        if (parar) detener.abort();
      }).catch((error: unknown) => {
        console.error('No se pudo comprobar la parada', error);
        detener.abort();
      });
    }, 200);
    const present = async (intento: PresentacionCarga) => {
      const zonaBoleta = intento.caso === 'wrong-zone'
        ? zonasBoletas.get(intento.eventoId)?.get(intento.codigo) : undefined;
      if (intento.caso === 'wrong-zone' && !zonaBoleta) throw new Error('Boleta de otra zona ausente del export');
      const lector = elegirLector(lectores, asignaciones, intento, zonaBoleta);
      const resultado = await lector.presentar({
        codigo: intento.codigo, zonaSolicitada: intento.zonaSolicitada,
      });
      if (resultado.decision === 'sin-respuesta') {
        const reintento = new Promise<void>((resolve) => setTimeout(resolve, configuracion.timeoutMs))
          .then(async () => {
            const posterior = await lector.reintentar(resultado.solicitud.idOrigen);
            console.log(JSON.stringify({
              tipo: 'reintento', idOrigen: resultado.solicitud.idOrigen, decision: posterior.decision,
            }));
          })
          .catch((error: unknown) => console.error(`Reintento ${resultado.solicitud.idOrigen}:`, error))
          .finally(() => { reintentos.delete(reintento); });
        reintentos.add(reintento);
      }
      return { decision: resultado.decision, motivo: resultado.respuesta?.motivo, idOrigen: resultado.solicitud.idOrigen };
    };
    const opciones = { perfil, exportacion, present, stdout: console.log, signal: detener.signal };
    const reporte = configuracion.pares
      ? await ejecutarPares({ ...opciones, pares: configuracion.paresCantidad })
      : await ejecutarCarga(opciones);
    await guardarReporteJson(rutasControl(configuracion.datos).reporte, reporte);
  } finally {
    if (intervalo) clearInterval(intervalo);
    await Promise.allSettled([...reintentos]);
    for (const lector of lectores) await lector.detener();
    await limpiarControl(configuracion.datos);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const ruta = process.argv[2];
    if (!ruta) throw new Error('Falta archivo de configuración');
    const configuracion = JSON.parse(await readFile(ruta, 'utf8')) as Configuracion;
    await ejecutar(configuracion);
  } catch (error) {
    console.error('Error del lector emulado:', error);
    process.exitCode = 1;
  }
}
