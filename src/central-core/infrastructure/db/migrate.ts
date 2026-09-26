import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';

const directory = fileURLToPath(new URL('./migrations/', import.meta.url));
const filenamePattern = /^([0-9]+)_[a-z][a-z0-9_]*\.sql$/;

/** Apply D2 migrations in order; never silently reinterpret a migration already applied. */
export async function migrate(pool: Pool): Promise<void> {
  const names = await readdir(directory);
  const files = names.filter((name) => name.endsWith('.sql'));
  const migrations = files.map((filename) => {
    const match = filenamePattern.exec(filename);
    if (!match) throw new Error(`Invalid D2 migration filename: ${filename}`);
    return { filename, version: Number(match[1]) };
  }).sort((a, b) => a.version - b.version);
  // Gaps are allowed (each session owns a numeric range); versions must be positive and unique.
  if (migrations.some(({ version }, index) =>
    !Number.isSafeInteger(version) || version < 1 || (index > 0 && version === migrations[index - 1]!.version))) {
    throw new Error('D2 migrations must have unique positive integer versions');
  }

  const client = await pool.connect();
  let locked = false;
  try {
    // Session lock also serializes the tracking table's first creation.
    await client.query('SELECT pg_advisory_lock(0x4e45584f, 2)');
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.d2_schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        filename text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ version: number; filename: string; checksum: string }>(
      'SELECT version, filename, checksum FROM public.d2_schema_migrations ORDER BY version',
    );
    const known = new Map(migrations.map(({ version, filename }) => [version, filename]));
    for (const row of applied.rows) {
      if (known.get(row.version) !== row.filename) {
        throw new Error(`Unknown or renamed D2 migration: ${row.filename}`);
      }
    }

    for (const { version, filename } of migrations) {
      const sql = await readFile(join(directory, filename), 'utf8');
      const normalized = sql.replace(/\r\n?/g, '\n');
      const checksum = createHash('sha256').update(normalized).digest('hex');
      const previous = applied.rows.find((row) => row.version === version);
      if (previous) {
        if (previous.checksum !== checksum) {
          const crlfChecksum = createHash('sha256').update(normalized.replaceAll('\n', '\r\n')).digest('hex');
          if (previous.checksum !== crlfChecksum) throw new Error(`Modified D2 migration: ${filename}`);
          await client.query('UPDATE public.d2_schema_migrations SET checksum = $1 WHERE version = $2', [checksum, version]);
        }
        continue;
      }
      await applyMigration(client, version, filename, sql, checksum);
    }
  } finally {
    try {
      if (locked) await client.query('SELECT pg_advisory_unlock(0x4e45584f, 2)');
    } finally {
      client.release();
    }
  }
}

async function applyMigration(
  client: PoolClient,
  version: number,
  filename: string,
  sql: string,
  checksum: string,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO public.d2_schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
      [version, filename, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
