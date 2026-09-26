#!/usr/bin/env node
// `deploy/scripts/up` — despliega NEXO desde cero en Minikube (T26, ADR-015).
//
// 1. Verifica minikube/kubectl y arranca el clúster si está detenido (nunca
//    lo detiene ni lo borra: es compartido, ver AGENTS.md).
// 2. Construye las cinco imágenes con `minikube image build`
//    (`imagePullPolicy: Never`, G15).
// 3. Crea los Secrets de laboratorio si no existen (nunca versionados en
//    Git; ver config/README.md e invariante 8 de AGENTS.md).
// 4. Aplica `kubectl apply -k deploy/kubernetes/` (namespaces, observabilidad
//    de S2-otel, D1/D2, C2/C4/boletería/Toxiproxy y las NetworkPolicies).
// 5. Espera D1/D2, corre el Job nexo-db-init (migra y siembra) y espera a
//    que C2/C4/boletería/Toxiproxy estén Ready.
import path from "node:path";
import {
  ensureSecret, k8sDir, loadLabSecrets, logStep, minikubeHostStatus, run, runAllowFail, waitRollout,
} from "./k8s-lib.mjs";

const IMAGES = [
  { tag: "nexo/local-coordinator:dev", dockerfile: "src/local-coordinator/Dockerfile" },
  { tag: "nexo/central-core:dev", dockerfile: "src/central-core/Dockerfile" },
  { tag: "nexo/ticketing-sim:dev", dockerfile: "src/ticketing-sim/Dockerfile" },
  { tag: "nexo/reader-client:dev", dockerfile: "src/reader-client/Dockerfile" },
  { tag: "nexo/db-init:dev", dockerfile: "deploy/scripts/Dockerfile" },
];

async function ensureMinikubeRunning() {
  const status = minikubeHostStatus();
  if (status === "Running") {
    logStep("minikube", "el clúster ya está arriba.");
    return;
  }
  logStep("minikube", `estado "${status}"; arrancando (no se detiene ni se borra el compartido)...`);
  await run("minikube", ["start", "--driver=docker", "--cpus=4", "--memory=8192"]);
}

async function buildImages() {
  for (const { tag, dockerfile } of IMAGES) {
    logStep("build", `minikube image build -t ${tag} -f ${dockerfile} .`);
    await run("minikube", ["image", "build", "-t", tag, "-f", dockerfile, "."]);
  }
}

async function ensureSecrets() {
  const s = loadLabSecrets();
  await ensureSecret("nexo-venue", "nexo-d1-credentials", {
    POSTGRES_DB: s.LOCAL_POSTGRES_DB, POSTGRES_USER: s.LOCAL_POSTGRES_USER, POSTGRES_PASSWORD: s.LOCAL_POSTGRES_PASSWORD,
  });
  await ensureSecret("nexo-central", "nexo-d2-credentials", {
    POSTGRES_DB: s.CENTRAL_POSTGRES_DB, POSTGRES_USER: s.CENTRAL_POSTGRES_USER, POSTGRES_PASSWORD: s.CENTRAL_POSTGRES_PASSWORD,
  });
  // Copia de las credenciales de D2 en nexo-venue: la usa únicamente el Job
  // nexo-db-init (los Secrets son por namespace); no da alcance de red a D2,
  // que la NetworkPolicy nexo-d2 sigue negando al resto de nexo-venue.
  await ensureSecret("nexo-venue", "nexo-d2-credentials", {
    POSTGRES_DB: s.CENTRAL_POSTGRES_DB, POSTGRES_USER: s.CENTRAL_POSTGRES_USER, POSTGRES_PASSWORD: s.CENTRAL_POSTGRES_PASSWORD,
  });
  await ensureSecret("nexo-central", "nexo-central-app", {
    SESSION_COOKIE_SECRET: s.SESSION_COOKIE_SECRET, PERMISOS_FIRMA_SECRETO: s.PERMISOS_FIRMA_SECRETO,
  });
  if (!s.SEED_OPERATOR_PASSWORD) {
    throw new Error(
      "SEED_OPERATOR_PASSWORD es obligatoria (contraseña de laboratorio de los 5 operadores). " +
        "Expórtala antes de `up`, p. ej. desde deploy/compose/.env.example.",
    );
  }
  await ensureSecret("nexo-venue", "nexo-seed-credentials", { SEED_OPERATOR_PASSWORD: s.SEED_OPERATOR_PASSWORD });
}

async function applyManifests() {
  logStep("apply", "kubectl apply -k deploy/kubernetes/ ...");
  await run("kubectl", ["apply", "-k", k8sDir]);
}

async function runDbInit() {
  const jobPath = path.join(k8sDir, "application", "db-init-job.yaml");
  await waitRollout("statefulset", "nexo-venue", "nexo-d1");
  await waitRollout("statefulset", "nexo-central", "nexo-d2");
  logStep("db-init", "(re)ejecutando el Job de migración y semilla...");
  await runAllowFail("kubectl", ["delete", "job", "nexo-db-init", "-n", "nexo-venue", "--ignore-not-found"]);
  await run("kubectl", ["apply", "-f", jobPath]);
  await run("kubectl", ["wait", "--for=condition=complete", "job/nexo-db-init", "-n", "nexo-venue", "--timeout=180s"]);
  await run("kubectl", ["logs", "job/nexo-db-init", "-n", "nexo-venue"], { stdio: ["ignore", "inherit", "inherit"] });
}

async function waitApplication() {
  await waitRollout("deployment", "nexo-venue", "toxiproxy");
  await waitRollout("deployment", "nexo-venue", "nexo-coordinator");
  await waitRollout("deployment", "nexo-central", "nexo-central");
  await runAllowFail("kubectl", ["rollout", "status", "deployment", "nexo-ticketing", "-n", "nexo-external", "--timeout=60s"]);
}

async function main() {
  await ensureMinikubeRunning();
  await buildImages();
  await run("kubectl", ["apply", "-f", path.join(k8sDir, "namespaces")]);
  await ensureSecrets();
  await applyManifests();
  await runDbInit();
  await waitApplication();
  logStep(
    "up",
    "listo. C2: kubectl port-forward -n nexo-venue svc/nexo-coordinator 8081:8081; " +
      "C5/C4: kubectl port-forward -n nexo-central svc/nexo-central 8080:8080. " +
      "Prueba de frontera: `deploy/scripts/reset` documenta cómo verificar que C2 no alcanza D2; " +
      "ver tests/integration/k8s/network-policies.test.ts.",
  );
}

main().catch((error) => {
  console.error(`[k8s:up] error: ${error.message}`);
  process.exitCode = 1;
});
