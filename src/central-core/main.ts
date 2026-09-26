import type { Pool } from 'pg';
import { createD2Pool, migrate } from './infrastructure/db/index.ts';
import { crearApp } from './api/server.ts';
import { cargarConfig, envParaPoolD2 } from './config.ts';
import { cargarConfigAdaptadorBoleteria, iniciarAdaptadorBoleteria, type AdaptadorBoleteria } from './modules/configuration-permissions/api/index.ts';
import type { ConfigCentral } from './config.ts';

/** Arranca C4: crea/migra el pool D2, compone la app y escucha en `config.port`. */
export async function iniciarCentral(config: ConfigCentral = cargarConfig(), pool: Pool = createD2Pool(envParaPoolD2())) {
  await migrate(pool);
  const { fastify, cerrar } = crearApp(pool);
  let c3: AdaptadorBoleteria | null = null;

  let deteniendo: Promise<void> | null = null;
  const detener = () => {
    deteniendo ??= (async () => {
      await c3?.detener();
      cerrar();
      await fastify.close();
      await pool.end();
    })();
    return deteniendo;
  };

  try {
    await fastify.listen({ port: config.port, host: config.host });
    const configC3 = cargarConfigAdaptadorBoleteria();
    if (configC3) c3 = iniciarAdaptadorBoleteria(pool, configC3, fastify.log);
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
