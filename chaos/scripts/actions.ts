import type { Action } from './schema.ts';
import { randomUUID } from 'node:crypto';

export interface Dependencies {
  exec: (command: string, args: string[], input?: string) => Promise<string>;
  fetch: typeof globalThis.fetch;
}

export type Before =
  | { type: 'toxiproxy'; enabled: boolean; upstream: string; serviceUid: string; toxicName?: string; toxics: Record<string, unknown>[] }
  | { type: 'scale'; uid: string; replicas: number }
  | { type: 'networkPolicy'; absent: true; token: string; spec: Record<string, unknown> }
  | { type: 'stress'; pod: string; uid: string; token: string }
  | { type: 'cpuLimit'; uid: string; containerIndex: number; resources: Record<string, unknown>; applied: Record<string, unknown>; hadResources: boolean };

type RecordValue = Record<string, unknown>;

function object(value: unknown, label: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected object`);
  }
  return value as RecordValue;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Invalid ${label}`);
  return value;
}

function integer(value: unknown, label: string, min = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`Invalid ${label}`);
  return value as number;
}

function name(value: string, label: string): string {
  if (!/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(value) || value.length > 63) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function namespace(value: string): string {
  name(value, 'namespace');
  if (!['nexo-venue', 'nexo-central', 'nexo-external', 'nexo-observability', 'nexo-chaos'].includes(value)) {
    throw new Error('Chaos actions are restricted to known nexo namespaces');
  }
  return value;
}

function json(value: string, label: string): RecordValue {
  return object(JSON.parse(value) as unknown, label);
}

async function kubectl(deps: Dependencies, ns: string, args: string[], input?: string): Promise<string> {
  return deps.exec('kubectl', ['--namespace', namespace(ns), ...args], input);
}

async function get(deps: Dependencies, ns: string, resource: string, id: string): Promise<RecordValue> {
  return json(await kubectl(deps, ns, ['get', resource, name(id, resource), '-o', 'json']), resource);
}

function uid(resource: RecordValue): string {
  return string(object(resource.metadata, 'metadata').uid, 'metadata.uid');
}

function ready(resource: RecordValue): number {
  const status = object(resource.status, 'status');
  return status.readyReplicas === undefined ? 0 : integer(status.readyReplicas, 'readyReplicas');
}

function requireReady(resource: RecordValue): void {
  const replicas = integer(object(resource.spec, 'spec').replicas, 'replicas', 1);
  if (ready(resource) !== replicas || object(resource.status, 'status').observedGeneration !== object(resource.metadata, 'metadata').generation) {
    throw new Error('Target workload is not ready or observed');
  }
}

function beforeOf<T extends Before['type']>(value: unknown, type: T): Extract<Before, { type: T }> {
  const state = object(value, 'restoration snapshot');
  if (state.type !== type) throw new Error(`Missing ${type} restoration snapshot`);
  return state as Extract<Before, { type: T }>;
}

function assertUid(resource: RecordValue, expected: string): void {
  if (uid(resource) !== string(expected, 'saved UID')) throw new Error('Target was replaced; refusing to restore a different resource');
}

function toxicUrl(action: Extract<Action, { type: 'toxiproxy' }>): URL {
  // Configure NEXO_TOXIPROXY_URL for an existing port-forward:
  // kubectl -n <action.namespace> port-forward service/<action.service> <local-port>:8474
  // The caller owns that forward; this adapter rejects remote URLs and never starts one.
  const raw = process.env.NEXO_TOXIPROXY_URL;
  if (!raw) throw new Error('NEXO_TOXIPROXY_URL must point to an existing local port-forward');
  const url = new URL(raw);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Toxiproxy API must be a plain HTTP loopback URL with an explicit port');
  }
  name(action.proxy, 'proxy');
  return url;
}

async function api(deps: Dependencies, base: URL, path: string, method = 'GET', body?: RecordValue): Promise<RecordValue> {
  const response = await deps.fetch(new URL(path, base), {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`Toxiproxy ${method} failed (${response.status})`);
  return object(await response.json() as unknown, 'Toxiproxy response');
}

function proxyPath(proxy: string): string {
  return `proxies/${encodeURIComponent(proxy)}`;
}

function proxyEnabled(proxy: RecordValue): boolean {
  if (typeof proxy.enabled !== 'boolean') throw new Error('Invalid Toxiproxy enabled state');
  return proxy.enabled;
}

function toxics(proxy: RecordValue): RecordValue[] {
  if (!Array.isArray(proxy.toxics)) throw new Error('Unknown Toxiproxy toxic state');
  return proxy.toxics.map((value: unknown) => object(value, 'toxic'));
}

async function proxyFor(action: Extract<Action, { type: 'toxiproxy' }>, deps: Dependencies): Promise<{ base: URL; proxy: RecordValue; serviceUid: string }> {
  const service = await get(deps, action.namespace, 'service', action.service);
  const ports = object(service.spec, 'service spec').ports;
  if (!Array.isArray(ports) || !ports.some((port: unknown) => object(port, 'service port').port === 8474)) {
    throw new Error('The selected Toxiproxy service must expose API port 8474');
  }
  const base = toxicUrl(action);
  return { base, proxy: await api(deps, base, proxyPath(action.proxy)), serviceUid: uid(service) };
}

function cpuContainer(deployment: RecordValue, container: string): { index: number; resources: RecordValue } {
  const containers = object(object(deployment.spec, 'spec').template, 'template');
  const list = object(containers.spec, 'pod spec').containers;
  if (!Array.isArray(list)) throw new Error('Invalid container list');
  const index = list.findIndex((entry: unknown) => object(entry, 'container').name === container);
  if (index < 0) throw new Error('Container does not exist');
  const resources = object(list[index], 'container').resources;
  return { index, resources: resources === undefined ? {} : object(resources, 'resources') };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  }
  return value;
}

function sameResources(current: RecordValue, applied: RecordValue): boolean {
  if (current.limits === undefined) return false;
  const currentLimits = object(current.limits, 'current limits');
  const appliedLimits = object(applied.limits, 'applied limits');
  const normalizeCpu = (value: unknown): number => {
    const text = string(value, 'CPU quantity');
    return text.endsWith('m') ? Number(text.slice(0, -1)) : Number(text) * 1000;
  };
  if (normalizeCpu(currentLimits.cpu) !== normalizeCpu(appliedLimits.cpu)) return false;
  const normalized = { ...current, limits: { ...currentLimits, cpu: appliedLimits.cpu } };
  return JSON.stringify(stable(normalized)) === JSON.stringify(stable(applied));
}

async function podFor(deps: Dependencies, action: Extract<Action, { type: 'stress' }>): Promise<{ pod: string; uid: string }> {
  const workload = await get(deps, action.namespace, 'deployment', action.deployment);
  requireReady(workload);
  const selector = object(object(object(workload.spec, 'spec').selector, 'selector').matchLabels, 'matchLabels');
  const labels = Object.entries(selector);
  if (labels.length === 0 || labels.some(([key, val]) => !/^[\w./-]+$/.test(key) || typeof val !== 'string' || !/^[\w.-]+$/.test(val))) {
    throw new Error('Deployment needs a safe, nonempty matchLabels selector');
  }
  const pods = json(await kubectl(deps, action.namespace, ['get', 'pods', '-l', labels.map(([k, v]) => `${k}=${v}`).join(','), '-o', 'json']), 'pods').items;
  if (!Array.isArray(pods) || pods.length !== 1) throw new Error('Stress requires exactly one selected pod');
  const pod = object(pods[0], 'pod');
  if (object(pod.status, 'pod status').phase !== 'Running') throw new Error('Pod is not running');
  const statuses = object(pod.status, 'pod status').containerStatuses;
  if (!Array.isArray(statuses) || !statuses.some((s: unknown) => object(s, 'container status').name === action.container && object(s, 'container status').ready === true)) {
    throw new Error('Auxiliary container is not ready');
  }
  const containers = object(pod.spec, 'pod spec').containers;
  if (!Array.isArray(containers) || !containers.some((c: unknown) => object(c, 'container').name === action.container)) {
    throw new Error('Auxiliary container does not exist');
  }
  return { pod: name(string(object(pod.metadata, 'pod metadata').name, 'pod name'), 'pod'), uid: uid(pod) };
}

const stressFind = 'token=$1; for proc in /proc/[0-9]*; do test -r "$proc/environ" || continue; tr "\\000" "\\n" < "$proc/environ" | grep -Fxq "NEXO_CHAOS_TOKEN=$token" || continue; comm=$(cat "$proc/comm"); case "$comm" in stress-ng*) printf "%s\\n" "${proc#/proc/}";; esac; done';
const stressStart = 'command -v stress-ng >/dev/null && command -v tr >/dev/null && command -v grep >/dev/null || exit 1; NEXO_CHAOS_TOKEN="$1" stress-ng --cpu "$2" --timeout 900s </dev/null >/dev/null 2>&1 & pid=$!; sleep 1; if ! test -r "/proc/$pid/stat"; then exit 1; fi; comm=$(cat "/proc/$pid/comm"); case "$comm" in stress-ng*) ;; *) kill -TERM "$pid" 2>/dev/null; exit 1;; esac';
const stressStop = 'token=$1; for proc in /proc/[0-9]*; do test -r "$proc/environ" || continue; tr "\\000" "\\n" < "$proc/environ" | grep -Fxq "NEXO_CHAOS_TOKEN=$token" || continue; comm=$(cat "$proc/comm"); case "$comm" in stress-ng*) pid=${proc#/proc/}; kill -TERM "$pid" || exit 1;; esac; done';

function cidr(value: string): string {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  if (!match || match.slice(1, 5).some((octet) => Number(octet) > 255) || Number(match[5]) < 1 || Number(match[5]) > 32) {
    throw new Error('targetIpBlock must be a valid IPv4 CIDR');
  }
  return value;
}

function tokenOf(value: unknown): string {
  const token = string(value, 'saved token');
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(token)) throw new Error('Invalid saved chaos token');
  return token;
}

function toxicDefinition(action: Extract<Action, { type: 'toxiproxy' }>, toxicName: string): RecordValue {
  return { name: toxicName, type: 'latency', stream: 'downstream', toxicity: 1,
    attributes: { latency: integer(action.latencyMs, 'latencyMs', 1), jitter: 0 } };
}

function matchesToxic(toxic: RecordValue, action: Extract<Action, { type: 'toxiproxy' }>, toxicName: string): boolean {
  const expected = toxicDefinition(action, toxicName);
  const attributes = object(toxic.attributes, 'toxic attributes');
  return toxic.name === expected.name && toxic.type === expected.type && toxic.stream === expected.stream &&
    toxic.toxicity === expected.toxicity && attributes.latency === action.latencyMs && attributes.jitter === 0;
}

function policySpec(action: Extract<Action, { type: 'networkPolicy' }>): RecordValue {
  const blocked = cidr(action.targetIpBlock);
  const otherPorts = [
    ...(action.port > 1 ? [{ protocol: 'TCP', port: 1, endPort: action.port - 1 }] : []),
    ...(action.port < 65535 ? [{ protocol: 'TCP', port: action.port + 1, endPort: 65535 }] : []),
  ];
  return {
    podSelector: { matchLabels: action.podSelector }, policyTypes: ['Egress'],
    egress: [
      { to: [{ ipBlock: { cidr: '0.0.0.0/0', except: [blocked] } }] },
      ...otherPorts.map((range) => ({ to: [{ ipBlock: { cidr: blocked } }], ports: [range] })),
    ],
  };
}

async function policies(action: Extract<Action, { type: 'networkPolicy' }>, deps: Dependencies): Promise<RecordValue[]> {
  const items = json(await kubectl(deps, action.namespace, ['get', 'networkpolicies', '-o', 'json']), 'policies').items;
  if (!Array.isArray(items)) throw new Error('Invalid network policy list');
  return items.map((item: unknown) => object(item, 'policy'));
}

function ownedPolicy(resource: RecordValue, saved: Extract<Before, { type: 'networkPolicy' }>): void {
  const metadata = object(resource.metadata, 'policy metadata');
  if (object(metadata.annotations, 'policy annotations')['nexo.dev/chaos-token'] !== saved.token ||
      JSON.stringify(stable(resource.spec)) !== JSON.stringify(stable(saved.spec))) {
    throw new Error('Policy is not the exact resource prepared by this action');
  }
}

export async function prepareAction(action: Action, deps: Dependencies): Promise<Before> {
  namespace(action.namespace);
  switch (action.type) {
    case 'toxiproxy': {
      const { proxy, serviceUid } = await proxyFor(action, deps);
      const enabled = proxyEnabled(proxy);
      const upstream = string(proxy.upstream, 'proxy upstream');
      const existing = toxics(proxy);
      if (!enabled) throw new Error('Toxiproxy proxy must be enabled before injection');
      if (action.mode === 'latency') {
        integer(action.latencyMs, 'latencyMs', 1);
        const toxicName = `nexo-chaos-${randomUUID()}`;
        return { type: 'toxiproxy', enabled, upstream, serviceUid, toxics: existing, toxicName };
      }
      return { type: 'toxiproxy', enabled, upstream, serviceUid, toxics: existing };
    }
    case 'scale': {
      if (!['deployment', 'statefulset'].includes(action.kind) || action.replicas !== 0) throw new Error('Only scale-to-zero is supported');
      const current = await get(deps, action.namespace, action.kind, action.name);
      requireReady(current);
      const replicas = integer(object(current.spec, 'spec').replicas, 'replicas', 1);
      return { type: 'scale', uid: uid(current), replicas };
    }
    case 'networkPolicy': {
      name(action.name, 'policy');
      const entries = Object.entries(action.podSelector);
      if (entries.length === 0 || entries.some(([key, value]) => !/^[\w./-]+$/.test(key) || !/^[\w.-]+$/.test(value))) {
        throw new Error('A safe nonempty pod selector is required');
      }
      integer(action.port, 'port', 1);
      if (action.port > 65535) throw new Error('Invalid port');
      const existing = await policies(action, deps);
      if (existing.length !== 0) throw new Error('Existing policies could override the injected egress isolation');
      const pods = json(await kubectl(deps, action.namespace, ['get', 'pods', '-l', entries.map(([k, v]) => `${k}=${v}`).join(','), '-o', 'json']), 'pods').items;
      if (!Array.isArray(pods) || pods.length !== 1 || object(object(pods[0], 'pod').status, 'pod status').phase !== 'Running') {
        throw new Error('Network policy requires exactly one running target pod');
      }
      return { type: 'networkPolicy', absent: true, token: randomUUID(), spec: policySpec(action) };
    }
    case 'stress': {
      if (!/^(chaos|stress)[-a-z0-9]*$/.test(action.container)) throw new Error('Stress must run in an auxiliary chaos/stress container');
      integer(action.workers, 'workers', 1);
      const { pod, uid: podUid } = await podFor(deps, action);
      await kubectl(deps, action.namespace, ['exec', pod, '-c', action.container, '--', 'sh', '-c',
        'command -v stress-ng >/dev/null && command -v tr >/dev/null && command -v grep >/dev/null', 'sh']);
      return { type: 'stress', pod, uid: podUid, token: randomUUID() };
    }
    case 'cpuLimit': {
      const deployment = await get(deps, action.namespace, 'deployment', action.deployment);
      requireReady(deployment);
      if (!/^(?:[1-9]\d*m|(?:[1-9]\d*)(?:\.\d{1,3})?)$/.test(action.limit)) throw new Error('Invalid positive CPU quantity');
      const { index, resources } = cpuContainer(deployment, action.container);
      const limits = resources.limits === undefined ? {} : object(resources.limits, 'limits');
      const applied = { ...resources, limits: { ...limits, cpu: action.limit } };
      const list = object(object(object(deployment.spec, 'spec').template, 'template').spec, 'pod spec').containers as unknown[];
      const hadResources = Object.hasOwn(object(list[index], 'container'), 'resources');
      return { type: 'cpuLimit', uid: uid(deployment), containerIndex: index, resources, applied, hadResources };
    }
  }
}

export async function applyAction(action: Action, before: unknown, deps: Dependencies): Promise<void> {
  namespace(action.namespace);
  switch (action.type) {
    case 'toxiproxy': {
      const saved = beforeOf(before, 'toxiproxy');
      const { base, proxy, serviceUid } = await proxyFor(action, deps);
      if (serviceUid !== saved.serviceUid) throw new Error('Toxiproxy service was replaced');
      if (string(proxy.upstream, 'proxy upstream') !== saved.upstream) throw new Error('Toxiproxy upstream changed after prepare');
      const current = toxics(proxy);
      const path = proxyPath(action.proxy);
      if (action.mode === 'disable') {
        if (JSON.stringify(stable(current)) !== JSON.stringify(stable(saved.toxics))) throw new Error('Toxics changed after prepare');
        if (proxyEnabled(proxy)) await api(deps, base, path, 'POST', { enabled: false });
      } else {
        const toxicName = name(string(saved.toxicName, 'saved toxic name'), 'toxic name');
        const injected = current.find((toxic) => toxic.name === toxicName);
        if (injected) {
          if (!matchesToxic(injected, action, toxicName)) throw new Error('Injected toxic was changed');
          return;
        }
        if (!proxyEnabled(proxy) || JSON.stringify(stable(current)) !== JSON.stringify(stable(saved.toxics))) {
          throw new Error('Toxiproxy state changed after prepare');
        }
        await api(deps, base, `${path}/toxics`, 'POST', toxicDefinition(action, toxicName));
      }
      return;
    }
    case 'scale': {
      const saved = beforeOf(before, 'scale');
      const current = await get(deps, action.namespace, action.kind, action.name);
      assertUid(current, saved.uid);
      const replicas = object(current.spec, 'spec').replicas;
      if (replicas === 0) return;
      if (replicas !== saved.replicas) throw new Error('Replica count changed after prepare');
      requireReady(current);
      await kubectl(deps, action.namespace, ['scale', `${action.kind}/${name(action.name, 'workload')}`, '--replicas=0', `--current-replicas=${integer(saved.replicas, 'saved replicas', 1)}`]);
      return;
    }
    case 'networkPolicy': {
      const saved = beforeOf(before, 'networkPolicy');
      if (saved.absent !== true || JSON.stringify(stable(saved.spec)) !== JSON.stringify(stable(policySpec(action)))) {
        throw new Error('Network policy snapshot does not match this action');
      }
      const existing = await policies(action, deps);
      if (existing.length) {
        const current = existing[0];
        if (existing.length !== 1 || !current || object(current.metadata, 'policy metadata').name !== action.name) {
          throw new Error('An existing policy could override the injected isolation');
        }
        ownedPolicy(current, saved);
        return;
      }
      const manifest = {
        apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
        metadata: { name: action.name, namespace: action.namespace, annotations: { 'nexo.dev/chaos-token': saved.token } },
        spec: saved.spec,
      };
      const created = json(await kubectl(deps, action.namespace, ['create', '-f', '-', '-o', 'json'], JSON.stringify(manifest)), 'created policy');
      ownedPolicy(created, saved);
      return;
    }
    case 'stress': {
      const saved = beforeOf(before, 'stress');
      const pod = await get(deps, action.namespace, 'pod', saved.pod);
      assertUid(pod, saved.uid);
      const token = tokenOf(saved.token);
      const matches = await kubectl(deps, action.namespace, ['exec', saved.pod, '-c', action.container, '--', 'sh', '-c', stressFind, 'sh', token]);
      if (matches.trim()) return;
      await kubectl(deps, action.namespace, ['exec', saved.pod, '-c', action.container, '--', 'sh', '-c', stressStart, 'sh', token, String(integer(action.workers, 'workers', 1))]);
      return;
    }
    case 'cpuLimit': {
      const saved = beforeOf(before, 'cpuLimit');
      const deployment = await get(deps, action.namespace, 'deployment', action.deployment);
      assertUid(deployment, saved.uid);
      const current = cpuContainer(deployment, action.container);
      if (current.index !== saved.containerIndex) throw new Error('Container index changed after prepare');
      if (sameResources(current.resources, object(saved.applied, 'applied resources'))) return;
      const list = object(object(object(deployment.spec, 'spec').template, 'template').spec, 'pod spec').containers as unknown[];
      if (JSON.stringify(stable(current.resources)) !== JSON.stringify(stable(saved.resources)) ||
          Object.hasOwn(object(list[current.index], 'container'), 'resources') !== saved.hadResources) {
        throw new Error('Container resources changed after prepare');
      }
      requireReady(deployment);
      const patch = [
        { op: 'test', path: '/metadata/uid', value: saved.uid },
        { op: 'test', path: '/metadata/resourceVersion', value: string(object(deployment.metadata, 'metadata').resourceVersion, 'resourceVersion') },
        { op: 'test', path: `/spec/template/spec/containers/${current.index}/name`, value: action.container },
        { op: saved.hadResources ? 'replace' : 'add', path: `/spec/template/spec/containers/${current.index}/resources`, value: saved.applied },
      ];
      await kubectl(deps, action.namespace, ['patch', 'deployment', name(action.deployment, 'deployment'), '--type=json', '-p', JSON.stringify(patch)]);
      return;
    }
  }
}

export async function restoreAction(action: Action, before: unknown, deps: Dependencies): Promise<void> {
  namespace(action.namespace);
  switch (action.type) {
    case 'toxiproxy': {
      const saved = beforeOf(before, 'toxiproxy');
      const { base, proxy: current, serviceUid } = await proxyFor(action, deps);
      if (serviceUid !== saved.serviceUid) throw new Error('Toxiproxy service was replaced');
      const path = proxyPath(action.proxy);
      if (string(current.upstream, 'proxy upstream') !== saved.upstream) {
        throw new Error('Proxy upstream changed since injection; refusing to restore another target');
      }
      const currentToxics = toxics(current);
      const injected = saved.toxicName ? currentToxics.find((toxic) => toxic.name === saved.toxicName) : undefined;
      if (injected && (!matchesToxic(injected, action, saved.toxicName!) || action.mode !== 'latency')) {
        throw new Error('Injected toxic changed; refusing to delete');
      }
      const original = injected ? currentToxics.filter((toxic) => toxic !== injected) : currentToxics;
      if (JSON.stringify(stable(original)) !== JSON.stringify(stable(saved.toxics))) {
        throw new Error('Other Toxiproxy toxics changed since preparation');
      }
      if (injected && saved.toxicName) {
        const response = await deps.fetch(new URL(`${path}/toxics/${encodeURIComponent(saved.toxicName)}`, base), { method: 'DELETE' });
        if (!response.ok && response.status !== 404) {
          throw new Error(`Toxiproxy toxic removal failed (${response.status})`);
        }
      }
      if (proxyEnabled(current) !== saved.enabled) {
        await api(deps, base, path, 'POST', { enabled: saved.enabled });
      }
      return;
    }
    case 'scale': {
      const saved = beforeOf(before, 'scale');
      const resource = action.kind;
      const current = await get(deps, action.namespace, resource, action.name);
      assertUid(current, saved.uid);
      if (object(current.spec, 'spec').replicas === saved.replicas) return;
      if (object(current.spec, 'spec').replicas !== 0) throw new Error('Replica count changed since injection');
      await kubectl(deps, action.namespace, ['scale', `${resource}/${name(action.name, 'workload')}`, `--replicas=${integer(saved.replicas, 'saved replicas', 1)}`, '--current-replicas=0']);
      return;
    }
    case 'networkPolicy': {
      const saved = beforeOf(before, 'networkPolicy');
      if (saved.absent !== true) throw new Error('Cannot restore a policy without an absent-before snapshot');
      const existing = await policies(action, deps);
      const current = existing.find((policy) => object(policy.metadata, 'policy metadata').name === action.name);
      if (!current) return;
      ownedPolicy(current, saved);
      await kubectl(deps, action.namespace, ['delete', 'networkpolicy', name(action.name, 'policy'), '--wait=true']);
      return;
    }
    case 'stress': {
      const saved = beforeOf(before, 'stress');
      const items = json(await kubectl(deps, action.namespace, ['get', 'pods', '-o', 'json']), 'pods').items;
      if (!Array.isArray(items)) throw new Error('Invalid pod list');
      const pod = items.map((item: unknown) => object(item, 'pod')).find((item) => object(item.metadata, 'pod metadata').name === saved.pod);
      if (!pod || uid(pod) !== saved.uid) return;
      await kubectl(deps, action.namespace, ['exec', name(saved.pod, 'pod'), '-c', name(action.container, 'container'), '--', 'sh', '-c', stressStop, 'sh', tokenOf(saved.token)]);
      return;
    }
    case 'cpuLimit': {
      const saved = beforeOf(before, 'cpuLimit');
      const current = await get(deps, action.namespace, 'deployment', action.deployment);
      assertUid(current, saved.uid);
      const container = cpuContainer(current, action.container);
      if (container.index !== saved.containerIndex) throw new Error('Container index changed');
      const list = object(object(object(current.spec, 'spec').template, 'template').spec, 'pod spec').containers as unknown[];
      if (JSON.stringify(stable(container.resources)) === JSON.stringify(stable(saved.resources)) &&
          Object.hasOwn(object(list[container.index], 'container'), 'resources') === saved.hadResources) return;
      if (!sameResources(container.resources, object(saved.applied, 'applied resources'))) {
        throw new Error('Container resources changed since injection; refusing to overwrite');
      }
      const path = `/spec/template/spec/containers/${container.index}/resources`;
      const patch: RecordValue[] = [
        { op: 'test', path: '/metadata/uid', value: saved.uid },
        { op: 'test', path: '/metadata/resourceVersion', value: string(object(current.metadata, 'metadata').resourceVersion, 'resourceVersion') },
        { op: 'test', path: `/spec/template/spec/containers/${container.index}/name`, value: action.container },
        { op: 'test', path, value: container.resources },
        saved.hadResources ? { op: 'replace', path, value: object(saved.resources, 'saved resources') } : { op: 'remove', path },
      ];
      await kubectl(deps, action.namespace, ['patch', 'deployment', name(action.deployment, 'deployment'), '--type=json', '-p', JSON.stringify(patch)]);
      return;
    }
  }
}
