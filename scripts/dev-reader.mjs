#!/usr/bin/env node
// `npm run dev:reader` — arranca el lector emulado (C1) con el perfil
// nominal de tests/load/ contra el C2 local levantado por `npm run dev`.
// Requiere que D1/D2 y C2 (local-coordinator) ya estén corriendo.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadDevEnv, logStep, repoRoot } from "./env.mjs";

const env = loadDevEnv();
const cliEntry = path.join(repoRoot, "src", "reader-client", "cli", "index.ts");

if (!existsSync(cliEntry)) {
  logStep(
    "reader",
    "omitido: src/reader-client/cli/index.ts aún no existe (pendiente en S1-reader).",
  );
  process.exit(0);
}

const extraArgs = process.argv.slice(2);
const args = [cliEntry, "--profile", "nominal", ...extraArgs];

logStep("reader", `iniciando lector emulado (perfil nominal) contra ${env.COORDINATOR_URL ?? `http://localhost:${env.COORDINATOR_PORT ?? "4001"}`} ...`);

const child = spawn("node", args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...env,
    COORDINATOR_URL: env.COORDINATOR_URL ?? `http://localhost:${env.COORDINATOR_PORT ?? "4001"}`,
  },
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
