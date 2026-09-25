import { spawn } from 'node:child_process';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, InvalidArgumentError } from 'commander';
import { limpiarControl, leerEjecucion, procesoVivo, rutasControl, solicitarParada } from './control.ts';

export interface Configuracion {
  perfil: string;
  lectores: number;
  coordinador: string;
  eventoId?: string;
  boletas: string;
  datos: string;
  timeoutMs: number;
  duracionS?: number;
  pares: boolean;
  paresCantidad: number;
}

export const directorioDefault = join(homedir(), '.nexo', 'reader-client');

function numeroPositivo(valor: string): number {
  const numero = Number(valor);
  if (!Number.isSafeInteger(numero) || numero <= 0) throw new InvalidArgumentError('Debe ser un entero positivo');
  return numero;
}

function rutaDatos(valor: string): string {
  const datos = resolve(valor);
  const raiz = fileURLToPath(new URL('../../../', import.meta.url));
  if (datos === raiz || datos.startsWith(`${raiz}\\`) || datos.startsWith(`${raiz}/`)) {
    throw new InvalidArgumentError('El directorio de datos debe estar fuera del repositorio');
  }
  return datos;
}

async function iniciar(configuracion: Configuracion): Promise<void> {
  const datos = rutaDatos(configuracion.datos);
  const url = new URL(configuracion.coordinador);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('El coordinador debe usar http o https');
  if (url.username || url.password) throw new Error('No se admiten credenciales en la URL');
  if (!isAbsolute(configuracion.boletas)) configuracion.boletas = resolve(configuracion.boletas);
  await mkdir(datos, { recursive: true });
  const anterior = await leerEjecucion(datos);
  if (anterior && procesoVivo(anterior.pid)) throw new Error(`Ya hay una ejecución activa (PID ${anterior.pid})`);
  await limpiarControl(datos);
  const configRuta = join(datos, 'configuracion.json');
  await writeFile(configRuta, JSON.stringify({ ...configuracion, datos }, null, 2));
  const log = await open(rutasControl(datos).salida, 'a');
  try {
    const proceso = spawn(process.execPath, [fileURLToPath(new URL('./worker.ts', import.meta.url)), configRuta], {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
      windowsHide: true,
    });
    proceso.unref();
    const limite = Date.now() + 5000;
    while (Date.now() < limite) {
      const ejecucion = await leerEjecucion(datos);
      if (ejecucion?.pid === proceso.pid) {
        console.log(`Lector iniciado (PID ${proceso.pid}); registro: ${rutasControl(datos).salida}`);
        return;
      }
      if (proceso.exitCode !== null) break;
      await new Promise((respuesta) => setTimeout(respuesta, 100));
    }
    throw new Error(`El lector no inició. Consulte ${rutasControl(datos).salida}`);
  } finally {
    await log.close();
  }
}

async function estado(datos: string): Promise<void> {
  const ejecucion = await leerEjecucion(datos);
  console.log(JSON.stringify({ activo: ejecucion ? procesoVivo(ejecucion.pid) : false, ejecucion }, null, 2));
}

async function detener(datos: string): Promise<void> {
  const ejecucion = await leerEjecucion(datos);
  if (!ejecucion || !procesoVivo(ejecucion.pid)) throw new Error('No hay lector activo');
  await solicitarParada(datos);
  console.log(`Parada solicitada para PID ${ejecucion.pid}`);
}

async function reporte(datos: string): Promise<void> {
  console.log(await readFile(rutasControl(datos).reporte, 'utf8'));
}

const programa = new Command().name('nexo-reader').description('Lectores emulados NEXO; C2 es la única autoridad');
programa.command('start')
  .requiredOption('--perfil <nombre>', 'nominal, pico o estres')
  .requiredOption('--lectores <n>', 'cantidad de lectores', numeroPositivo)
  .requiredOption('--coordinador <url>', 'URL de C2')
  .requiredOption('--boletas <archivo>', 'exportación JSON de boletas semilla')
  .option('--evento <id>', 'limita la corrida a este evento')
  .option('--datos <dir>', 'diarios, control y reporte fuera del repositorio', directorioDefault)
  .option('--timeout <ms>', 'plazo de V1', numeroPositivo, 500)
  .option('--duracion <segundos>', 'duración para una corrida corta', numeroPositivo)
  .option('--pares', 'dos lecturas concurrentes por boleta')
  .option('--pares-cantidad <n>', 'número de boletas para el modo pares', numeroPositivo, 500)
  .action(async (opciones: {
    perfil: string; lectores: number; coordinador: string; boletas: string; evento: string;
    datos: string; timeout: number; duracion?: number; pares?: boolean; paresCantidad: number;
  }) => iniciar({
    perfil: opciones.perfil, lectores: opciones.lectores, coordinador: opciones.coordinador,
    eventoId: opciones.evento, boletas: opciones.boletas, datos: opciones.datos,
    timeoutMs: opciones.timeout, duracionS: opciones.duracion, pares: opciones.pares ?? false,
    paresCantidad: opciones.paresCantidad,
  }));
programa.command('status').option('--datos <dir>', 'directorio de datos', directorioDefault)
  .action(async ({ datos }: { datos: string }) => estado(datos));
programa.command('stop').option('--datos <dir>', 'directorio de datos', directorioDefault)
  .action(async ({ datos }: { datos: string }) => detener(datos));
programa.command('report').option('--datos <dir>', 'directorio de datos', directorioDefault)
  .action(async ({ datos }: { datos: string }) => reporte(datos));

await programa.parseAsync(process.argv);
