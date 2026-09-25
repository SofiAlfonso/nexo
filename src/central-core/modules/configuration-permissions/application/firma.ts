import { createHmac } from 'node:crypto';
import type { Firma, PaquetePermisos } from '@nexo/shared/contracts';

type PaqueteSinFirma = Omit<PaquetePermisos, 'firma'>;

/** Serializa JSON con claves de objeto ordenadas recursivamente y orden original de arrays.
 * La firma HMAC-SHA256 es base64url de esos bytes UTF-8; nunca incluye el campo `firma`.
 */
export function canonicalizar(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonicalizar).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.entries(valor).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([clave, v]) => `${JSON.stringify(clave)}:${canonicalizar(v)}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function firmarPaquete(paquete: PaqueteSinFirma, secreto: string, kid = 'm1-v1'): Firma {
  return {
    algoritmo: 'HMAC-SHA256',
    kid,
    valor: createHmac('sha256', secreto).update(canonicalizar(paquete), 'utf8').digest('base64url'),
  };
}
