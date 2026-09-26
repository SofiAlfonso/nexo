import { createHash, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createSecureContext } from 'node:tls';
import type { ServerOptions } from 'node:https';
import type { TLSSocket, PeerCertificate } from 'node:tls';
import type { FastifyInstance, RawServerBase } from 'fastify';
import { ErrorRespuesta, RUTAS } from '@nexo/shared/contracts';
import type { ConfigCoordinador } from '../config.ts';

type RutasTls = NonNullable<ConfigCoordinador['tls']>;

const rutasLector = new Set<string>([
  RUTAS.validar.ruta,
  RUTAS.latido.ruta,
  RUTAS.loteDiario.ruta,
]);

function archivo(ruta: string, nombre: string): Buffer {
  if (!ruta?.trim()) throw new Error(`${nombre} es obligatorio con COORDINATOR_TLS=true`);
  const contenido = readFileSync(ruta);
  if (!contenido.length) throw new Error(`${nombre} está vacío`);
  return contenido;
}

function revocaciones(ruta: string, huellaCa: string): { series: string[]; huellas: string[] } {
  const contenido: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
  if (typeof contenido !== 'object' || contenido === null ||
    !('version' in contenido) || contenido.version !== 1 ||
    !('issuerFingerprint256' in contenido) || contenido.issuerFingerprint256 !== huellaCa ||
    !('revoked' in contenido) || !Array.isArray(contenido.revoked) ||
    !contenido.revoked.every((entrada: unknown) =>
      typeof entrada === 'object' && entrada !== null &&
      'readerId' in entrada && typeof entrada.readerId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(entrada.readerId) &&
      'serialNumber' in entrada && typeof entrada.serialNumber === 'string' &&
      /^[0-9A-F]+$/.test(entrada.serialNumber) &&
      'fingerprint256' in entrada && typeof entrada.fingerprint256 === 'string' &&
      /^[0-9a-f]{64}$/.test(entrada.fingerprint256) &&
      'revokedAt' in entrada && typeof entrada.revokedAt === 'string' &&
      Number.isFinite(Date.parse(entrada.revokedAt)) &&
      'reason' in entrada && typeof entrada.reason === 'string' &&
      ['lost', 'compromised', 'retired'].includes(entrada.reason))) {
    throw new Error('Lista de revocaciones ausente, inválida o de otra CA');
  }
  return {
    series: contenido.revoked.map((entrada: { serialNumber: string }) => entrada.serialNumber),
    huellas: contenido.revoked.map((entrada: { fingerprint256: string }) => entrada.fingerprint256.toUpperCase()),
  };
}

function huellaAutoridad(ca: Buffer): string {
  const certificado = new X509Certificate(ca);
  const ahora = Date.now();
  if (!certificado.ca || !certificado.verify(certificado.publicKey) ||
    !Number.isFinite(Date.parse(certificado.validFrom)) ||
    !Number.isFinite(Date.parse(certificado.validTo)) ||
    Date.parse(certificado.validFrom) > ahora || Date.parse(certificado.validTo) < ahora) {
    throw new Error('COORDINATOR_TLS_CA_FILE debe contener una CA válida y vigente');
  }
  return certificado.fingerprint256.replaceAll(':', '').toLowerCase();
}

function rutaRevocaciones(config: RutasTls): string {
  if (!config.revokedPath?.trim()) throw new Error('COORDINATOR_TLS_REVOKED_FILE es obligatorio con COORDINATOR_TLS=true');
  return config.revokedPath;
}

/** HTTPS y verificación de certificados cliente en el handshake. */
export function opcionesTlsCoordinador(config: ConfigCoordinador['tls']): ServerOptions | undefined {
  if (!config) return undefined;
  const cert = archivo(config.certPath, 'COORDINATOR_TLS_CERT_FILE');
  const key = archivo(config.keyPath, 'COORDINATOR_TLS_KEY_FILE');
  const ca = archivo(config.caPath, 'COORDINATOR_TLS_CA_FILE');
  const huellaCa = huellaAutoridad(ca);
  revocaciones(rutaRevocaciones(config), huellaCa);
  createSecureContext({ cert, key, ca });
  return { cert, key, ca, requestCert: true, rejectUnauthorized: true, minVersion: 'TLSv1.2' };
}

function identidad(cert: PeerCertificate): string | undefined {
  const san = cert.subjectaltname;
  const prefijo = 'URI:urn:nexo:reader:';
  if (!san?.startsWith(prefijo)) return undefined;
  const lectorId = san.slice(prefijo.length);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(lectorId) ? lectorId : undefined;
}

/**
 * Instalar ANTES de registrar las rutas de V1/H1 en el Fastify HTTPS.
 * La lista se relee en cada solicitud para que una revocación surta efecto sin reinicio.
 */
export function registrarAutenticacionLectores<RawServer extends RawServerBase>(
  app: FastifyInstance<RawServer>, config: ConfigCoordinador['tls'],
): void {
  if (!config) return;
  const ruta = rutaRevocaciones(config);
  const huellaCa = huellaAutoridad(archivo(config.caPath, 'COORDINATOR_TLS_CA_FILE'));
  revocaciones(ruta, huellaCa);
  app.addHook('preValidation', async (request, reply) => {
    if (request.method !== 'POST' || !rutasLector.has(request.url.split('?')[0] ?? '')) return;
    const socket = request.raw.socket as TLSSocket;
    const cert = typeof socket.getPeerCertificate === 'function' ? socket.getPeerCertificate() : undefined;
    if (!socket.encrypted || !socket.authorized || !cert?.raw) {
      return reply.code(401).send(ErrorRespuesta.parse({
        error: 'NO_AUTENTICADO', mensaje: 'Certificado de lector no autenticado',
      }));
    }
    const ahora = Date.now();
    if (!Number.isFinite(Date.parse(cert.valid_from)) || !Number.isFinite(Date.parse(cert.valid_to)) ||
      Date.parse(cert.valid_from) > ahora || Date.parse(cert.valid_to) < ahora) {
      return reply.code(401).send(ErrorRespuesta.parse({
        error: 'NO_AUTENTICADO', mensaje: 'Certificado del lector fuera de vigencia',
      }));
    }
    let lista: ReturnType<typeof revocaciones>;
    try {
      lista = revocaciones(ruta, huellaCa);
    } catch {
      return reply.code(503).send(ErrorRespuesta.parse({
        error: 'NO_DISPONIBLE', mensaje: 'No se puede comprobar la revocación del lector',
      }));
    }
    const huella = createHash('sha256').update(cert.raw).digest('hex').toUpperCase();
    if (lista.series.includes(cert.serialNumber) || lista.huellas.includes(huella)) {
      return reply.code(403).send(ErrorRespuesta.parse({
        error: 'NO_AUTORIZADO', mensaje: 'Certificado del lector revocado',
      }));
    }
    const lectorId = typeof request.body === 'object' && request.body !== null && 'lectorId' in request.body
      ? request.body.lectorId : undefined;
    const nombre = identidad(cert);
    if (!nombre || typeof lectorId !== 'string' || nombre !== lectorId) {
      return reply.code(403).send(ErrorRespuesta.parse({
        error: 'NO_AUTORIZADO', mensaje: 'lectorId no corresponde al certificado del lector',
      }));
    }
  });
}
