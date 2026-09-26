import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { ChaosRunner } from '../../../chaos/scripts/runner.ts';
import type { Dependencies } from '../../../chaos/scripts/actions.ts';

const example = {
  version: 1, id: 'lab-test', environment: 'minikube', owner: 'lab-operator',
  durationSeconds: 30,
  scope: { event: 'synthetic-event', gate: 'synthetic-gate', instance: 'synthetic-instance', synthetic: true },
  actions: [{ type: 'scale', namespace: 'nexo-venue', kind: 'statefulset', name: 'local-db', replicas: 0 }],
};

describe('nexo-chaos', () => {
  let directory: string;
  let file: string;
  let now: number;
  let exec: Dependencies['exec'];
  let runner: ChaosRunner;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nexo-chaos-test-'));
    file = join(directory, 'experiment.yaml');
    await writeFile(file, YAML.stringify(example));
    now = Date.parse('2026-01-01T00:00:00Z');
    exec = vi.fn(async (_command: string, _args: string[], _input?: string) =>
      JSON.stringify({ spec: { replicas: 2 } }));
    runner = new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: globalThis.fetch },
      now: () => now,
      watchdog: vi.fn(),
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  });

  it('rechaza producción y objetivos fuera del laboratorio', async () => {
    await writeFile(file, YAML.stringify({ ...example, environment: 'production' }));
    await expect(runner.validate(file)).rejects.toThrow();
    await writeFile(file, YAML.stringify({
      ...example, actions: [{ ...example.actions[0], namespace: 'default' }],
    }));
    await expect(runner.validate(file)).rejects.toThrow('nexo-venue');
  });

  it('valida F2 con selección exacta del Collector y sin destino de IP transitorio', async () => {
    const collectorSelector = {
      'app.kubernetes.io/instance': 'nexo-otel-collector',
      'app.kubernetes.io/name': 'opentelemetry-collector',
      component: 'standalone-collector',
    };
    await writeFile(file, YAML.stringify({
      ...example, actions: [{
        type: 'networkPolicy', namespace: 'nexo-observability',
        name: 'nexo-chaos-collector-egress', podSelector: collectorSelector, mode: 'denyAll',
      }],
    }));
    expect((await runner.validate(file)).actions[0]).toMatchObject({
      type: 'networkPolicy', mode: 'denyAll', podSelector: collectorSelector,
    });
  });

  it('exige un plan de la misma versión y confirmación expresa', async () => {
    await expect(runner.run(file, { confirm: false })).rejects.toThrow('--confirm');
    await expect(runner.run(file, { confirm: true, dryRun: true })).rejects.toThrow('plan');
    await runner.plan(file);
    await writeFile(file, YAML.stringify({ ...example, durationSeconds: 31 }));
    await expect(runner.run(file, { confirm: true, dryRun: true })).rejects.toThrow('plan');
  });

  it('no modifica recursos si el contexto no es Minikube', async () => {
    await runner.plan(file);
    await expect(runner.run(file, { confirm: true })).rejects.toThrow('Contexto Kubernetes no permitido');
    expect(await runner.status()).toBeNull();
  });

  it('registra el ensayo inocuo sin ejecutar acciones y restaura el bloqueo', async () => {
    await runner.plan(file);
    const result = await runner.run(file, { confirm: true, dryRun: true });
    expect(result.status).toBe('active');
    expect(exec).not.toHaveBeenCalled();
    expect((await readdir(join(directory, 'evidence'))).filter((name) => name.endsWith('.json'))).toContain(`${result.id}.json`);
    const restored = await runner.restore();
    expect(restored.status).toBe('restored');
    expect(await runner.status()).toBeNull();
    expect(JSON.parse(await readFile(join(directory, 'evidence', `${result.id}.json`), 'utf8'))).toMatchObject({
      id: result.id, dryRun: true, status: 'restored',
    });
  });

  it('preserva la exclusión mutua y recupera el ensayo seco al expirar', async () => {
    await runner.plan(file);
    await runner.run(file, { confirm: true, dryRun: true });
    await expect(runner.run(file, { confirm: true, dryRun: true })).rejects.toThrow('activo');
    now += 31_000;
    expect(await runner.status()).toBeNull();
    await runner.plan(file);
    expect((await runner.run(file, { confirm: true, dryRun: true })).status).toBe('active');
  });

  it('restaura réplicas reales desde el estado observado con un doble de kubectl', async () => {
    exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'config') return 'minikube\n';
      if (args.includes('get')) return JSON.stringify({
        spec: { replicas: 2 },
        metadata: { generation: 1, uid: 'synthetic-uid' },
        status: { readyReplicas: 2, replicas: 2, observedGeneration: 1 },
      });
      return '';
    });
    runner = new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: globalThis.fetch },
      now: () => now,
      watchdog: vi.fn(),
    });
    await runner.plan(file);
    const record = await runner.run(file, { confirm: true });
    expect(record.steps).toHaveLength(1);
    expect(record.steps[0]?.before).toMatchObject({ replicas: 2 });
    await runner.restore();
    const commands = vi.mocked(exec).mock.calls.map(([, args]) => args.join(' '));
    expect(commands.some((args) => args.includes('--replicas=0'))).toBe(true);
    expect(commands.some((args) => /replicas[^0-9]*2/.test(args))).toBe(true);
    expect(await runner.status()).toBeNull();
  });

  it('recupera el estado guardado cuando la inyección falla', async () => {
    exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'config') return 'minikube\n';
      if (args.includes('get')) return JSON.stringify({
        spec: { replicas: 2 }, metadata: { generation: 1, uid: 'synthetic-uid' },
        status: { readyReplicas: 2, observedGeneration: 1 },
      });
      if (args.includes('--replicas=0')) throw new Error('scale failed');
      return '';
    });
    runner = new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: globalThis.fetch },
      now: () => now, watchdog: vi.fn(),
    });
    await runner.plan(file);
    await expect(runner.run(file, { confirm: true })).rejects.toThrow('scale failed');
    expect(await runner.status()).toBeNull();
    expect((await runner.history())[0]).toMatchObject({
      status: 'restored', error: 'scale failed', steps: [{ restored: true }],
    });
  });

  it('deshabilita y restaura Toxiproxy mediante dobles de kubectl y HTTP', async () => {
    vi.stubEnv('NEXO_TOXIPROXY_URL', 'http://127.0.0.1:8474');
    await writeFile(file, YAML.stringify({
      ...example, actions: [{
        type: 'toxiproxy', namespace: 'nexo-venue', service: 'toxiproxy',
        proxy: 'c2-to-c4', mode: 'disable',
      }],
    }));
    let enabled = true;
    exec = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === 'config') return 'minikube\n';
      return JSON.stringify({ metadata: { uid: 'service-uid' }, spec: { ports: [{ port: 8474 }] } });
    });
    const fetchDouble: typeof fetch = vi.fn(async (_url, options) => {
      if (options?.method === 'POST') enabled = (JSON.parse(String(options.body)) as { enabled: boolean }).enabled;
      return new Response(JSON.stringify({ enabled, upstream: 'nexo-central:8080', toxics: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    runner = new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: fetchDouble },
      now: () => now, watchdog: vi.fn(),
    });
    await runner.plan(file);
    await runner.run(file, { confirm: true });
    expect(enabled).toBe(false);
    await runner.restore();
    expect(enabled).toBe(true);
    expect(vi.mocked(fetchDouble).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(2);
  });

  it('limita el corte de F2 al egress del Collector y elimina su policy al restaurar', async () => {
    const podSelector = {
      'app.kubernetes.io/instance': 'nexo-otel-collector',
      'app.kubernetes.io/name': 'opentelemetry-collector',
      component: 'standalone-collector',
    };
    await writeFile(file, YAML.stringify({
      ...example, actions: [{
        type: 'networkPolicy', namespace: 'nexo-observability',
        name: 'nexo-chaos-collector-egress', podSelector, mode: 'denyAll',
      }],
    }));
    let created: Record<string, unknown> | undefined;
    exec = vi.fn(async (_command: string, args: string[], input?: string) => {
      if (args[0] === 'config') return 'minikube\n';
      if (args.includes('networkpolicies')) return JSON.stringify({ items: created ? [created] : [] });
      if (args.includes('pods')) return JSON.stringify({ items: [{ status: { phase: 'Running' } }] });
      if (args.includes('create')) {
        created = JSON.parse(input ?? '{}') as Record<string, unknown>;
        return JSON.stringify(created);
      }
      if (args.includes('delete')) {
        created = undefined;
        return '';
      }
      throw new Error(`Comando inesperado: ${args.join(' ')}`);
    });
    runner = new ChaosRunner({
      evidenceDir: join(directory, 'evidence'),
      dependencies: { exec, fetch: globalThis.fetch },
      now: () => now, watchdog: vi.fn(),
    });
    await runner.plan(file);
    await runner.run(file, { confirm: true });
    expect(created).toMatchObject({
      kind: 'NetworkPolicy',
      spec: { policyTypes: ['Egress'], egress: [], podSelector: { matchLabels: podSelector } },
    });
    await runner.restore();
    expect(created).toBeUndefined();
    expect(await runner.status()).toBeNull();
  });
});
