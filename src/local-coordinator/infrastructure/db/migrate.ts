import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
const migrationName = /^([0-9]+)_[a-z][a-z0-9_]*\.sql$/;

/** Applies numbered D1 migrations serially, verifying already-applied SQL by SHA-256. */
export async function migrate(pool: Pool): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .map((name) => ({ name, match: migrationName.exec(name) }))
    .filter((file): file is { name: string; match: RegExpExecArray } => file.match !== null)
    .map(({ name, match }) => ({ name, version: Number(match[1]) }))
    .sort((a, b) => a.version - b.version);

  if (files.some(({ version }, index) => !Number.isSafeInteger(version) || version !== index + 1)) {
    throw new Error('D1 migrations must have unique, consecutive versions starting at 001');
  }

  const client = await pool.connect();
  try {
    // Session advisory lock covers tracking-table creation and each independent migration transaction.
    await client.query('SELECT pg_advisory_lock(0x4e45584f, 1)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS d1_schema_migrations (
        version integer PRIMARY KEY CHECK (version > 0),
        filename text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ version: number; filename: string; checksum: string }>(
      'SELECT version, filename, checksum FROM d1_schema_migrations ORDER BY version',
    );
    const known = new Map(files.map((file) => [file.version, file.name]));
    if (applied.rows.some((row) => known.get(row.version) !== row.filename)) {
      throw new Error('D1 contains an unknown or renamed migration');
    }

    for (const file of files) {
      const sql = await readFile(path.join(migrationsDirectory, file.name), 'utf8');
      const normalized = sql.replace(/\r\n?/g, '\n');
      const checksum = createHash('sha256').update(normalized).digest('hex');
      const previous = applied.rows.find((row) => row.version === file.version);
      if (previous) {
        if (previous.checksum !== checksum) {
          const crlfChecksum = createHash('sha256').update(normalized.replaceAll('\n', '\r\n')).digest('hex');
          if (previous.checksum !== crlfChecksum) throw new Error(`D1 migration modified: ${file.name}`);
          await client.query('UPDATE d1_schema_migrations SET checksum = $1 WHERE version = $2', [checksum, file.version]);
        }
        continue;
      }
      await applyMigration(client, file.version, file.name, sql, checksum);
    }
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(0x4e45584f, 1)');
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
      'INSERT INTO d1_schema_migrations (version, filename, checksum) VALUES ($1, $2, $3)',
      [version, filename, checksum],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
