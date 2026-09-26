// Verifica en vivo, contra el clúster de Minikube desplegado por
// `deploy/scripts/up` (T26, ADR-015), el criterio de aceptación central:
// C2 (nexo-coordinator) NO alcanza D2 directamente — solo puede llegar a D1
// y a C4 a través de Toxiproxy — mientras que las rutas legítimas siguen
// abiertas. No crea ni borra recursos: solo ejecuta comandos de solo
// lectura (`kubectl get`/`kubectl exec`) sobre lo que ya está corriendo.
//
// Si `kubectl` no está disponible o el Deployment nexo-coordinator no está
// Ready, la suite se omite con una advertencia (no rompe el pipeline de
// otras sesiones que no tienen el clúster desplegado).
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const NAMESPACE_VENUE = 'nexo-venue';
const NAMESPACE_CENTRAL = 'nexo-central';
const COORDINATOR_SELECTOR = 'app.kubernetes.io/name=nexo-coordinator';

function kubectl(args: string[]): string | null {
  try {
    return execFileSync('kubectl', args, { encoding: 'utf8', timeout: 15_000 }).trim();
  } catch {
    return null;
  }
}

function coordinatorPodName(): string | null {
  const output = kubectl([
    'get', 'pods', '-n', NAMESPACE_VENUE, '-l', COORDINATOR_SELECTOR,
    '-o', 'jsonpath={.items[0].metadata.name}',
  ]);
  return output && output.length > 0 ? output : null;
}

function podIsReady(namespace: string, name: string): boolean {
  const status = kubectl([
    'get', 'pod', name, '-n', namespace, '-o', 'jsonpath={.status.containerStatuses[0].ready}',
  ]);
  return status === 'true';
}

/** Corre un chequeo TCP de node dentro del pod indicado (sin herramientas extra, solo node). */
function tcpCheckInsidePod(namespace: string, pod: string, host: string, port: number, timeoutMs: number):
  { outcome: 'connected' | 'refused-or-timeout'; detail: string } {
  const script = `
    const s = require('net').createConnection({ host: '${host}', port: ${port}, timeout: ${timeoutMs} });
    s.on('connect', () => { console.log('connected'); s.destroy(); process.exit(0); });
    s.on('timeout', () => { console.log('timeout'); process.exit(0); });
    s.on('error', (e) => { console.log('error:' + e.message); process.exit(0); });
  `;
  const output = kubectl(['exec', '-n', namespace, pod, '--', 'node', '-e', script]);
  if (output === null) return { outcome: 'refused-or-timeout', detail: 'kubectl exec failed' };
  const outcome = output.startsWith('connected') ? 'connected' : 'refused-or-timeout';
  return { outcome, detail: output };
}

const coordinatorPod = coordinatorPodName();
const clusterReady = coordinatorPod !== null && podIsReady(NAMESPACE_VENUE, coordinatorPod);

if (!clusterReady) {
  console.warn(
    '[k8s-network-policies] omitida: no se encontró un pod nexo-coordinator Ready en ' +
      `${NAMESPACE_VENUE}. Ejecuta \`deploy/scripts/up\` (o su envoltorio .ps1) contra Minikube primero.`,
  );
}

describe.skipIf(!clusterReady)('NetworkPolicies de NEXO en Minikube (T26)', () => {
  it('C2 NO alcanza D2 directamente (nexo-d2.nexo-central bloqueado)', () => {
    const result = tcpCheckInsidePod(
      NAMESPACE_VENUE, coordinatorPod!, 'nexo-d2.nexo-central.svc.cluster.local', 5432, 5_000,
    );
    expect(result.outcome).toBe('refused-or-timeout');
  }, 20_000);

  it('C2 SÍ alcanza D1 a través de Toxiproxy (toxiproxy:15432)', () => {
    const result = tcpCheckInsidePod(NAMESPACE_VENUE, coordinatorPod!, 'toxiproxy', 15432, 5_000);
    expect(result.outcome).toBe('connected');
  }, 20_000);

  it('C2 SÍ alcanza C4 a través de Toxiproxy (toxiproxy:18080)', () => {
    const result = tcpCheckInsidePod(NAMESPACE_VENUE, coordinatorPod!, 'toxiproxy', 18080, 5_000);
    expect(result.outcome).toBe('connected');
  }, 20_000);

  it('D2 sigue siendo alcanzable dentro de nexo-central (para C4)', () => {
    const centralPod = kubectl([
      'get', 'pods', '-n', NAMESPACE_CENTRAL, '-l', 'app.kubernetes.io/name=nexo-central',
      '-o', 'jsonpath={.items[0].metadata.name}',
    ]);
    expect(centralPod).toBeTruthy();
    const result = tcpCheckInsidePod(NAMESPACE_CENTRAL, centralPod!, 'nexo-d2', 5432, 5_000);
    expect(result.outcome).toBe('connected');
  }, 20_000);
});
