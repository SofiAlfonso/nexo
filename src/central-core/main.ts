import type { Pool } from 'pg';
import { createD2Pool, migrate } from './infrastructure/db/index.ts';
import { crearApp } from './api/server.ts';
import { cargarConfig, envParaPoolD2 } from './config.ts';
import type { ConfigCentral } from './config.ts';

/** Arranca C4: crea/migra el pool D2, compone la app y escucha en `config.port`. */
export async function iniciarCentral(config: ConfigCentral = cargarConfig(), pool: Pool = createD2Pool(envParaPoolD2())) {
  await migrate(pool);
  const { fastify, cerrar } = crearApp(pool);

  let deteniendo: Promise<void> | null = null;
  const detener = () => {
    deteniendo ??= (async () => {
      cerrar();
      await fastify.close();
      await pool.end();
    })();
    return deteniendo;
  };

  try {
    await fastify.listen({ port: config.port, host: config.host });
  } catch (fallo) {
    await detener();
    throw fallo;
  }

  return { fastify, pool, detener };
}

/** Arranca C4 como proceso: señales SIGINT/SIGTERM detienen ordenadamente. */
export function ejecutarComoProceso(): void {
  void iniciarCentral().then(({ detener }) => {
    const salir = () => { void detener().then(() => { process.exitCode = 0; }).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    }); };
    process.once('SIGINT', salir);
    process.once('SIGTERM', salir);
  }).catch((error: unknown) => {
    console.error('C4 no pudo iniciar:', error);
    process.exitCode = 1;
  });
}
