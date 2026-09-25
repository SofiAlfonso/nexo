#!/usr/bin/env node
// `npm run dev:down` — detiene D1, D2 y otel-lgtm de docker-compose.dev.yml.
// Con `--volumes` (o `-v`) también borra los volúmenes (reinicia las bases).

import { spawn } from "node:child_process";
import { composeFile, logStep, repoRoot } from "./env.mjs";

const wantsVolumes = process.argv.includes("--volumes") || process.argv.includes("-v");
const args = ["compose", "-f", composeFile, "down"];
if (wantsVolumes) args.push("--volumes");

logStep("compose", `deteniendo D1/D2/otel-lgtm${wantsVolumes ? " y borrando volúmenes" : ""}...`);
const child = spawn("docker", args, { cwd: repoRoot, stdio: "inherit", shell: false });
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
