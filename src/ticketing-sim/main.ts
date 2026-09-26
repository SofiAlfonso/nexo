import { readFile, rename, writeFile } from 'node:fs/promises';
import { crearServidor } from './api/servidor.ts';
import { cargarConfig } from './config.ts';
import type { ConfigBoleteria } from './config.ts';
import { Boleteria, semillaPiloto } from './domain/boleteria.ts';

export async function iniciarBoleteria(config: ConfigBoleteria = cargarConfig()) {
  let boleteria: Boleteria;
  if (config.estadoArchivo) {
    try {
      boleteria = Boleteria.restaurar(await readFile(config.estadoArchivo, 'utf8'));
    } catch (fallo) {
      if ((fallo as NodeJS.ErrnoException).code !== 'ENOENT') throw fallo;
      boleteria = new Boleteria({
        boleteria: config.boleteria, eventoExterno: config.eventoExterno,
        ...(config.semilla === 'piloto' ? semillaPiloto() : { emisiones: [] }),
      });
    }
  } else {
    boleteria = new Boleteria({
      boleteria: config.boleteria, eventoExterno: config.eventoExterno,
      ...(config.semilla === 'piloto' ? semillaPiloto() : { emisiones: [] }),
    });
  }
  const app = crearServidor({
    boleteria, adminToken: config.adminToken, logger: true,
    alCambiar: config.estadoArchivo ? async () => {
      const temporal = `${config.estadoArchivo}.${process.pid}.tmp`;
      await writeFile(temporal, boleteria.exportar(), 'utf8');
      await rename(temporal, config.estadoArchivo!);
    } : undefined,
  });
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (fallo) {
    await app.close();
    throw fallo;
  }
  let deteniendo: Promise<void> | null = null;
  const detener = () => {
    deteniendo ??= app.close();
    return deteniendo;
  };
  return { app, boleteria, detener };
}

export function ejecutarComoProceso(): void {
  void iniciarBoleteria().then(({ detener }) => {
    const salir = () => {
      void detener().then(() => { process.exitCode = 0; }).catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', salir);
    process.once('SIGTERM', salir);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
