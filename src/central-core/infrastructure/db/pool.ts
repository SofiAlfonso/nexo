import { Pool } from 'pg';

/** D2 connection; explicitly separate from the venue's D1 database. Caller closes the pool. */
export function createD2Pool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.D2_DATABASE_URL;
  const max = env.D2_POOL_MAX === undefined ? 10 : Number(env.D2_POOL_MAX);
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('D2_POOL_MAX must be a positive integer');
  }
  if (connectionString) return new Pool({ connectionString, max });

  const { CENTRAL_POSTGRES_HOST: host, CENTRAL_POSTGRES_DB: database,
    CENTRAL_POSTGRES_USER: user, CENTRAL_POSTGRES_PASSWORD: password } = env;
  const port = Number(env.CENTRAL_POSTGRES_PORT);
  if (!host || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('D2_DATABASE_URL or all CENTRAL_POSTGRES_* settings are required (valid port 1-65535)');
  }
  return new Pool({ host, port, database, user, password, max });
}
