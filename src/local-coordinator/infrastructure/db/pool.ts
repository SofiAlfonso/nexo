import { Pool } from 'pg';

/** D1's connection URL is intentionally distinct from D2's. Caller owns pool.end(). */
export function createD1Pool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.D1_DATABASE_URL;
  if (!connectionString) throw new Error('D1_DATABASE_URL is required for the local coordinator');
  const max = env.D1_POOL_MAX === undefined ? 10 : Number(env.D1_POOL_MAX);
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('D1_POOL_MAX must be a positive integer');
  }
  return new Pool({ connectionString, max });
}
