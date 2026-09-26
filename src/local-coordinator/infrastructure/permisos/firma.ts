import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaquetePermisos } from '@nexo/shared/contracts';

export function canonicalizar(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonicalizar).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.entries(valor).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([clave, v]) => `${JSON.stringify(clave)}:${canonicalizar(v)}`).join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function verificarFirma(paquete: PaquetePermisos, secreto: string, kidsAceptados: string[] = ['m1-v1']): boolean {
  if (paquete.firma.algoritmo !== 'HMAC-SHA256' || !kidsAceptados.includes(paquete.firma.kid)) return false;
  const { firma, ...contenido } = paquete;
  const esperada = createHmac('sha256', secreto).update(canonicalizar(contenido), 'utf8').digest();
  const recibida = Buffer.from(firma.valor, 'base64url');
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}
