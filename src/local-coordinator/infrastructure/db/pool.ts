import { Pool } from 'pg';

/** D1's connection URL is intentionally distinct from D2's. Caller owns pool.end(). */
export function createD1Pool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.D1_DATABASE_URL;
  const max = env.D1_POOL_MAX === undefined ? 10 : Number(env.D1_POOL_MAX);
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('D1_POOL_MAX must be a positive integer');
  }
  if (connectionString) return new Pool({ connectionString, max });

  const { LOCAL_POSTGRES_HOST: host, LOCAL_POSTGRES_DB: database,
    LOCAL_POSTGRES_USER: user, LOCAL_POSTGRES_PASSWORD: password } = env;
  const port = Number(env.LOCAL_POSTGRES_PORT);
  if (!host || !database || !user || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('D1_DATABASE_URL or all LOCAL_POSTGRES_* settings are required (valid port 1-65535)');
  }
  return new Pool({ host, port, database, user, password, max });
}
