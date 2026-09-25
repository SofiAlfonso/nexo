import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import argon2 from 'argon2';
import type { Pool } from 'pg';
import { createD1Pool } from '../../src/local-coordinator/infrastructure/db/index.ts';
import { migrate as migrateD1 } from '../../src/local-coordinator/infrastructure/db/migrate.ts';
import { createD2Pool } from '../../src/central-core/infrastructure/db/index.ts';
import { migrate as migrateD2 } from '../../src/central-core/infrastructure/db/migrate.ts';
import { exportBoletas } from './export-boletas.ts';

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

function exportPathFromArguments(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length === 2 && args[0] === '--export' && args[1]!.length > 0) {
    return args[1];
  }
  throw new Error('Usage: node --import tsx deploy/scripts/seed.ts [--export <ruta.json>]');
}

async function runCli(exportPath: string | undefined): Promise<void> {
  const password = requiredEnvironmentVariable('SEED_OPERATOR_PASSWORD');
  const d1Pool = createD1Pool();
  let d2Pool: Pool | undefined;

  try {
    d2Pool = createD2Pool();
    console.info('Applying D1 and D2 migrations...');
    await Promise.all([migrateD1(d1Pool), migrateD2(d2Pool)]);
    console.info('Seeding D1 and D2...');
    await seed(d1Pool, d2Pool, password);
    if (exportPath) {
      await exportBoletas(d1Pool, exportPath);
      console.info(`Exported reader boletas to ${resolve(exportPath)}.`);
    }
    console.info('D1 and D2 seed data applied successfully.');
  } finally {
    await Promise.all([d1Pool.end(), d2Pool?.end()]);
  }
}

const invokedPath = process.argv[1];
const isMain = invokedPath !== undefined
  && pathToFileURL(resolve(invokedPath)).href === import.meta.url;
if (isMain) {
  let exportPath: string | undefined;
  let argumentsValid = true;
  try {
    exportPath = exportPathFromArguments(process.argv.slice(2));
  } catch (error) {
    console.error('Seed failed:', error);
    process.exitCode = 1;
    argumentsValid = false;
  }
  if (argumentsValid) runCli(exportPath).catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
