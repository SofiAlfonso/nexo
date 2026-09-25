#!/usr/bin/env node
// `npm run dev:reader` — arranca el lector emulado (C1), perfil nominal,
// contra el C2 local levantado por `npm run dev`. Requiere que D1/D2 y
// local-coordinator ya estén corriendo.
//
// La CLI real (src/reader-client/cli/index.ts) usa subcomandos:
//   start --perfil nominal --lectores N --coordinador <url> --boletas <archivo>
// `--boletas` debe ser una exportación real de la semilla D1 (ver
// tests/load/README.md), acorde a los eventos/zonas del perfil `nominal`
// (EVT-2026-02). Si `npm run dev` ya sembró datos, usa por defecto la
// exportación que dejó en tmp/dev-boletas.json (--export de
// deploy/scripts/seed.ts); si no existe, pase `-- --boletas <ruta>` (y
// opcionalmente `--lectores`/`--evento`/`--duracion`) al invocar este script.

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

const coordinatorUrl = env.COORDINATOR_URL ?? `http://localhost:${env.COORDINATOR_PORT ?? "8081"}`;
const extraArgs = process.argv.slice(2);
const defaultBoletasPath = path.join(repoRoot, "tmp", "dev-boletas.json");

let args;
if (extraArgs.includes("--boletas")) {
  args = [cliEntry, "start", "--perfil", "nominal", "--lectores", "1", "--coordinador", coordinatorUrl, ...extraArgs];
} else if (existsSync(defaultBoletasPath)) {
  logStep("reader", `usando la exportación de \`npm run dev\` en ${defaultBoletasPath}.`);
  args = [
    cliEntry,
    "start",
    "--perfil",
    "nominal",
    "--lectores",
    "1",
    "--coordinador",
    coordinatorUrl,
    "--boletas",
    defaultBoletasPath,
    ...extraArgs,
  ];
} else {
  logStep(
    "reader",
    "falta --boletas: no hay exportación en tmp/dev-boletas.json (corre `npm run dev` primero, ya " +
      "que siembra y exporta) o pase una ruta propia, p. ej.\n" +
      "  npm run dev:reader -- --boletas C:\\nexo-datos\\boletas.json\n" +
      "Ver tests/load/README.md y src/reader-client/cli/README.md.",
  );
  process.exit(1);
}

logStep("reader", `iniciando lector emulado (perfil nominal) contra ${coordinatorUrl} ...`);

const child = spawn("node", args, {
  cwd: repoRoot,
  stdio: "inherit",
  shell: false,
  env: {
    ...env,
    COORDINATOR_URL: coordinatorUrl,
  },
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
