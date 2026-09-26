// Utilidades compartidas por deploy/scripts/{up,down,load,reset}.mjs.
// Portable (Windows/PowerShell, macOS, Linux): usa node:child_process con
// shell: false y localiza binarios vía PATH.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(__dirname, "..", "..");
export const k8sDir = path.join(repoRoot, "deploy", "kubernetes");

export function logStep(scope, message) {
  console.log(`[k8s:${scope}] ${message}`);
}

/**
 * Ejecuta un comando heredando stdio; lanza si el código de salida no es 0.
 * Con `options.input` escribe ese texto en stdin (p. ej. `kubectl apply -f -`).
 */
export function run(command, args, { input, ...options } = {}) {
  return new Promise((resolve, reject) => {
    const stdio = input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit";
    const child = spawn(command, args, { cwd: repoRoot, stdio, shell: false, ...options });
    if (input !== undefined) {
      child.stdin.end(input);
    }
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(0);
      else reject(new Error(`${command} ${args.join(" ")} salió con código ${code}`));
    });
  });
}

/** Igual que run(), pero no lanza si el comando falla (devuelve el código). */
export async function runAllowFail(command, args, options = {}) {
  try {
    await run(command, args, options);
    return 0;
  } catch {
    return 1;
  }
}

export function captureOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024, // salidas grandes (p. ej. exportaciones de boletas vía `kubectl logs`)
  });
  return (result.stdout ?? "").trim();
}

export function commandExists(command) {
  const probe = process.platform === "win32" ? ["where", command] : ["which", command];
  const result = spawnSync(probe[0], probe.slice(1), { stdio: "ignore", shell: false });
  return result.status === 0;
}

/** Estado de control-plane de Minikube ("Running"/"Stopped"/inexistente). */
export function minikubeHostStatus() {
  const result = spawnSync("minikube", ["status", "-o", "json"], { encoding: "utf8", shell: false });
  if (result.status !== 0 && !result.stdout) return "Unknown";
  try {
    return JSON.parse(result.stdout).Host ?? "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Crea (o dejar intacto si ya existe) un Secret genérico a partir de pares
 * clave/valor. Nunca imprime los valores; es idempotente para que `up` sea
 * seguro de repetir. No usa `--dry-run|apply` para no sobrescribir un
 * password ya guardado (p. ej. tras un `seed` previo).
 */
export async function ensureSecret(namespace, name, literals) {
  const exists = spawnSync("kubectl", ["get", "secret", name, "-n", namespace], { stdio: "ignore", shell: false });
  if (exists.status === 0) {
    logStep("secrets", `${namespace}/${name} ya existe, se conserva.`);
    return;
  }
  const args = ["create", "secret", "generic", name, "-n", namespace];
  for (const [key, value] of Object.entries(literals)) args.push(`--from-literal=${key}=${value}`);
  await run("kubectl", args, { stdio: ["ignore", "ignore", "inherit"] });
  logStep("secrets", `${namespace}/${name} creado.`);
}

function parseEnvFile(filePath) {
  const values = {};
  if (!existsSync(filePath)) return values;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

/**
 * Valores de laboratorio para los Secrets del clúster: mismos valores por
 * omisión que `deploy/compose/.env.example` (no son secretos reales, ver
 * AGENTS.md invariante 8) para que `deploy/scripts/up` funcione con un solo
 * comando; cualquiera se sobreescribe exportando la variable de entorno
 * antes de ejecutar el script. `SEED_OPERATOR_PASSWORD` sigue sin valor
 * por omisión salvo que el propio entorno de laboratorio ya la traiga
 * (paridad con `deploy/scripts/seed.ps1`).
 */
export function loadLabSecrets() {
  const composeExample = parseEnvFile(path.join(repoRoot, "deploy", "compose", ".env.example"));
  const defaults = {
    LOCAL_POSTGRES_DB: composeExample.D1_POSTGRES_DB ?? "nexo_venue",
    LOCAL_POSTGRES_USER: composeExample.D1_POSTGRES_USER ?? "nexo_venue",
    LOCAL_POSTGRES_PASSWORD: composeExample.D1_POSTGRES_PASSWORD ?? "nexo_venue_dev",
    CENTRAL_POSTGRES_DB: composeExample.D2_POSTGRES_DB ?? "nexo_central",
    CENTRAL_POSTGRES_USER: composeExample.D2_POSTGRES_USER ?? "nexo_central",
    CENTRAL_POSTGRES_PASSWORD: composeExample.D2_POSTGRES_PASSWORD ?? "nexo_central_dev",
    SESSION_COOKIE_SECRET: composeExample.SESSION_COOKIE_SECRET ?? "nexo_dev_session_cookie_secret_change_me",
    PERMISOS_FIRMA_SECRETO: "nexo_dev_permisos_firma_secreto_change_me",
    SEED_OPERATOR_PASSWORD: composeExample.SEED_OPERATOR_PASSWORD ?? "",
  };
  return { ...defaults, ...process.env };
}

export async function waitRollout(kind, namespace, name, timeoutS = 180) {
  logStep("wait", `esperando ${kind}/${name} en ${namespace}...`);
  await run("kubectl", ["rollout", "status", kind, name, "-n", namespace, `--timeout=${timeoutS}s`]);
}
