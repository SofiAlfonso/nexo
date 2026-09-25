import { Pool } from 'pg';

/** D2 connection; explicitly separate from the venue's D1 database. Caller closes the pool. */
export function createD2Pool(env: NodeJS.ProcessEnv = process.env): Pool {
  const connectionString = env.D2_DATABASE_URL;
  if (!connectionString) throw new Error('D2_DATABASE_URL is required for the central core');
  const max = env.D2_POOL_MAX === undefined ? 10 : Number(env.D2_POOL_MAX);
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error('D2_POOL_MAX must be a positive integer');
  }
  return new Pool({ connectionString, max });
}
