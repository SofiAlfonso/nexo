import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  guardarEjecucion, leerEjecucion, limpiarControl, paradaSolicitada,
  procesoVivo, rutasControl, solicitarParada,
} from './control.ts';

const directorios: string[] = [];
afterEach(async () => {
  for (const directorio of directorios.splice(0)) await rm(directorio, { recursive: true, force: true });
});

it('persiste el estado del proceso y solicita parada fuera del repo', async () => {
  const directorio = await mkdtemp(join(tmpdir(), 'nexo-lector-control-'));
  directorios.push(directorio);
  const ejecucion = {
    pid: process.pid, iniciadoEn: new Date().toISOString(), perfil: 'nominal',
    lectores: 20, coordinador: 'http://localhost:3000', eventoId: 'EVT-2026-02',
    boletas: join(directorio, 'boletas.json'),
  };
  await guardarEjecucion(directorio, ejecucion);
  expect(await leerEjecucion(directorio)).toEqual(ejecucion);
  expect(procesoVivo(ejecucion.pid)).toBe(true);
  expect(await paradaSolicitada(directorio)).toBe(false);
  await solicitarParada(directorio);
  expect(await paradaSolicitada(directorio)).toBe(true);
  await limpiarControl(directorio);
  expect(await leerEjecucion(directorio)).toBeNull();
  await expect(readFile(rutasControl(directorio).parada, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});
