import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterAll, expect, it } from 'vitest';
import { SolicitudValidacion } from '@nexo/shared/contracts';
import { ClienteHttpCoordinador } from '../infrastructure/cliente-coordinador.ts';
import { cargarTls, validarTls } from './tls.ts';

const directorio = fileURLToPath(new URL('../.tls-test-generated/', import.meta.url));
const lectorIds = ['LX-2210-0107', 'LX-2210-0108'] as const;
let servidor: ReturnType<typeof Fastify> | undefined;
afterAll(async () => {
  await servidor?.close();
  await rm(directorio, { recursive: true, force: true });
});

function openssl(...args: string[]) {
  execFileSync('openssl', args, { cwd: directorio, stdio: 'ignore' });
}

async function certificados() {
  await mkdir(directorio, { recursive: true });
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key',
    '-out', 'ca.crt', '-days', '1', '-subj', '/CN=CA de prueba');
  await writeFile(join(directorio, 'servidor.ext'), 'subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
  for (const nombre of ['servidor', ...lectorIds]) {
    if (nombre !== 'servidor') {
      await writeFile(join(directorio, `${nombre}.ext`),
        `subjectAltName=URI:urn:nexo:reader:${nombre}\nextendedKeyUsage=clientAuth\n`);
    }
    openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${nombre}.key`,
      '-out', `${nombre}.csr`, '-subj', `/CN=${nombre}`);
    openssl('x509', '-req', '-in', `${nombre}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key',
      '-CAcreateserial', '-out', `${nombre}.crt`, '-days', '1',
      '-extfile', `${nombre}.ext`);
  }
  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'otra.key',
    '-out', 'otra.crt', '-days', '1', '-subj', '/CN=Otra CA');
}

it('exige TLS completo para HTTPS y credenciales distintas para varios lectores', () => {
  expect(() => validarTls('http://localhost:8081', 1, {})).not.toThrow();
  expect(() => validarTls('http://localhost:8081', 1, { ca: 'ca' })).toThrow(/requieren.*https/);
  expect(() => validarTls('https://localhost:8081', 1, {})).toThrow(/--ca, --cert y --key/);
  expect(() => validarTls('https://localhost:8081', 2, {
    ca: 'ca', cert: 'client.crt', key: 'client.key',
  })).toThrow(/{lectorId}/);
  expect(() => validarTls('https://localhost:8081', 2, {
    ca: 'ca', cert: '{lectorId}.crt', key: '{lectorId}.key',
  })).not.toThrow();
  expect(() => validarTls('https://user:secret@localhost', 1, {})).toThrow(/URL/);
});

it('CLI rechaza configuraciones TLS inválidas antes de lanzar el worker', () => {
  const cli = fileURLToPath(new URL('./index.ts', import.meta.url));
  const argumentos = ['start', '--perfil', 'nominal', '--lectores', '2',
    '--boletas', 'no-existe.json'];
  const ejecutar = (...opciones: string[]) => {
    try {
      execFileSync(process.execPath, [cli, ...argumentos, ...opciones],
        { stdio: 'pipe', encoding: 'utf8' });
      throw new Error('El CLI debió fallar');
    } catch (error) {
      return String((error as { stderr?: string }).stderr);
    }
  };
  expect(ejecutar('--coordinador', 'https://localhost:8081')).toContain('HTTPS requiere --ca');
  expect(ejecutar('--coordinador', 'http://localhost:8081', '--ca', 'ca')).toContain('requieren un coordinador https');
  expect(ejecutar('--coordinador', 'https://localhost:8081', '--ca', 'ca',
    '--cert', 'unico.crt', '--key', 'unico.key')).toContain('{lectorId}');
});

it('verifica CA de C2 y presenta un certificado distinto por lector', async () => {
  await certificados();
  const ca = join(directorio, 'ca.crt');
  const rutas = {
    ca, cert: join(directorio, '{lectorId}.crt'), key: join(directorio, '{lectorId}.key'),
  };
  servidor = Fastify({
    https: {
      key: await readFile(join(directorio, 'servidor.key')),
      cert: await readFile(join(directorio, 'servidor.crt')),
      ca: await readFile(ca), requestCert: true, rejectUnauthorized: true,
    },
  });
  const autenticados: string[] = [];
  servidor.post('/v1/validaciones', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = SolicitudValidacion.parse(request.body);
    const san = (request.raw.socket as TLSSocket).getPeerCertificate().subjectaltname;
    if (san !== `URI:urn:nexo:reader:${body.lectorId}`) {
      return reply.code(403).send({ error: 'LECTOR_NO_COINCIDE' });
    }
    autenticados.push(body.lectorId);
    return {
      idOrigen: body.idOrigen, decision: 'rechazado', motivo: 'CODIGO_DESCONOCIDO',
      proposito: null, admision: false, concurrente: false, anulacionEnTransito: false,
      versionPermisos: 1, evidencia: {
        via: 'C2 falso', versionPermisos: 1, versionPoliticas: 1, antiguedadPermisosS: 0,
      }, instanteDecision: new Date().toISOString(), repetida: false,
    };
  });
  await servidor.listen({ host: '127.0.0.1', port: 0 });
  const url = `https://127.0.0.1:${(servidor.server.address() as { port: number }).port}`;
  const solicitud = SolicitudValidacion.parse({
    idOrigen: 'LX-2210-0107-00001', lectorId: lectorIds[0], puntoId: 'P-01', eventoId: 'EVT-2026-02',
    codigo: 'TEST', zonaSolicitada: 'Sur', proposito: 'ingreso', instanteLector: new Date().toISOString(),
  });
  const clientes = await Promise.all(lectorIds.map(async (id) =>
    new ClienteHttpCoordinador(url, await cargarTls(rutas, id))));
  const noConfiable = new ClienteHttpCoordinador(url, await cargarTls({
    ...rutas, ca: join(directorio, 'otra.crt'),
  }, lectorIds[0]));
  try {
    for (const [indice, cliente] of clientes.entries()) {
      const lectorId = lectorIds[indice]!;
      expect((await cliente.validar({
        ...solicitud, lectorId, idOrigen: `${lectorId}-00001`,
      }, 3000)).decision).toBe('rechazado');
    }
    expect(autenticados).toEqual(lectorIds);
    await expect(clientes[1]!.validar(solicitud, 3000)).rejects.toMatchObject({ status: 403 });
    expect(autenticados).toHaveLength(2);
    await expect(noConfiable.validar(solicitud, 3000)).rejects.toThrow();
    expect(autenticados).toHaveLength(2);
  } finally {
    await Promise.all([...clientes, noConfiable].map((cliente) => cliente.cerrar()));
  }
}, 20_000);
