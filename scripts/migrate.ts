#!/usr/bin/env node
// Ejecuta las migraciones de D1 o D2 para `npm run dev` (T27, S1-platform).
// Consume las funciones `migrate()` y `create*Pool()` que expone la sesión
// de datos (S1-data) en `src/*/infrastructure/db/`; no las reimplementa.
//
// Uso: node scripts/migrate.ts d1 | node scripts/migrate.ts d2

import { buildD1Url, buildD2Url, loadDevEnv, repoRoot } from "./env.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const target = process.argv[2];
if (target !== "d1" && target !== "d2") {
  console.error("Uso: node scripts/migrate.ts <d1|d2>");
  process.exit(1);
}

const env = loadDevEnv();
for (const [key, value] of Object.entries(env)) {
  if (process.env[key] === undefined) process.env[key] = value;
}

if (target === "d1") {
  process.env.D1_DATABASE_URL ??= buildD1Url(env);
  const { migrate } = await import(
    pathToFileURL(path.join(repoRoot, "src/local-coordinator/infrastructure/db/migrate.ts")).href
  );
  const { createD1Pool } = await import(
    pathToFileURL(path.join(repoRoot, "src/local-coordinator/infrastructure/db/pool.ts")).href
  );
  const pool = createD1Pool();
  try {
    await migrate(pool);
    console.log("[migrate:d1] migraciones aplicadas.");
  } finally {
    await pool.end();
  }
} else {
  process.env.D2_DATABASE_URL ??= buildD2Url(env);
  const { migrate } = await import(
    pathToFileURL(path.join(repoRoot, "src/central-core/infrastructure/db/migrate.ts")).href
  );
  const { createD2Pool } = await import(
    pathToFileURL(path.join(repoRoot, "src/central-core/infrastructure/db/pool.ts")).href
  );
  const pool = createD2Pool();
  try {
    await migrate(pool);
    console.log("[migrate:d2] migraciones aplicadas.");
  } finally {
    await pool.end();
  }
}
