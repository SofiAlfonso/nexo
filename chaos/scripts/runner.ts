import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { applyAction, prepareAction, restoreAction } from './actions.ts';
import type { Dependencies } from './actions.ts';
import { experimentSchema } from './schema.ts';
import type { Action, Experiment } from './schema.ts';

type Step = { action: Action; before: unknown; restored: boolean };
export type RunRecord = {
  id: string;
  experiment: string;
  operator: string;
  environment: string;
  scope: Experiment['scope'];
  startedAt: string;
  expiresAt: string;
  finishedAt?: string;
  status: 'active' | 'restored' | 'unrecovered';
  dryRun: boolean;
  steps: Step[];
  error?: string;
};

export type RunnerOptions = {
  evidenceDir: string;
  dependencies: Dependencies;
  now?: () => number;
  watchdog?: (id: string, evidenceDir: string) => void;
};

const allowedNamespaces = new Set(['nexo-venue', 'nexo-central', 'nexo-chaos', 'nexo-observability']);

export class ChaosRunner {
  private readonly evidenceDir: string;
  private readonly dependencies: Dependencies;
  private readonly now: () => number;
  private readonly watchdog?: (id: string, evidenceDir: string) => void;

  constructor(options: RunnerOptions) {
    this.evidenceDir = resolve(options.evidenceDir);
    this.dependencies = options.dependencies;
    this.now = options.now ?? Date.now;
    this.watchdog = options.watchdog;
  }

  async validate(file: string): Promise<Experiment> {
    const experiment = experimentSchema.parse(YAML.parse(await readFile(file, 'utf8')));
    for (const action of experiment.actions) {
      if (!allowedNamespaces.has(action.namespace)) {
        throw new Error(`Namespace fuera del laboratorio: ${action.namespace}`);
      }
    }
    return experiment;
  }

  async plan(file: string): Promise<Experiment> {
    const experiment = await this.validate(file);
    await mkdir(this.evidenceDir, { recursive: true });
    await this.recoverExpired();
    await this.assertIdle();
    const digest = await this.digest(file);
    await this.save(join(this.evidenceDir, '.plan.json'), {
      digest, file: resolve(file), createdAt: new Date(this.now()).toISOString(),
    });
    return experiment;
  }

  async run(file: string, options: { confirm: boolean; dryRun?: boolean }): Promise<RunRecord> {
    if (!options.confirm) throw new Error('Se requiere run --confirm.');
    const experiment = await this.validate(file);
    const plan = await this.readJson<{ digest: string; file: string }>(join(this.evidenceDir, '.plan.json'));
    if (!plan || plan.file !== resolve(file) || plan.digest !== await this.digest(file)) {
      throw new Error('Ejecute plan sobre esta versión del experimento antes de run.');
    }
    await this.recoverExpired();
    if (!options.dryRun) {
      const context = (await this.dependencies.exec('kubectl', ['config', 'current-context'])).trim();
      if (context !== 'minikube') throw new Error(`Contexto Kubernetes no permitido: ${context}`);
    }
    const id = randomUUID();
    const lock = join(this.evidenceDir, '.active.json');
    const handle = await open(lock, 'wx').catch((error: unknown) => {
      if (isNodeError(error, 'EEXIST')) throw new Error('Ya hay un experimento activo o no recuperado.', { cause: error });
      throw error;
    });
    try {
      await handle.writeFile(JSON.stringify({ id }));
    } finally {
      await handle.close();
    }
    const started = this.now();
    const record: RunRecord = {
      id, experiment: experiment.id, operator: experiment.owner,
      environment: experiment.environment, scope: experiment.scope,
      startedAt: new Date(started).toISOString(),
      expiresAt: new Date(started + experiment.durationSeconds * 1000).toISOString(),
      status: 'active', dryRun: options.dryRun ?? false, steps: [],
    };
    try {
      await this.persist(record);
      if (record.dryRun) return record;
      if (!this.watchdog) throw new Error('No hay watchdog disponible para restauración automática.');
      this.watchdog(id, this.evidenceDir);
      for (const action of experiment.actions) {
        const before = await prepareAction(action, this.dependencies);
        record.steps.push({ action, before, restored: false });
        await this.persist(record);
        await applyAction(action, before, this.dependencies);
      }
      return record;
    } catch (error) {
      record.error = message(error);
      await this.persist(record);
      try {
        await this.restore(id);
      } catch (restoreError) {
        throw new Error(`Falló la inyección (${record.error}) y la reversión (${message(restoreError)}).`);
      }
      throw error;
    }
  }

  async status(): Promise<RunRecord | null> {
    await this.recoverExpired();
    const lock = await this.readJson<{ id: string }>(join(this.evidenceDir, '.active.json'));
    return lock ? this.load(lock.id) : null;
  }

  async abort(): Promise<RunRecord> {
    return this.restore();
  }

  async restore(id?: string): Promise<RunRecord> {
    const lockPath = join(this.evidenceDir, '.active.json');
    const lock = await this.readJson<{ id: string }>(lockPath);
    if (!lock) throw new Error('No hay experimento activo que restaurar.');
    if (id && lock.id !== id) throw new Error('La ejecución activa no coincide con el identificador solicitado.');
    const restoreLock = join(this.evidenceDir, '.restoring.json');
    let claim;
    try {
      claim = await open(restoreLock, 'wx');
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error;
      const previous = await this.readJson<{ pid: number }>(restoreLock);
      if (!previous || isAlive(previous.pid)) throw new Error('Ya hay una reversión en curso.');
      await rm(restoreLock);
      claim = await open(restoreLock, 'wx');
    }
    try {
      await claim.writeFile(JSON.stringify({ pid: process.pid }));
    } finally {
      await claim.close();
    }
    try {
      return await this.restoreClaimed(lock.id, lockPath);
    } finally {
      await rm(restoreLock);
    }
  }

  private async restoreClaimed(id: string, lockPath: string): Promise<RunRecord> {
    const record = await this.load(id);
    for (const step of [...record.steps].reverse()) {
      if (step.restored) continue;
      try {
        if (!record.dryRun) await restoreAction(step.action, step.before, this.dependencies);
        step.restored = true;
        await this.persist(record);
      } catch (error) {
        record.status = 'unrecovered';
        record.error = `Falló la reversión: ${message(error)}`;
        await this.persist(record);
        throw new Error(record.error, { cause: error });
      }
    }
    record.status = 'restored';
    record.finishedAt = new Date(this.now()).toISOString();
    await this.persist(record);
    const current = await this.readJson<{ id: string }>(lockPath);
    if (current?.id === record.id) await rm(lockPath);
    return record;
  }

  async history(): Promise<RunRecord[]> {
    await mkdir(this.evidenceDir, { recursive: true });
    const files = (await readdir(this.evidenceDir)).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name));
    return Promise.all(files.map(async (name) => this.readJson<RunRecord>(join(this.evidenceDir, name))
      .then((record) => {
        if (!record) throw new Error(`Registro ausente: ${name}`);
        return record;
      })));
  }

  private async recoverExpired(): Promise<void> {
    const lock = await this.readJson<{ id: string }>(join(this.evidenceDir, '.active.json'));
    if (!lock) return;
    const record = await this.load(lock.id);
    if (record.status === 'unrecovered') throw new Error(`Experimento ${record.id} no recuperado: restaure antes de continuar.`);
    if (record.status === 'active' && this.now() >= Date.parse(record.expiresAt)) await this.restore(lock.id);
  }

  private async assertIdle(): Promise<void> {
    if (await this.readJson(join(this.evidenceDir, '.active.json'))) {
      throw new Error('Ya hay un experimento activo o no recuperado.');
    }
  }

  private async load(id: string): Promise<RunRecord> {
    const record = await this.readJson<RunRecord>(join(this.evidenceDir, `${id}.json`));
    if (!record || record.id !== id) throw new Error(`No se encuentra el registro de ejecución ${id}; bloqueo conservado.`);
    return record;
  }

  private async persist(record: RunRecord): Promise<void> {
    await this.save(join(this.evidenceDir, `${record.id}.json`), record);
  }

  private async save(path: string, value: unknown): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
    await rename(temporary, path);
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T;
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async digest(file: string): Promise<string> {
    return createHash('sha256').update(await readFile(file)).digest('hex');
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ESRCH')) return false;
    throw error;
  }
}
