import { createD2Pool, migrate } from '../infrastructure/db/index.ts';
import { crearApp } from './server.ts';

const PUERTO = Number(process.env.PORT ?? 8080);

async function principal(): Promise<void> {
  const pool = createD2Pool();
  await migrate(pool);

  const { fastify, cerrar } = crearApp(pool);

  const apagar = async (): Promise<void> => {
    cerrar();
    await fastify.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void apagar());
  process.on('SIGTERM', () => void apagar());

  await fastify.listen({ port: PUERTO, host: '0.0.0.0' });
}

principal().catch(error => {
  console.error('C4 no pudo iniciar:', error);
  process.exit(1);
});
