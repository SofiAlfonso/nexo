import { z } from 'zod';

const target = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use a concrete DNS-style target, not a wildcard',
  );

const scopeTarget = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/, 'Use a concrete scope identifier, not a wildcard');

const selectorKey = z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/);
const selectorValue = z.string().min(1).max(63).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);

const namespace = z.enum([
  'nexo-venue',
  'nexo-central',
  'nexo-external',
  'nexo-observability',
  'nexo-chaos',
]);

const ipv4Cidr = z.string().refine((value) => {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(value);
  return match !== null &&
    match.slice(1, 5).every((octet) => Number(octet) <= 255) &&
    Number(match[5]) >= 1 &&
    Number(match[5]) <= 32;
}, 'Use a specific IPv4 CIDR, not a wildcard or the entire internet');

const cpuLimit = z.string()
  .regex(/^(?:[1-9]\d{0,2}m|1000m|1)$/, 'Use a positive CPU limit no greater than one core');

const actionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('toxiproxy'),
    namespace,
    service: target,
    proxy: target,
    mode: z.enum(['disable', 'latency']),
    latencyMs: z.number().int().min(1).max(10_000).optional(),
  }).superRefine((action, context) => {
    if ((action.mode === 'latency') !== (action.latencyMs !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['latencyMs'],
        message: 'latencyMs is required for latency and forbidden for disable',
      });
    }
  }),
  z.strictObject({
    type: z.literal('scale'),
    namespace,
    kind: z.enum(['deployment', 'statefulset']),
    name: target,
    replicas: z.literal(0),
  }),
  z.strictObject({
    type: z.literal('networkPolicy'),
    namespace,
    name: target,
    podSelector: z.record(selectorKey, selectorValue).refine((selector) => Object.keys(selector).length > 0, 'Select specific pods'),
    targetIpBlock: ipv4Cidr,
    port: z.number().int().min(1).max(65_535),
  }),
  z.strictObject({
    type: z.literal('stress'),
    namespace,
    deployment: target,
    container: target,
    workers: z.number().int().min(1).max(32),
  }),
  z.strictObject({
    type: z.literal('cpuLimit'),
    namespace,
    deployment: target,
    container: target,
    limit: cpuLimit,
  }),
]);

export const experimentSchema = z.strictObject({
  version: z.literal(1),
  id: target,
  environment: z.literal('minikube'),
  owner: scopeTarget,
  durationSeconds: z.number().int().min(1).max(900),
  scope: z.strictObject({
    event: scopeTarget,
    gate: scopeTarget,
    instance: scopeTarget,
    synthetic: z.literal(true),
  }),
  actions: z.array(actionSchema).min(1).max(5),
});

export type Experiment = z.infer<typeof experimentSchema>;
export type Action = Experiment['actions'][number];
