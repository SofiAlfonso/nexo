#!/usr/bin/env node
// `deploy/scripts/load` — corre el lector emulado (C1) como Job de carga
// contra nexo-coordinator dentro del clúster (T26).
//
// 1. Exporta las boletas activas de D1 con un Pod puntual que reutiliza la
//    imagen `nexo/db-init:dev` y `deploy/scripts/export-boletas.ts` (de otra
//    sesión, sin modificar) hablando directo con D1 dentro de nexo-venue
//    (igual que nexo-db-init: mantenimiento, no tráfico de negocio). El JSON
//    se escribe a /dev/stdout y se recupera con `kubectl logs` (un pod
//    Completed no admite `kubectl exec`/`cp`).
// 2. Recorta la exportación (un evento sembrado real puede tener miles de
//    boletas y superar el límite de 1 MiB por objeto de Kubernetes) a una
//    muestra representativa por zona/estado, suficiente para el perfil de
//    carga `nominal`, y la publica como ConfigMap `nexo-reader-boletas`.
// 3. Aplica `deploy/kubernetes/application/reader-load-job.yaml` y sigue sus
//    logs hasta que termina.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { captureOutput, k8sDir, logStep, repoRoot, run, runAllowFail } from "./k8s-lib.mjs";

const EXPORT_PATH = path.join(repoRoot, "tmp", "k8s-boletas.json");
const EXPORTER_POD = "nexo-boletas-export";
// Máximo de boletas por combinación zona+estado+usada; con 5 zonas y hasta 3
// combinaciones (vigente sin usar, vigente usada, anulada) el ConfigMap
// resultante queda muy por debajo del límite de 1 MiB de etcd, con margen
// suficiente para el perfil de carga `nominal` (~165 presentaciones en 30 s).
const MAX_BOLETAS_POR_GRUPO = 150;

const exporterPodManifest = `
apiVersion: v1
kind: Pod
metadata:
  name: ${EXPORTER_POD}
  namespace: nexo-venue
  labels:
    app.kubernetes.io/name: ${EXPORTER_POD}
    app.kubernetes.io/part-of: nexo
    nexo.io/d1-client: "true"
spec:
  restartPolicy: Never
  containers:
    - name: ${EXPORTER_POD}
      image: nexo/db-init:dev
      imagePullPolicy: Never
      command: ["node", "deploy/scripts/export-boletas.ts", "/dev/stdout"]
      env:
        - name: LOCAL_POSTGRES_HOST
          value: "nexo-d1"
        - name: LOCAL_POSTGRES_PORT
          value: "5432"
        - name: LOCAL_POSTGRES_DB
          valueFrom: { secretKeyRef: { name: nexo-d1-credentials, key: POSTGRES_DB } }
        - name: LOCAL_POSTGRES_USER
          valueFrom: { secretKeyRef: { name: nexo-d1-credentials, key: POSTGRES_USER } }
        - name: LOCAL_POSTGRES_PASSWORD
          valueFrom: { secretKeyRef: { name: nexo-d1-credentials, key: POSTGRES_PASSWORD } }
`;

async function exportBoletasFromCluster() {
  await mkdir(path.dirname(EXPORT_PATH), { recursive: true });
  logStep("load", "exportando boletas activas de D1 con un Pod puntual...");
  await runAllowFail("kubectl", ["delete", "pod", EXPORTER_POD, "-n", "nexo-venue", "--ignore-not-found"]);
  await run("kubectl", ["apply", "-f", "-"], { input: exporterPodManifest });
  await run("kubectl", [
    "wait", "--for=jsonpath={.status.phase}=Succeeded", `pod/${EXPORTER_POD}`, "-n", "nexo-venue", "--timeout=60s",
  ]);
  // Un pod Completed no admite `kubectl exec`/`cp`; se lee la exportación
  // (escrita a /dev/stdout por export-boletas.ts) desde sus logs.
  const boletasJson = captureOutput("kubectl", ["logs", EXPORTER_POD, "-n", "nexo-venue"]);
  const exportacion = JSON.parse(boletasJson);
  await runAllowFail("kubectl", ["delete", "pod", EXPORTER_POD, "-n", "nexo-venue", "--ignore-not-found"]);

  const recortada = {
    eventos: exportacion.eventos.map((evento) => ({
      eventoId: evento.eventoId,
      boletas: recortarBoletas(evento.boletas),
    })),
    lectores: exportacion.lectores,
  };
  const recortadaJson = JSON.stringify(recortada);
  logStep("load", `boletas exportadas: ${boletasJson.length} bytes -> recortadas a ${recortadaJson.length} bytes`);
  await writeFile(EXPORT_PATH, recortadaJson);
}

// Conserva hasta MAX_BOLETAS_POR_GRUPO boletas por combinación de
// zona+estado+usada, para mantener una muestra representativa de cada caso
// (vigente disponible, usada, anulada) en cada zona sin arrastrar miles de
// filas de la exportación completa de D1 al ConfigMap del Job de carga.
function recortarBoletas(boletas) {
  const cuentas = new Map();
  return boletas.filter((boleta) => {
    const clave = `${boleta.zona}|${boleta.estado}|${boleta.usada}`;
    const cuenta = cuentas.get(clave) ?? 0;
    if (cuenta >= MAX_BOLETAS_POR_GRUPO) return false;
    cuentas.set(clave, cuenta + 1);
    return true;
  });
}

async function runReaderJob() {
  logStep("load", "publicando ConfigMap nexo-reader-boletas...");
  await runAllowFail("kubectl", ["delete", "configmap", "nexo-reader-boletas", "-n", "nexo-venue", "--ignore-not-found"]);
  await run("kubectl", [
    "create", "configmap", "nexo-reader-boletas", "-n", "nexo-venue",
    `--from-file=boletas.json=${EXPORT_PATH}`,
  ]);

  logStep("load", "(re)ejecutando el Job nexo-reader-load...");
  await runAllowFail("kubectl", ["delete", "job", "nexo-reader-load", "-n", "nexo-venue", "--ignore-not-found"]);
  await run("kubectl", ["apply", "-f", path.join(k8sDir, "application", "reader-load-job.yaml")]);
  await run("kubectl", ["wait", "--for=condition=complete", "job/nexo-reader-load", "-n", "nexo-venue", "--timeout=120s"]);
  await run("kubectl", ["logs", "job/nexo-reader-load", "-n", "nexo-venue"], { stdio: ["ignore", "inherit", "inherit"] });
}

async function main() {
  await exportBoletasFromCluster();
  await runReaderJob();
}

main().catch((error) => {
  console.error(`[k8s:load] error: ${error.message}`);
  process.exitCode = 1;
});
