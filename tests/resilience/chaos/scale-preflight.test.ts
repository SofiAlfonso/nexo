import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { ChaosRunner } from '../../../chaos/scripts/runner.ts';
import type { Dependencies } from '../../../chaos/scripts/actions.ts';

const experiment = {
  version: 1, id: 'ser-06-observability-outage', environment: 'minikube',
  owner: 'lab-operator', durationSeconds: 900,
  scope: { event: 'lab-event-01', gate: 'gate-01', instance: 'venue-01', synthetic: true },
  actions: [{ type: 'scale', namespace: 'nexo-observability', kind: 'deployment', name: 'nexo-otel-lgtm', replicas: 0 }],
};

describe('F2 scale preflight', () => {
  let directory: string;
  let file: string;
  let exec: Dependencies['exec'];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexo-chaos-scale-'));
    file = join(directory, 'experiment.yaml');
    await writeFile(file, YAML.stringify(experiment));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  function runner(): ChaosRunner {
    return new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: globalThis.fetch },
      now: () => Date.parse('2026-01-01T00:00:00Z'), watchdog: vi.fn(),
    });
  }

  it('confirma el corte solo tras desaparecer réplicas y pods del backend', async () => {
    let replicas = 1;
    let inspectedPods = 0;
    exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'config') return 'minikube\n';
      if (args.includes('pods')) {
        inspectedPods++;
        return JSON.stringify({ items: [] });
      }
      if (args.includes('get')) return JSON.stringify({
        metadata: { uid: 'lgtm-uid', generation: 1 },
        spec: { replicas, selector: { matchLabels: { 'app.kubernetes.io/name': 'nexo-otel-lgtm' } } },
        status: { readyReplicas: replicas, availableReplicas: replicas, observedGeneration: 1 },
      });
      if (args.includes('scale')) {
        replicas = args.includes('--replicas=0') ? 0 : 1;
        return '';
      }
      throw new Error(`Comando inesperado: ${args.join(' ')}`);
    });
    const chaos = runner();
    await chaos.plan(file);
    await chaos.run(file, { confirm: true });
    expect(replicas).toBe(0);
    expect(inspectedPods).toBeGreaterThan(0);
    await chaos.restore();
    expect(replicas).toBe(1);
  });

  it('aborta y libera el bloqueo si scale no corta realmente la exportación', async () => {
    exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'config') return 'minikube\n';
      if (args.includes('get')) return JSON.stringify({
        metadata: { uid: 'lgtm-uid', generation: 1 },
        spec: { replicas: 1, selector: { matchLabels: { 'app.kubernetes.io/name': 'nexo-otel-lgtm' } } },
        status: { readyReplicas: 1, availableReplicas: 1, observedGeneration: 1 },
      });
      return '';
    });
    const chaos = runner();
    await chaos.plan(file);
    await expect(chaos.run(file, { confirm: true })).rejects.toThrow();
    expect(await chaos.status()).toBeNull();
    expect((await chaos.history())[0]?.status).toBe('restored');
  });
});
