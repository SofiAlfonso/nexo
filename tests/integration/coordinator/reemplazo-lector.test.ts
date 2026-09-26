import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request } from 'node:https';
import { join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import { ReemplazarLector } from '../../../src/local-coordinator/application/reemplazo-lector.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor } from '../../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { RevocadorCertsMjs } from '../../../src/local-coordinator/infrastructure/credenciales/revocador-certs.ts';
import { RepositorioAsignacionesPg } from '../../../src/local-coordinator/infrastructure/persistence/postgres/asignaciones-postgres.ts';
import { dockerDisponible, EVENTO, iniciarD1, solicitud } from '../coordinator/entorno.ts';
import type { EntornoD1 } from '../coordinator/entorno.ts';

const raiz = resolve(import.meta.dirname, '..', '..', '..');
const script = join(raiz, 'scripts', 'certs.mjs');
const nombreAlmacen = `reemplazo-${randomUUID()}`;
const almacenCerts = join(raiz, 'deploy', 'certs', 'private', nombreAlmacen);
const revokedPath = join(almacenCerts, 'revoked.json');
const reloj = { ahora: () => new Date() };

function certs(...args: string[]): string {
  return execFileSync(process.execPath, [script, ...args, '--store', nombreAlmacen], { cwd: raiz, encoding: 'utf8' });
}

function validar(port: number, lectorId: string, codigo: string, puntoId = 'P-01'): Promise<{ status: number; body: Record<string, unknown> }> {
  const s = solicitud(codigo, { lectorId, puntoId });
  const data = JSON.stringify({ ...s, instanteLector: s.instanteLector.toISOString() });
  return new Promise((res, rej) => {
    const req = request({
      hostname: 'localhost', port, path: '/v1/validaciones', method: 'POST', rejectUnauthorized: true,
      ca: readFileSync(join(almacenCerts, 'ca.crt')),
      cert: readFileSync(join(almacenCerts, 'readers', lectorId, 'tls.crt')),
      key: readFileSync(join(almacenCerts, 'readers', lectorId, 'tls.key')),
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (r) => {
      let cuerpo = '';
      r.setEncoding('utf8');
      r.on('data', (p: string) => { cuerpo += p; });
      r.on('end', () => res({ status: r.statusCode ?? 0, body: JSON.parse(cuerpo) as Record<string, unknown> }));
    });
    req.on('error', rej);
    req.end(data);
  });
}

describe.skipIf(!dockerDisponible)('PU-05-02 reemplazo de lector con D1 real, mTLS y certs.mjs revoke', () => {
  let entorno: EntornoD1;
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    certs('init');
    certs('issue-server', '--dns', 'localhost', '--ip', '127.0.0.1');
    for (const lector of ['LX-2210-107', 'LX-2210-200', 'LX-2210-120', 'LX-2210-300']) certs('issue-reader', '--reader-id', lector);
    entorno = await iniciarD1();
    const config = cargarConfig({
      EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-REEMPLAZO', COORDINATOR_TLS: 'true',
      COORDINATOR_TLS_CERT_FILE: join(almacenCerts, 'coordinator', 'tls.crt'),
      COORDINATOR_TLS_KEY_FILE: join(almacenCerts, 'coordinator', 'tls.key'),
      COORDINATOR_TLS_CA_FILE: join(almacenCerts, 'ca.crt'),
      COORDINATOR_TLS_REVOKED_FILE: revokedPath,
    });
    const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
      unidades: entorno.almacen.unidades, alcance: entorno.almacen.alcance,
      autoridad: new AutoridadNodoUnico(config.coordinadorId), reloj,
    }), new ContadorV1(), config, reloj);
    app = crearServidor({ servicio, almacen: entorno.almacen, latidos: new RegistroLatidos(), config, reloj });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const direccion = app.server.address();
    if (!direccion || typeof direccion === 'string') throw new Error('Sin puerto TLS');
    port = direccion.port;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await entorno?.cerrar();
    await rm(almacenCerts, { recursive: true, force: true });
  });

  it('cierra la asignación, asigna el nuevo lector y revoca la credencial anterior en revoked.json', async () => {
    expect((await validar(port, 'LX-2210-107', 'TA-8801-0010')).body).toMatchObject({ decision: 'aceptado' });
    const caso = new ReemplazarLector({
      asignaciones: new RepositorioAsignacionesPg(entorno.pool),
      revocador: new RevocadorCertsMjs({ revokedPath, certsScript: script, store: nombreAlmacen }),
      reloj,
    });
    const resultado = await caso.ejecutar({
      eventoId: EVENTO, puntoId: 'P-01', lectorAnterior: 'LX-2210-107', lectorNuevo: 'LX-2210-200', motivo: 'retired',
    });
    const estado = JSON.parse(certs('status', '--reader-id', 'LX-2210-107')) as Record<string, unknown>;
    expect(estado).toMatchObject({ revoked: true, reason: 'retired' });
    expect(resultado).toMatchObject({
      repetido: false,
      revocacion: { estado: 'revocada', credencial: {
        lectorId: 'LX-2210-107', serialNumber: estado.serialNumber, fingerprint256: estado.fingerprint256,
      } },
    });

    const { rows: lectores } = await entorno.pool.query(
      `SELECT lector_id, punto_id, habilitado, revocado FROM lector
       WHERE lector_id IN ('LX-2210-107', 'LX-2210-200') ORDER BY lector_id`,
    );
    expect(lectores).toEqual([
      { lector_id: 'LX-2210-107', punto_id: 'P-01', habilitado: false, revocado: true },
      { lector_id: 'LX-2210-200', punto_id: 'P-01', habilitado: true, revocado: false },
    ]);
    const { rows: registro } = await entorno.pool.query(
      `SELECT r.lector_anterior, r.lector_nuevo, s.lector_id AS solicitado, c.numero_serie
       FROM reemplazo_lector r JOIN solicitud_revocacion s ON s.reemplazo_id = r.id
       JOIN revocacion_credencial c ON c.solicitud_id = s.id`,
    );
    expect(registro).toEqual([{
      lector_anterior: 'LX-2210-107', lector_nuevo: 'LX-2210-200', solicitado: 'LX-2210-107', numero_serie: estado.serialNumber,
    }]);
    await expect(entorno.pool.query('DELETE FROM reemplazo_lector')).rejects.toThrow(/solo de adicion/);

    expect((await validar(port, 'LX-2210-107', 'TA-8801-0011')).status).toBe(403);
    expect((await validar(port, 'LX-2210-200', 'TA-8801-0012')).body).toMatchObject({ decision: 'aceptado', admision: true });
    expect(await caso.ejecutar({
      eventoId: EVENTO, puntoId: 'P-01', lectorAnterior: 'LX-2210-107', lectorNuevo: 'LX-2210-200', motivo: 'retired',
    })).toMatchObject({ repetido: true, revocacion: { estado: 'revocada' } });
  });

  it('sin la CA el lector anterior queda bloqueado por D1 y la revocación se completa después', async () => {
    const asignaciones = new RepositorioAsignacionesPg(entorno.pool);
    const sinCa = new ReemplazarLector({ asignaciones, revocador: new RevocadorCertsMjs({ revokedPath }), reloj });
    const resultado = await sinCa.ejecutar({
      eventoId: EVENTO, puntoId: 'P-03', lectorAnterior: 'LX-2210-120', lectorNuevo: 'LX-2210-300', motivo: 'lost',
    });
    expect(resultado.revocacion).toMatchObject({ estado: 'pendiente', error: expect.stringContaining('certs.mjs revoke') });
    const bloqueado = await validar(port, 'LX-2210-120', 'TA-8801-0013', 'P-03');
    expect(bloqueado.status).toBe(403);
    expect((await entorno.pool.query(
      "SELECT 1 FROM intento WHERE lector_id = 'LX-2210-120'",
    )).rowCount).toBe(0);
    expect(await asignaciones.revocacionesPendientes(EVENTO)).toMatchObject([{ lectorId: 'LX-2210-120', motivo: 'lost' }]);

    const conCa = new ReemplazarLector({
      asignaciones, revocador: new RevocadorCertsMjs({ revokedPath, certsScript: script, store: nombreAlmacen }), reloj,
    });
    expect(await conCa.revocarPendientes(EVENTO)).toMatchObject([{ lectorId: 'LX-2210-120', estado: 'revocada' }]);
    expect(await asignaciones.revocacionesPendientes(EVENTO)).toEqual([]);
    expect(JSON.parse(certs('status', '--reader-id', 'LX-2210-120'))).toMatchObject({ revoked: true, reason: 'lost' });
  });

  it('rechaza reutilizar una identidad revocada o reemplazar un lector sin asignación vigente', async () => {
    const caso = new ReemplazarLector({
      asignaciones: new RepositorioAsignacionesPg(entorno.pool), revocador: new RevocadorCertsMjs({ revokedPath }), reloj,
    });
    await expect(caso.ejecutar({
      eventoId: EVENTO, puntoId: 'P-01', lectorAnterior: 'LX-2210-200', lectorNuevo: 'LX-2210-107', motivo: 'retired',
    })).rejects.toThrow(/nunca se reutiliza/);
    await expect(caso.ejecutar({
      eventoId: EVENTO, puntoId: 'P-01', lectorAnterior: 'LX-2210-114', lectorNuevo: 'LX-2210-400', motivo: 'retired',
    })).rejects.toThrow(/asignación vigente/);
    const { rows } = await entorno.pool.query(
      "SELECT habilitado, revocado FROM lector WHERE lector_id = 'LX-2210-200'",
    );
    expect(rows).toEqual([{ habilitado: true, revocado: false }]);
  });
});
