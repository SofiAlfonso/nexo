#!/usr/bin/env node
// `deploy/scripts/down` — detiene las cargas de NEXO en Minikube sin borrar
// datos (PVCs de D1/D2 ni Secrets): D1/D2 pueden volver a arrancar con el
// mismo contenido. Usa `deploy/scripts/reset` para un borrado completo.
// Namespaces y `deploy/kubernetes/observability/` (de S2-otel) no se tocan.
import path from "node:path";
import { k8sDir, logStep, run, runAllowFail } from "./k8s-lib.mjs";

async function main() {
  logStep("down", "eliminando Jobs puntuales...");
  await runAllowFail("kubectl", ["delete", "job", "nexo-db-init", "-n", "nexo-venue", "--ignore-not-found"]);
  await runAllowFail("kubectl", ["delete", "job", "nexo-reader-load", "-n", "nexo-venue", "--ignore-not-found"]);
  await runAllowFail("kubectl", ["delete", "configmap", "nexo-reader-boletas", "-n", "nexo-venue", "--ignore-not-found"]);

  logStep("down", "eliminando Deployments/Services de aplicación...");
  await run("kubectl", ["delete", "-k", path.join(k8sDir, "application"), "--ignore-not-found"]);

  logStep("down", "eliminando StatefulSets/Services de datos (los PVC se conservan)...");
  await run("kubectl", ["delete", "-k", path.join(k8sDir, "data"), "--ignore-not-found"]);

  logStep("down", "listo. `deploy/scripts/up` reutiliza los datos existentes de D1/D2.");
}

main().catch((error) => {
  console.error(`[k8s:down] error: ${error.message}`);
  process.exitCode = 1;
});
