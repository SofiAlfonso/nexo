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
