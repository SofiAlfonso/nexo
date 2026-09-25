import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createD1Pool, migrate as migrateD1 } from '../../../src/local-coordinator/infrastructure/db/index.ts';
import { createD2Pool, migrate as migrateD2 } from '../../../src/central-core/infrastructure/db/index.ts';
import { exportBoletas } from '../../../deploy/scripts/export-boletas.ts';
import { seed } from '../../../deploy/scripts/seed.ts';

const dockerAvailable = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  stdio: 'ignore',
}).status === 0;

describe.skipIf(!dockerAvailable)('PostgreSQL D1 y D2', () => {
  let containers: StartedPostgreSqlContainer[];
  let d1: Pool;
  let d2: Pool;

  beforeAll(async () => {
    containers = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new PostgreSqlContainer('postgres:16-alpine').start(),
    ]);
    d1 = new Pool({ connectionString: containers[0]!.getConnectionUri() });
    d2 = new Pool({ connectionString: containers[1]!.getConnectionUri() });
  });

  afterAll(async () => {
    await Promise.all([d1?.end(), d2?.end()]);
    await Promise.all(containers?.map((container) => container.stop()) ?? []);
  });

  it('aplica migraciones en limpio y repite sin duplicarlas', async () => {
    await Promise.all([migrateD1(d1), migrateD2(d2)]);
    await Promise.all([migrateD1(d1), migrateD2(d2)]);
    const local = await d1.query<{ count: string }>('SELECT count(*) FROM d1_schema_migrations');
    const central = await d2.query<{ count: string }>('SELECT count(*) FROM d2_schema_migrations');
    expect(Number(local.rows[0]?.count)).toBeGreaterThan(0);
    expect(Number(central.rows[0]?.count)).toBeGreaterThan(0);
  });

  it('reconoce checksums CRLF existentes sin admitir cambios de SQL', async () => {
    const cases: Array<[Pool, string, string, (pool: Pool) => Promise<void>]> = [
      [d1, 'd1_schema_migrations', '../../../src/local-coordinator/infrastructure/db/migrations/001_initial.sql', migrateD1],
      [d2, 'd2_schema_migrations', '../../../src/central-core/infrastructure/db/migrations/001_initial.sql', migrateD2],
    ];
    for (const [pool, tracking, path, migrate] of cases) {
      const sql = await readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
      const normalized = sql.replace(/\r\n?/g, '\n');
      const crlf = createHash('sha256').update(normalized.replaceAll('\n', '\r\n')).digest('hex');
      const canonical = createHash('sha256').update(normalized).digest('hex');
      await pool.query(`UPDATE ${tracking} SET checksum = $1 WHERE version = 1`, [crlf]);
      await migrate(pool);
      const repaired = await pool.query<{ checksum: string }>(
        `SELECT checksum FROM ${tracking} WHERE version = 1`,
      );
      expect(repaired.rows[0]?.checksum).toBe(canonical);
      await pool.query(`UPDATE ${tracking} SET checksum = $1 WHERE version = 1`, ['not-a-real-hash']);
      await expect(migrate(pool)).rejects.toThrow(/migration modified|Modified .* migration/i);
      await pool.query(`UPDATE ${tracking} SET checksum = $1 WHERE version = 1`, [canonical]);
    }
  });

  it('acepta las variables de config/examples y da prioridad a DATABASE_URL', async () => {
    const localUrl = new URL(containers[0]!.getConnectionUri());
    const centralUrl = new URL(containers[1]!.getConnectionUri());
    const localEnv = {
      LOCAL_POSTGRES_HOST: localUrl.hostname,
      LOCAL_POSTGRES_PORT: localUrl.port,
      LOCAL_POSTGRES_DB: localUrl.pathname.slice(1),
      LOCAL_POSTGRES_USER: decodeURIComponent(localUrl.username),
      LOCAL_POSTGRES_PASSWORD: decodeURIComponent(localUrl.password),
    };
    const centralEnv = {
      CENTRAL_POSTGRES_HOST: centralUrl.hostname,
      CENTRAL_POSTGRES_PORT: centralUrl.port,
      CENTRAL_POSTGRES_DB: centralUrl.pathname.slice(1),
      CENTRAL_POSTGRES_USER: decodeURIComponent(centralUrl.username),
      CENTRAL_POSTGRES_PASSWORD: decodeURIComponent(centralUrl.password),
    };
    const pools = [
      createD1Pool(localEnv),
      createD2Pool(centralEnv),
      createD1Pool({ ...localEnv, LOCAL_POSTGRES_HOST: 'invalid.example', D1_DATABASE_URL: localUrl.href }),
      createD2Pool({ ...centralEnv, CENTRAL_POSTGRES_HOST: 'invalid.example', D2_DATABASE_URL: centralUrl.href }),
    ];
    try {
      expect(await Promise.all(pools.map(async (pool) => (await pool.query('SELECT 1 AS ok')).rows[0]?.ok)))
        .toEqual([1, 1, 1, 1]);
    } finally {
      await Promise.all(pools.map((pool) => pool.end()));
    }
  });

  it('siembra exactamente la distribución del prototipo e idempotencia', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await seed(d1, d2, 'integration-test-password');
    }

    const counts = await Promise.all([
      d1.query<{ zones: string; points: string; readers: string; tickets: string; consumed: string }>(`
        SELECT
          (SELECT count(DISTINCT zona) FROM boleta) AS zones,
          (SELECT count(*) FROM punto) AS points,
          (SELECT count(*) FROM lector) AS readers,
          (SELECT count(*) FROM boleta) AS tickets,
          (SELECT count(*) FROM consumo) AS consumed
      `),
      d2.query<{ clients: string; venues: string; events: string; zones: string; points: string; readers: string; tickets: string; operators: string }>(`
        SELECT
          (SELECT count(*) FROM m1_config_permisos.clientes) AS clients,
          (SELECT count(*) FROM m1_config_permisos.recintos) AS venues,
          (SELECT count(*) FROM m1_config_permisos.eventos) AS events,
          (SELECT count(*) FROM m1_config_permisos.zonas) AS zones,
          (SELECT count(*) FROM m1_config_permisos.puntos) AS points,
          (SELECT count(*) FROM m1_config_permisos.lectores) AS readers,
          (SELECT count(*) FROM m1_config_permisos.boletas) AS tickets,
          (SELECT count(*) FROM auth.operadores) AS operators
      `),
    ]);
    expect(Object.values(counts[0].rows[0]!).map(Number)).toEqual([5, 20, 20, 16240, 1]);
    expect(Object.values(counts[1].rows[0]!).map(Number)).toEqual([1, 1, 3, 5, 20, 20, 16240, 5]);

    for (const pool of [d1, d2]) {
      const table = pool === d1 ? 'boleta' : 'm1_config_permisos.boletas';
      const zoneColumn = pool === d1 ? 'zona' : 'zona_id';
      const rows = await pool.query<{ zone: string; count: string }>(
        `SELECT ${zoneColumn} AS zone, count(*) FROM ${table} GROUP BY ${zoneColumn} ORDER BY ${zoneColumn}`,
      );
      const expected = pool === d1
        ? { Norte: 4980, Sur: 3360, Oriental: 4010, Occidental: 3360, Palcos: 530 }
        : { 'Z-NORTE': 4980, 'Z-SUR': 3360, 'Z-ORIENTAL': 4010, 'Z-OCCIDENTAL': 3360, 'Z-PALCOS': 530 };
      expect(Object.fromEntries(rows.rows.map(({ zone, count }) => [zone, Number(count)]))).toEqual(expected);
    }
    const roles = await d2.query<{ rol: string; contrasena_hash: string }>('SELECT rol, contrasena_hash FROM auth.operadores');
    expect(new Set(roles.rows.map(({ rol }) => rol))).toEqual(new Set([
      'SUPERVISOR', 'LIDER_TECNICO', 'LOGISTICA', 'CIERRE', 'FINANZAS',
    ]));
    expect(roles.rows.every(({ contrasena_hash }) => contrasena_hash.startsWith('$argon2'))).toBe(true);
    expect(await Promise.all(roles.rows.map(({ contrasena_hash }) =>
      argon2.verify(contrasena_hash, 'integration-test-password')))).toEqual([true, true, true, true, true]);
    const fixtures = await Promise.all([
      d1.query<{ version: string; valid: string; cancelled: string; used: string; active: boolean }>(`
        SELECT
          (SELECT count(*) FROM permiso_version WHERE evento_id = 'EVT-2026-02' AND version = 1) AS version,
          (SELECT count(*) FROM boleta WHERE evento_id = 'EVT-2026-02' AND anulada_en IS NULL
            AND referencia NOT IN (SELECT referencia FROM consumo WHERE evento_id = 'EVT-2026-02')) AS valid,
          (SELECT count(*) FROM boleta WHERE evento_id = 'EVT-2026-02' AND referencia = 'TA-8800-0001'
            AND anulada_en IS NOT NULL) AS cancelled,
          (SELECT count(*) FROM consumo WHERE evento_id = 'EVT-2026-02'
            AND referencia = 'TA-8800-0002') AS used,
          (SELECT estado = 'abierto' AND now() BETWEEN apertura_en AND cierre_en
            FROM evento WHERE evento_id = 'EVT-2026-02') AS active
      `),
      d2.query<{ cancelled: string; active: boolean }>(`
        SELECT
          (SELECT count(*) FROM m1_config_permisos.boletas
            WHERE evento_id = 'EVT-2026-02' AND referencia = 'TA-8800-0001' AND anulada) AS cancelled,
          (SELECT estado = 'abierto' AND now() BETWEEN apertura AND cierre
            FROM m1_config_permisos.eventos WHERE id = 'EVT-2026-02') AS active
      `),
    ]);
    expect(Number(fixtures[0].rows[0]?.version)).toBe(1);
    expect(Number(fixtures[0].rows[0]?.valid)).toBeGreaterThanOrEqual(14850);
    expect(Number(fixtures[0].rows[0]?.cancelled)).toBe(1);
    expect(Number(fixtures[0].rows[0]?.used)).toBe(1);
    expect(fixtures[0].rows[0]?.active).toBe(true);
    expect(Number(fixtures[1].rows[0]?.cancelled)).toBe(1);
    expect(fixtures[1].rows[0]?.active).toBe(true);
  });

  it('rechaza UPDATE y DELETE de ambas bitácoras', async () => {
    const audits: Array<[Pool, string, string, string]> = [
      [d1, 'bitacora', 'id_origen', 'contenido'],
      [d2, 'm2_evidencia.bitacora', 'texto', 'datos'],
    ];
    await d1.query(`INSERT INTO bitacora (evento_id, tipo, id_origen, contenido)
      VALUES ('EVT-2026-02', 'test', 'integration:audit', '{}'::jsonb) ON CONFLICT DO NOTHING`);
    await d2.query(`INSERT INTO m2_evidencia.bitacora (evento_id, autor, tipo, texto)
      VALUES ('EVT-2026-02', 'integration', 'test', 'integration:audit')`);
    for (const [pool, table, key, content] of audits) {
      await expect(pool.query(`UPDATE ${table} SET ${content} = '{}'::jsonb WHERE ${key} = 'integration:audit'`))
        .rejects.toThrow();
      await expect(pool.query(`DELETE FROM ${table} WHERE ${key} = 'integration:audit'`))
        .rejects.toThrow();
    }
  });

  it('exporta suficientes boletas reales y los lectores para la carga nominal', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nexo-boletas-'));
    try {
      const destination = join(directory, 'boletas.json');
      await exportBoletas(d1, destination);
      const exported = JSON.parse(await readFile(destination, 'utf8')) as {
        eventos: Array<{ eventoId: string; boletas: Array<{ codigo: string; zona: string; estado: string; usada: boolean }> }>;
        lectores: Array<{ lectorId: string; puntoId: string; eventoId: string; zonas: string[] }>;
        casos: Array<{ caso: string; codigo: string }>;
      };
      expect(exported.eventos).toHaveLength(1);
      expect(exported.eventos[0]?.eventoId).toBe('EVT-2026-02');
      expect(exported.eventos[0]?.boletas).toHaveLength(16240);
      expect(exported.eventos[0]!.boletas.filter(({ estado, usada }) => estado === 'vigente' && !usada).length)
        .toBeGreaterThanOrEqual(14850);
      expect(exported.lectores).toHaveLength(20);
      expect(exported.lectores.find(({ puntoId }) => puntoId === 'P-01')?.zonas)
        .toEqual(['Norte', 'Palcos']);
      expect(new Set(exported.casos.map(({ caso }) => caso))).toEqual(new Set([
        'valida', 'anulada', 'usada', 'otra-zona', 'desconocida', 'copia-concurrente',
      ]));
      expect(exported.eventos[0]!.boletas.find(({ codigo }) => codigo === 'TA-8800-0002')?.usada).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('impide un segundo consumo de la misma boleta incluso en otra puerta', async () => {
    const id = 'integration:duplicate';
    await d1.query(`
      INSERT INTO intento (id_origen, huella, evento_id, lector_id, punto_id, codigo,
        proposito, zona_solicitada, instante_lector)
      VALUES ($1, repeat('a', 64), 'EVT-2026-02', 'LX-2210-0114', 'P-02',
        'TA-8800-0002', 'ingreso', 'Z-NORTE', now())
    `, [id]);
    await expect(d1.query(`
      INSERT INTO consumo (cliente_id, evento_id, boleteria_id, referencia,
        id_origen, punto_id, lector_id)
      VALUES ('CLI-001', 'EVT-2026-02', 'BOL-01', 'TA-8800-0002', $1,
        'P-02', 'LX-2210-0114')
    `, [id])).rejects.toMatchObject({ code: '23505' });
    const { rows } = await d1.query<{ count: string }>(
      "SELECT count(*) FROM consumo WHERE evento_id = 'EVT-2026-02' AND referencia = 'TA-8800-0002'",
    );
    expect(Number(rows[0]?.count)).toBe(1);
  });

  it('no sustituye un paquete de permisos firmado al resembrar', async () => {
    const signed = { eventoId: 'EVT-2026-02', firma: { algoritmo: 'test', valor: 'fixture' } };
    await d1.query(
      "UPDATE permiso_version SET paquete = $1 WHERE evento_id = 'EVT-2026-02' AND version = 1",
      [signed],
    );
    await seed(d1, d2, 'integration-test-password');
    const result = await d1.query<{ paquete: typeof signed }>(
      "SELECT paquete FROM permiso_version WHERE evento_id = 'EVT-2026-02' AND version = 1",
    );
    expect(result.rows[0]?.paquete).toEqual(signed);
  });
});
