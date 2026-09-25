#!/usr/bin/env node
// `npm run dev` — entorno local de M1 (T27, S1-platform).
//
// 1. Levanta D1, D2 y otel-lgtm con deploy/compose/docker-compose.dev.yml y
//    espera sus healthchecks.
// 2. Ejecuta migraciones y semilla de D1/D2 si ya existen (S1-data); si no,
//    lo indica y continúa (M1 aún en construcción entre sesiones paralelas).
// 3. Arranca C4 (central-core) y C2 (local-coordinator) con la salida
//    prefijada por servicio.
// 4. Con Ctrl+C detiene los procesos de Node de forma ordenada; D1/D2/
//    otel-lgtm quedan corriendo (deténlos con `npm run dev:down` o
//    `docker compose -f deploy/compose/docker-compose.dev.yml down`).
//
// ADVERTENCIA (entorno compartido, un solo Docker): el proyecto Compose
// `nexo-dev` (D1 5433, D2 5434, otel-lgtm) es compartido entre sesiones de
// la ola 1. Este script sólo hace `up -d` (idempotente) y NUNCA `down -v`;
// para borrar volúmenes usa explícitamente `npm run dev:down -- --reset`.
// Las pruebas automáticas (unit/integración) deben usar Testcontainers, no
// este stack compartido.
//
// Portable (Windows/PowerShell, macOS, Linux): usa `node:child_process` con
// `shell: false` y localiza binarios vía PATH, sin sintaxis de shell.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { composeFile, loadDevEnv, logStep, repoRoot } from "./env.mjs";

const env = loadDevEnv();
const COMPOSE_PROJECT = "nexo-dev";
const DB_SERVICES = [
  { container: `${COMPOSE_PROJECT}-d1-1`, label: "D1 (venue)" },
  { container: `${COMPOSE_PROJECT}-d2-1`, label: "D2 (central)" },
  { container: `${COMPOSE_PROJECT}-otel-lgtm-1`, label: "otel-lgtm" },
];

const children = [];
let shuttingDown = false;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${command} ${args.join(" ")} salió con código ${code}`));
    });
  });
}

function captureOutput(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: repoRoot, shell: false });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(out.trim()));
  });
}

async function waitForHealthy({ container, label }, timeoutMs = 120_000) {
  const start = Date.now();
  logStep("compose", `esperando a que ${label} (${container}) esté healthy...`);
  for (;;) {
    const status = await captureOutput("docker", [
      "inspect",
      "--format",
      "{{.State.Health.Status}}",
      container,
    ]);
    if (status === "healthy") {
      logStep("compose", `${label} está healthy.`);
      return;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Tiempo de espera agotado para ${label} (${container}); último estado: "${status || "desconocido"}".`,
      );
    }
    await delay(2000);
  }
}

/**
 * Corre un script opcional si su archivo de presencia ya existe (p. ej. una
 * migración publicada por otra sesión); si no, lo indica y continúa.
 * `presenceRelativePath` permite comprobar un archivo (propiedad de otra
 * sesión) distinto del que realmente se ejecuta (un wrapper propio de
 * scripts/, como scripts/migrate.ts).
 */
async function runOptionalScript(scope, presenceRelativePath, args = [], runRelativePath = presenceRelativePath) {
  const presencePath = path.join(repoRoot, presenceRelativePath);
  if (!existsSync(presencePath)) {
    logStep(scope, `omitido: ${presenceRelativePath} aún no existe (pendiente en otra sesión de la ola 1).`);
    return;
  }
  const runPath = path.join(repoRoot, runRelativePath);
  logStep(scope, `ejecutando ${runRelativePath} ${args.join(" ")}...`.trim());
  await run("node", [runPath, ...args], { env });
  logStep(scope, `${runRelativePath} ${args.join(" ")} completado.`.trim());
}

function spawnService(name, entryRelativePath, extraEnv = {}) {
  const entryPath = path.join(repoRoot, entryRelativePath);
  if (!existsSync(entryPath)) {
    logStep(name, `omitido: ${entryRelativePath} no existe todavía.`);
    return null;
  }
  logStep(name, `iniciando node ${entryRelativePath} ...`);
  const child = spawn("node", [entryPath], {
    cwd: repoRoot,
    shell: false,
    env: { ...env, ...extraEnv },
  });
  children.push(child);

  const prefixLines = (buffer) =>
    buffer
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .forEach((line) => console.log(`[${name}] ${line}`));

  child.stdout?.on("data", prefixLines);
  child.stderr?.on("data", prefixLines);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code === 0 && signal === null) {
      logStep(
        name,
        `el proceso terminó (código 0). Si ${entryRelativePath} todavía es un módulo vacío ` +
          "(export {};), esto es esperado hasta que la sesión dueña implemente el servidor.",
      );
    } else {
      logStep(name, `el proceso terminó de forma inesperada (código ${code}, señal ${signal}).`);
    }
  });
  return child;
}

async function main() {
  logStep("compose", `levantando D1, D2 y otel-lgtm (${composeFile})...`);
  await run("docker", ["compose", "-f", composeFile, "up", "-d"]);

  for (const service of DB_SERVICES) {
    await waitForHealthy(service);
  }

  await runOptionalScript(
    "migrate",
    path.join("src", "local-coordinator", "infrastructure", "db", "migrate.ts"),
    ["d1"],
    path.join("scripts", "migrate.ts"),
  );
  await runOptionalScript(
    "migrate",
    path.join("src", "central-core", "infrastructure", "db", "migrate.ts"),
    ["d2"],
    path.join("scripts", "migrate.ts"),
  );
  await runOptionalScript("seed", path.join("deploy", "scripts", "seed-d1.ts"));
  await runOptionalScript("seed", path.join("deploy", "scripts", "seed-d2.ts"));

  spawnService("central", path.join("src", "central-core", "index.ts"), {
    PORT: env.CENTRAL_PORT ?? "8080",
  });
  spawnService("coordinator", path.join("src", "local-coordinator", "index.ts"), {
    PORT: env.COORDINATOR_PORT ?? "8081",
    CENTRAL_URL: env.CENTRAL_URL ?? "http://localhost:8080",
  });

  logStep(
    "dev",
    "entorno local arriba. D1/D2/otel-lgtm en Docker Compose; Ctrl+C detiene C4/C2 " +
      "(las bases de datos siguen corriendo; usa `npm run dev:down` para pararlas).",
  );
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logStep("dev", `recibida ${signal}, deteniendo procesos de Node...`);
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error(`[dev] error: ${error.message}`);
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = 1;
});
