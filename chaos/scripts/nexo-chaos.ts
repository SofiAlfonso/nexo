#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ChaosRunner } from './runner.ts';
import type { Dependencies } from './actions.ts';

const script = fileURLToPath(import.meta.url);
const evidenceDir = resolve(dirname(script), '..', 'evidence');

const dependencies: Dependencies = {
  fetch: globalThis.fetch,
  exec(command, args, input) {
    return new Promise((resolveOutput, reject) => {
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let output = '';
      let errorOutput = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errorOutput += chunk; });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolveOutput(output);
        else reject(new Error(`${command} ${args.join(' ')} terminó con código ${code}: ${errorOutput}`));
      });
      child.stdin.end(input);
    });
  },
};

const runner = new ChaosRunner({
  evidenceDir,
  dependencies,
  watchdog(id, directory) {
    const child = spawn(process.execPath, [script, '__watchdog', id, directory], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    if (!child.pid) throw new Error('No se pudo iniciar el watchdog de reversión.');
    child.unref();
  },
});

async function main(args: string[]): Promise<void> {
  const [command, file, ...flags] = args;
  if (command === '__watchdog') {
    if (!file || !flags[0]) throw new Error('Identificador de watchdog ausente.');
    const watchdogRunner = new ChaosRunner({ evidenceDir: flags[0], dependencies });
    const active = await watchdogRunner.status();
    if (!active || active.id !== file || active.dryRun) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, Date.parse(active.expiresAt) - Date.now())));
    await watchdogRunner.restore(file);
    return;
  }
  if (command === 'validate' || command === 'plan') {
    if (!file || flags.length) throw new Error(`Uso: nexo-chaos ${command} <archivo.yaml>`);
    console.log(JSON.stringify(command === 'plan' ? await runner.plan(file) : await runner.validate(file), null, 2));
    return;
  }
  if (command === 'run') {
    if (!file || !flags.includes('--confirm') || flags.some((flag) => !['--confirm', '--dry-run'].includes(flag))) {
      throw new Error('Uso: nexo-chaos run <archivo.yaml> --confirm [--dry-run]');
    }
    console.log(JSON.stringify(await runner.run(file, { confirm: true, dryRun: flags.includes('--dry-run') }), null, 2));
    return;
  }
  if (command === 'status' || command === 'abort' || command === 'restore') {
    if (file || flags.length) throw new Error(`Uso: nexo-chaos ${command}`);
    const result = command === 'status' ? await runner.status() : command === 'abort' ? await runner.abort() : await runner.restore();
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  throw new Error('Uso: nexo-chaos validate|plan|run --confirm|status|abort|restore');
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
