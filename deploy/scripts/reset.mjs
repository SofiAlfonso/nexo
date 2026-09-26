#!/usr/bin/env node
// `deploy/scripts/reset` — borra por completo el estado de NEXO en Minikube:
// aplica `down` y además elimina los PVC de D1/D2 y los Secrets de
// laboratorio, para que el próximo `up` arranque desde cero. Requiere
// `--confirm` (mismo espíritu que nunca hacer `docker compose down -v` sobre
// el stack compartido: aquí el borrado es explícito y deliberado). No toca
// los namespaces ni `deploy/kubernetes/observability/` (de S2-otel).
import { fileURLToPath } from "node:url";
import { logStep, run, runAllowFail } from "./k8s-lib.mjs";

const SECRETS = [
  ["nexo-venue", "nexo-d1-credentials"],
  ["nexo-venue", "nexo-d2-credentials"],
  ["nexo-venue", "nexo-seed-credentials"],
  ["nexo-central", "nexo-d2-credentials"],
  ["nexo-central", "nexo-central-app"],
];

async function main() {
  if (!process.argv.includes("--confirm")) {
    console.error("[k8s:reset] borra datos de D1/D2 y los Secrets del laboratorio. Repite con --confirm.");
    process.exitCode = 1;
    return;
  }

  await run(process.execPath, [fileURLToPath(new URL("./down.mjs", import.meta.url))]);

  logStep("reset", "eliminando PVC de D1 y D2...");
  await runAllowFail("kubectl", ["delete", "pvc", "-n", "nexo-venue", "-l", "app.kubernetes.io/name=nexo-d1", "--ignore-not-found"]);
  await runAllowFail("kubectl", ["delete", "pvc", "-n", "nexo-central", "-l", "app.kubernetes.io/name=nexo-d2", "--ignore-not-found"]);

  logStep("reset", "eliminando Secrets de laboratorio...");
  for (const [namespace, name] of SECRETS) {
    await runAllowFail("kubectl", ["delete", "secret", name, "-n", namespace, "--ignore-not-found"]);
  }

  logStep("reset", "listo. `deploy/scripts/up` vuelve a crear Secrets y datos desde cero.");
}

main().catch((error) => {
  console.error(`[k8s:reset] error: ${error.message}`);
  process.exitCode = 1;
});
