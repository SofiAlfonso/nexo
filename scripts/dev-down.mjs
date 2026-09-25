#!/usr/bin/env node
// `npm run dev:down` — detiene D1, D2 y otel-lgtm de docker-compose.dev.yml.
// Con `--volumes`/`-v`/`--reset` también borra los volúmenes (reinicia las
// bases). ADVERTENCIA (entorno compartido): el proyecto Compose `nexo-dev`
// es compartido entre sesiones de la ola 1; nunca borres sus volúmenes salvo
// que tú mismo lo necesites y sepas que nadie más depende de esos datos.

import { spawn } from "node:child_process";
import { composeFile, logStep, repoRoot } from "./env.mjs";

const wantsVolumes =
  process.argv.includes("--volumes") || process.argv.includes("-v") || process.argv.includes("--reset");
const args = ["compose", "-f", composeFile, "down"];
if (wantsVolumes) args.push("--volumes");

logStep("compose", `deteniendo D1/D2/otel-lgtm${wantsVolumes ? " y borrando volúmenes" : ""}...`);
const child = spawn("docker", args, { cwd: repoRoot, stdio: "inherit", shell: false });
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
