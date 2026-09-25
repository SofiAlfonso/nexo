// Utilidades compartidas por scripts/dev.mjs y scripts/dev-reader.mjs.
// Carga variables de entorno de desarrollo desde deploy/compose/.env
// (si existe) o deploy/compose/.env.example, sin sobreescribir lo que ya
// esté definido en el entorno del proceso que invoca `npm run dev`.

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..");
export const composeFile = path.join(repoRoot, "deploy", "compose", "docker-compose.dev.yml");

function parseEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** Devuelve las variables de entorno de desarrollo: .env local > .env.example > process.env. */
export function loadDevEnv() {
  const exampleFile = path.join(repoRoot, "deploy", "compose", ".env.example");
  const localFile = path.join(repoRoot, "deploy", "compose", ".env");
  const merged = { ...parseEnvFile(exampleFile), ...parseEnvFile(localFile) };
  // Las variables ya presentes en el entorno del shell tienen prioridad.
  return { ...merged, ...process.env };
}

export function logStep(scope, message) {
  console.log(`[dev:${scope}] ${message}`);
}

/**
 * Construye D1_DATABASE_URL/D2_DATABASE_URL a partir de los valores locales
 * de `deploy/compose/.env.example` (D1_PORT/D1_POSTGRES_*, D2_PORT/
 * D2_POSTGRES_*). `createD1Pool`/`createD2Pool` (S1-data) leen
 * D1_DATABASE_URL/D2_DATABASE_URL o, si faltan, LOCAL_POSTGRES_* /
 * CENTRAL_POSTGRES_*; construir la URL aquí evita repetir la lógica en cada
 * script de scripts/ que necesita hablarle a D1/D2 directamente.
 */
export function buildD1Url(env) {
  const host = "localhost";
  const port = env.D1_PORT ?? "5433";
  const db = env.D1_POSTGRES_DB ?? "nexo_venue";
  const user = env.D1_POSTGRES_USER ?? "nexo_venue";
  const password = env.D1_POSTGRES_PASSWORD ?? "nexo_venue_dev";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}

export function buildD2Url(env) {
  const host = "localhost";
  const port = env.D2_PORT ?? "5434";
  const db = env.D2_POSTGRES_DB ?? "nexo_central";
  const user = env.D2_POSTGRES_USER ?? "nexo_central";
  const password = env.D2_POSTGRES_PASSWORD ?? "nexo_central_dev";
  return `postgres://${user}:${password}@${host}:${port}/${db}`;
}
