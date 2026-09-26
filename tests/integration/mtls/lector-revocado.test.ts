import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request } from 'node:https';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor } from '../../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { dockerDisponible, EVENTO, iniciarD1, solicitud } from '../coordinator/entorno.ts';
import type { EntornoD1 } from '../coordinator/entorno.ts';
import type { FastifyInstance } from 'fastify';

const raiz = resolve(import.meta.dirname, '..', '..', '..');
const nombreAlmacen = `mtls-e2e-${randomUUID()}`;
const almacenCerts = join(raiz, 'deploy', 'certs', 'private', nombreAlmacen);
const lectorValido = 'LX-2210-0107';
const lectorRevocado = 'LX-2210-0114';

function certificado(...segmentos: string[]) {
  return readFileSync(join(almacenCerts, ...segmentos));
}

function ejecutarCerts(comando: string, ...args: string[]) {
  execFileSync(process.execPath, [join(raiz, 'scripts', 'certs.mjs'), comando, ...args, '--store', nombreAlmacen], {
    cwd: raiz, stdio: 'pipe',
  });
}

function enviar(port: number, ruta: string, body: unknown, lectorId?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const credencial = lectorId ? {
      cert: certificado('readers', lectorId, 'tls.crt'),
      key: certificado('readers', lectorId, 'tls.key'),
    } : {};
    const req = request({
      hostname: 'localhost', port, path: ruta, method: 'POST',
      ca: certificado('ca.crt'), ...credencial,
      rejectUnauthorized: true,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
    }, (res) => {
      let respuesta = '';
      res.setEncoding('utf8');
      res.on('data', (parte: string) => { respuesta += parte; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(respuesta) as Record<string, unknown> }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(data);
  });
}

describe.skipIf(!dockerDisponible)('mTLS C1-C2 con D1 real (PB-14)', () => {
  let entorno: EntornoD1;
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    ejecutarCerts('init');
    ejecutarCerts('issue-server', '--dns', 'localhost', '--ip', '127.0.0.1');
    ejecutarCerts('issue-reader', '--reader-id', lectorValido);
    ejecutarCerts('issue-reader', '--reader-id', lectorRevocado);
    entorno = await iniciarD1();
    await entorno.pool.query(
      `INSERT INTO lector (evento_id, lector_id, punto_id) VALUES ($1, $2, 'P-01'), ($1, $3, 'P-01')`,
      [EVENTO, lectorValido, lectorRevocado],
    );
    const config = cargarConfig({
      EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-MTLS',
      COORDINATOR_TLS: 'true',
      COORDINATOR_TLS_CERT_FILE: join(almacenCerts, 'coordinator', 'tls.crt'),
      COORDINATOR_TLS_KEY_FILE: join(almacenCerts, 'coordinator', 'tls.key'),
      COORDINATOR_TLS_CA_FILE: join(almacenCerts, 'ca.crt'),
      COORDINATOR_TLS_REVOKED_FILE: join(almacenCerts, 'revoked.json'),
    });
    const reloj = { ahora: () => new Date() };
    const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
      unidades: entorno.almacen.unidades,
      alcance: entorno.almacen.alcance,
      autoridad: new AutoridadNodoUnico(config.coordinadorId),
      reloj,
    }), new ContadorV1(), config, reloj);
    app = crearServidor({ servicio, almacen: entorno.almacen, latidos: new RegistroLatidos(), config, reloj });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const direccion = app.server.address();
    if (!direccion || typeof direccion === 'string') throw new Error('No se pudo obtener el puerto TLS de C2');
    port = direccion.port;
  });

  afterAll(async () => {
    await app?.close();
    await entorno?.cerrar();
    await rm(almacenCerts, { recursive: true, force: true });
  });

  it('autentica al lector vigente y bloquea al revocado antes de consultar la boleta o consumirla', async () => {
    const autorizado = solicitud('TA-8801-0001', { lectorId: lectorValido });
    const aceptado = await enviar(port, '/v1/validaciones', {
      ...autorizado, instanteLector: autorizado.instanteLector.toISOString(),
    }, lectorValido);
    expect(aceptado.status).toBe(200);
    expect(aceptado.body).toMatchObject({ decision: 'aceptado', admision: true });

    ejecutarCerts('revoke', '--reader-id', lectorRevocado, '--reason', 'lost');
    const bloqueado = solicitud('TA-8801-0002', { lectorId: lectorRevocado });
    const denegado = await enviar(port, '/v1/validaciones', {
      ...bloqueado, instanteLector: bloqueado.instanteLector.toISOString(),
    }, lectorRevocado);
    expect(denegado.status).toBe(403);
    expect(denegado.body).toMatchObject({ error: 'NO_AUTORIZADO' });
    const intentos = await entorno.pool.query('SELECT 1 FROM intento WHERE id_origen = $1', [bloqueado.idOrigen]);
    const consumos = await entorno.pool.query('SELECT 1 FROM consumo WHERE id_origen = $1', [bloqueado.idOrigen]);
    expect(intentos.rowCount).toBe(0);
    expect(consumos.rowCount).toBe(0);
  });

  it('no acepta identidad declarada por otro lector en V1 ni H1', async () => {
    const solicitudAjena = solicitud('TA-8801-0003', { lectorId: lectorRevocado });
    const respuesta = await enviar(port, '/v1/validaciones', {
      ...solicitudAjena, instanteLector: solicitudAjena.instanteLector.toISOString(),
    }, lectorValido);
    expect(respuesta.status).toBe(403);
    expect((await entorno.pool.query('SELECT 1 FROM intento WHERE id_origen = $1', [solicitudAjena.idOrigen])).rowCount).toBe(0);

    const latido = await enviar(port, '/v1/heartbeats', {
      lectorId: lectorRevocado, puntoId: 'P-01', eventoId: EVENTO, instanteLector: new Date().toISOString(),
      secuencia: 1, estadoLector: 'operativo', pendientesDiario: 0, diarioTotal: 0, versionPermisos: 37,
    }, lectorValido);
    expect(latido.status).toBe(403);
  });

  it('rechaza la conexión sin certificado de cliente', async () => {
    const s = solicitud('TA-8801-0004', { lectorId: lectorValido });
    await expect(enviar(port, '/v1/validaciones', {
      ...s, instanteLector: s.instanteLector.toISOString(),
    })).rejects.toThrow();
    expect((await entorno.pool.query('SELECT 1 FROM intento WHERE id_origen = $1', [s.idOrigen])).rowCount).toBe(0);
  });
});
