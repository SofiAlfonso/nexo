import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import { Pool } from 'pg';
import { migrate as migrateD1 } from '../../src/local-coordinator/infrastructure/db/migrate.ts';
import { migrate as migrateD2 } from '../../src/central-core/infrastructure/db/migrate.ts';

const d1SeedPath = fileURLToPath(
  new URL('../../src/local-coordinator/infrastructure/db/seed/seed.sql', import.meta.url),
);
const d2SeedPath = fileURLToPath(
  new URL('../../src/central-core/infrastructure/db/seed/seed.sql', import.meta.url),
);
const d2PasswordPlaceholder = ":'operator_password_hash'";

export async function seed(d1Pool: Pool, d2Pool: Pool, password: string): Promise<void> {
  if (password.length === 0) {
    throw new Error('SEED_OPERATOR_PASSWORD must not be empty.');
  }

  const [d1Sql, d2Template, passwordHash] = await Promise.all([
    readFile(d1SeedPath, 'utf8'),
    readFile(d2SeedPath, 'utf8'),
    argon2.hash(password),
  ]);
  if (!d2Template.includes(d2PasswordPlaceholder)) {
    throw new Error('D2 seed SQL is missing its operator_password_hash placeholder.');
  }

  const d2Sql = d2Template.replaceAll(d2PasswordPlaceholder, quoteSqlLiteral(passwordHash));
  await applySeed(d1Pool, d1Sql);
  await applySeed(d2Pool, d2Sql);
}

async function applySeed(pool: Pool, sql: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function connectionString(
  prefix: 'D1' | 'D2',
  defaults: { port: string; database: string; user: string },
): string {
  const direct = process.env[`${prefix}_DATABASE_URL`];
  if (direct) return direct;

  const url = new URL('postgresql://localhost');
  url.username = process.env[`${prefix}_POSTGRES_USER`] || defaults.user;
  url.password = requiredEnvironmentVariable(`${prefix}_POSTGRES_PASSWORD`);
  url.hostname = process.env[`${prefix}_HOST`] || 'localhost';
  url.port = process.env[`${prefix}_PORT`] || defaults.port;
  url.pathname = `/${process.env[`${prefix}_POSTGRES_DB`] || defaults.database}`;
  return url.toString();
}

async function runCli(): Promise<void> {
  const password = requiredEnvironmentVariable('SEED_OPERATOR_PASSWORD');
  const d1Pool = new Pool({
    connectionString: connectionString('D1', {
      port: '5433',
      database: 'nexo_venue',
      user: 'nexo_venue',
    }),
  });
  const d2Pool = new Pool({
    connectionString: connectionString('D2', {
      port: '5434',
      database: 'nexo_central',
      user: 'nexo_central',
    }),
  });

  try {
    console.info('Applying D1 and D2 migrations...');
    await Promise.all([migrateD1(d1Pool), migrateD2(d2Pool)]);
    console.info('Seeding D1 and D2...');
    await seed(d1Pool, d2Pool, password);
    console.info('D1 and D2 seed data applied successfully.');
  } finally {
    await Promise.all([d1Pool.end(), d2Pool.end()]);
  }
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined
  && pathToFileURL(resolve(invokedPath)).href === import.meta.url;
if (isMain) {
  runCli().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
