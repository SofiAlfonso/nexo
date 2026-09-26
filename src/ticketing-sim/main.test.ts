import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { cargarConfig } from './config.ts';
import { Boleteria } from './domain/boleteria.ts';
import { iniciarBoleteria } from './main.ts';

it('guarda atómicamente los cambios y los restaura al reiniciar', async () => {
  const estadoArchivo = join('src', 'ticketing-sim', `.estado-prueba-${randomUUID()}.json`);
  const config = { ...cargarConfig({ TICKETING_SEMILLA: 'vacia' }), host: '127.0.0.1', port: 0, estadoArchivo };
  try {
    const primerArranque = await iniciarBoleteria(config);
    try {
      const respuesta = await primerArranque.app.inject({
        method: 'POST', url: '/admin/emisiones', payload: { referencia: 'TA-PRUEBA', localidad: 'SUR' },
      });
      expect(respuesta.statusCode).toBe(201);
      expect(Boleteria.restaurar(await readFile(estadoArchivo, 'utf8')).indice().ultimaVersion).toBe(1);
    } finally {
      await primerArranque.detener();
    }
    const segundoArranque = await iniciarBoleteria(config);
    try {
      expect(segundoArranque.boleteria.indice().ultimaVersion).toBe(1);
      const respuesta = await segundoArranque.app.inject({
        method: 'POST', url: '/admin/anulaciones', payload: { referencia: 'TA-PRUEBA' },
      });
      expect(respuesta.json()).toEqual({ version: 2, referencia: 'TA-PRUEBA' });
      expect(Boleteria.restaurar(await readFile(estadoArchivo, 'utf8')).version(2)?.cambios[0]?.operacion).toBe('anulacion');
    } finally {
      await segundoArranque.detener();
    }
  } finally {
    await rm(estadoArchivo, { force: true });
    await rm(`${estadoArchivo}.${process.pid}.tmp`, { force: true });
  }
});
