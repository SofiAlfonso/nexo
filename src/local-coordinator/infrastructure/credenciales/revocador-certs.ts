import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { CredencialRevocada, MotivoRevocacion, RevocadorCredenciales } from '../../application/puertos.ts';

const ejecutar = promisify(execFile);

export interface OpcionesRevocadorCerts {
  /** `revoked.json` que lee el servidor TLS de C2 (`COORDINATOR_TLS_REVOKED_FILE`). */
  revokedPath: string;
  /**
   * `scripts/certs.mjs` de la CA de laboratorio. Sin él, C2 no tiene la CA: la revocación se
   * confirma cuando el custodio ejecuta `certs.mjs revoke` y la entrada aparece en `revokedPath`.
   */
  certsScript?: string;
  store?: string;
  timeoutMs?: number;
}

interface EntradaRevocada {
  readerId: string;
  serialNumber: string;
  fingerprint256: string;
  revokedAt: string;
  reason: string;
}

function entradaValida(e: unknown): e is EntradaRevocada {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return typeof x.readerId === 'string' &&
    typeof x.serialNumber === 'string' && /^[0-9A-F]+$/.test(x.serialNumber) &&
    typeof x.fingerprint256 === 'string' && /^[0-9a-f]{64}$/.test(x.fingerprint256) &&
    typeof x.revokedAt === 'string' && Number.isFinite(Date.parse(x.revokedAt)) &&
    typeof x.reason === 'string' && ['lost', 'compromised', 'retired'].includes(x.reason);
}

async function buscar(ruta: string, lectorId: string): Promise<CredencialRevocada | null> {
  const lista: unknown = JSON.parse(await readFile(ruta, 'utf8'));
  if (!lista || typeof lista !== 'object' || (lista as { version?: unknown }).version !== 1 ||
      !Array.isArray((lista as { revoked?: unknown }).revoked) ||
      !(lista as { revoked: unknown[] }).revoked.every(entradaValida)) {
    throw new Error('Lista de revocaciones inválida');
  }
  const entrada = (lista as { revoked: EntradaRevocada[] }).revoked.find((e) => e.readerId === lectorId);
  return entrada
    ? { lectorId, serialNumber: entrada.serialNumber, fingerprint256: entrada.fingerprint256, revokedAt: entrada.revokedAt }
    : null;
}

/** Revoca con `scripts/certs.mjs revoke` y confirma con la entrada rica de `revoked.json` (ADR-008). */
export class RevocadorCertsMjs implements RevocadorCredenciales {
  private readonly opciones: OpcionesRevocadorCerts;

  constructor(opciones: OpcionesRevocadorCerts) {
    this.opciones = opciones;
  }

  async revocar(lectorId: string, motivo: MotivoRevocacion): Promise<CredencialRevocada> {
    const { revokedPath, certsScript, store, timeoutMs = 30_000 } = this.opciones;
    const existente = await buscar(revokedPath, lectorId);
    if (existente) return existente;
    if (!certsScript) {
      throw new Error(
        `Revocación pendiente: el custodio de la CA debe ejecutar scripts/certs.mjs revoke --reader-id ${lectorId} --reason ${motivo}`,
      );
    }
    const args = [certsScript, 'revoke', '--reader-id', lectorId, '--reason', motivo, ...(store ? ['--store', store] : [])];
    try {
      await ejecutar(process.execPath, args, { timeout: timeoutMs });
    } catch (error) {
      const detalle = (error as { stderr?: string }).stderr?.trim() || (error instanceof Error ? error.message : String(error));
      throw new Error(`certs.mjs revoke falló para ${lectorId}: ${detalle}`);
    }
    const revocada = await buscar(revokedPath, lectorId);
    if (!revocada) throw new Error(`certs.mjs no dejó a ${lectorId} en ${revokedPath}`);
    return revocada;
  }
}
