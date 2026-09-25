import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Ejecucion {
  pid: number;
  iniciadoEn: string;
  perfil: string;
  lectores: number;
  coordinador: string;
  eventoId: string;
  boletas: string;
}

export const rutasControl = (directorio: string) => ({
  ejecucion: join(directorio, 'ejecucion.json'),
  parada: join(directorio, 'parar'),
  reporte: join(directorio, 'reporte.json'),
  salida: join(directorio, 'lector.log'),
});

export async function leerEjecucion(directorio: string): Promise<Ejecucion | null> {
  try {
    return JSON.parse(await readFile(rutasControl(directorio).ejecucion, 'utf8')) as Ejecucion;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function procesoVivo(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

export async function guardarEjecucion(directorio: string, ejecucion: Ejecucion): Promise<void> {
  const ruta = rutasControl(directorio).ejecucion;
  const temporal = `${ruta}.${process.pid}.tmp`;
  await writeFile(temporal, JSON.stringify(ejecucion, null, 2));
  await rename(temporal, ruta);
}

export async function solicitarParada(directorio: string): Promise<void> {
  const archivo = await open(rutasControl(directorio).parada, 'w');
  await archivo.close();
}

export async function paradaSolicitada(directorio: string): Promise<boolean> {
  try {
    await readFile(rutasControl(directorio).parada);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function limpiarControl(directorio: string): Promise<void> {
  for (const ruta of [rutasControl(directorio).ejecucion, rutasControl(directorio).parada]) {
    try {
      await unlink(ruta);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
