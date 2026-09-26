import { randomBytes, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:https';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { opcionesTlsCoordinador, registrarAutenticacionLectores } from './tls.ts';

const raiz = resolve('deploy/certs/private');
const nombre = `tls-test-${randomBytes(8).toString('hex')}`;
const carpeta = join(raiz, nombre);
const certs = (...args: string[]) => execFileSync(process.execPath, ['scripts/certs.mjs', ...args, '--store', nombre], {
  stdio: 'pipe',
});

afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

describe('mTLS de C2', () => {
  it('exige credencial, identidad y revocación antes de mutar el estado', async () => {
    certs('init');
    certs('issue-server');
    certs('issue-reader', '--reader-id', 'L-1');
    const config = {
      certPath: join(carpeta, 'coordinator', 'tls.crt'),
      keyPath: join(carpeta, 'coordinator', 'tls.key'),
      caPath: join(carpeta, 'ca.crt'),
      revokedPath: join(carpeta, 'revoked.json'),
    };
    expect(opcionesTlsCoordinador(null)).toBeUndefined();
    expect(() => opcionesTlsCoordinador({ ...config, revokedPath: join(carpeta, 'missing.json') })).toThrow();
    const registro = JSON.parse(readFileSync(config.revokedPath, 'utf8')) as {
      version: number;
      issuerFingerprint256: string;
      revoked: unknown[];
    };
    writeFileSync(config.revokedPath, JSON.stringify({ ...registro, issuerFingerprint256: 'wrong-ca' }));
    expect(() => opcionesTlsCoordinador(config)).toThrow(/otra CA/);
    writeFileSync(config.revokedPath, JSON.stringify(registro));

    const app = Fastify({ https: opcionesTlsCoordinador(config)! });
    registrarAutenticacionLectores(app, config);
    let mutaciones = 0;
    for (const url of ['/v1/validaciones', '/v1/heartbeats', '/v1/diario/lotes']) {
      app.post(url, async () => { mutaciones++; return { ok: true }; });
    }
    try {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const puerto = (app.server.address() as { port: number }).port;
      const opciones = {
        ca: readFileSync(config.caPath),
        cert: readFileSync(join(carpeta, 'readers', 'L-1', 'tls.crt')),
        key: readFileSync(join(carpeta, 'readers', 'L-1', 'tls.key')),
      };
      const enviar = (url: string, lectorId: string, credenciales: Partial<typeof opciones> = opciones) =>
        new Promise<number>((ok, error) => {
          const req = request({
            hostname: '127.0.0.1', port: puerto, path: url, method: 'POST',
            ...credenciales, headers: { 'content-type': 'application/json' },
          }, (res) => {
            res.resume();
            res.on('end', () => ok(res.statusCode ?? 0));
          });
          req.on('error', error);
          req.end(JSON.stringify({ lectorId }));
        });
      await expect(enviar('/v1/validaciones', 'L-1', { ca: opciones.ca }))
        .rejects.toThrow();
      expect(await enviar('/v1/validaciones', 'L-2')).toBe(403);
      expect(await enviar('/v1/heartbeats', 'L-2')).toBe(403);
      expect(await enviar('/v1/diario/lotes', 'L-2')).toBe(403);
      expect(mutaciones).toBe(0);
      expect(await enviar('/v1/validaciones', 'L-1')).toBe(200);
      expect(mutaciones).toBe(1);

      certs('revoke', '--reader-id', 'L-1');
      expect(await enviar('/v1/validaciones', 'L-1')).toBe(403);
      expect(mutaciones).toBe(1);
      writeFileSync(config.revokedPath, '{"revokedSerials":"invalid"}');
      expect(await enviar('/v1/validaciones', 'L-1')).toBe(503);
      const huella = new X509Certificate(opciones.cert).fingerprint256.replaceAll(':', '').toLowerCase();
      writeFileSync(config.revokedPath, JSON.stringify({
        ...registro,
        revoked: [{
          readerId: 'L-1', serialNumber: 'A1', fingerprint256: huella,
          revokedAt: new Date().toISOString(), reason: 'lost',
        }],
      }));
      expect(await enviar('/v1/validaciones', 'L-1')).toBe(403);
      expect(mutaciones).toBe(1);
    } finally {
      await app.close();
    }
  }, 30_000);
});
