import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { PaquetePermisos } from '@nexo/shared/contracts';
import { canonicalizar, verificarFirma } from './firma.ts';

const sinFirma: Omit<PaquetePermisos, 'firma'> = {
  eventoId: 'EVT-2026-02', origen: 'M1 · BOL-01', tipo: 'cambios', desdeVersion: 37, hastaVersion: 38,
  emitidoEn: '2026-09-25T12:00:00.000Z', vigenteHasta: '2026-09-25T12:05:00.000Z',
  ventana: { aperturaEn: '2026-09-25T11:00:00.000Z', cierreEn: '2026-09-26T01:00:00.000Z' },
  politicas: { version: 2, reingresoPermitido: false, reingresoTrasMin: 0, reingresoSuspendido: false },
  puntos: [{ puntoId: 'P-01', zonas: ['Norte'] }],
  cambios: [{ tipo: 'alta', version: 38, referencia: 'TA-8801-0041', zona: 'Norte' }],
};

function firmado(contenido = sinFirma): PaquetePermisos {
  return { ...contenido, firma: { algoritmo: 'HMAC-SHA256', kid: 'm1-v1',
    valor: createHmac('sha256', 'clave').update(canonicalizar(contenido), 'utf8').digest('base64url') } };
}

describe('firma P2', () => {
  it('ordena claves anidadas, descarta undefined y conserva el orden de arrays', () => {
    expect(canonicalizar({ z: [{ b: 1, a: 2 }], a: undefined, c: null }))
      .toBe('{"c":null,"z":[{"a":2,"b":1}]}');
  });
  it('acepta un HMAC válido y rechaza cambios de contenido, kid, algoritmo o secreto', () => {
    const paquete = firmado();
    expect(verificarFirma(paquete, 'clave')).toBe(true);
    expect(verificarFirma({ ...paquete, cambios: [] }, 'clave')).toBe(false);
    expect(verificarFirma({ ...paquete, firma: { ...paquete.firma, kid: 'desconocido' } }, 'clave')).toBe(false);
    expect(verificarFirma({ ...paquete, firma: { ...paquete.firma, algoritmo: 'Ed25519' } }, 'clave')).toBe(false);
    expect(verificarFirma({ ...paquete, firma: { ...paquete.firma, valor: 'x' } }, 'clave')).toBe(false);
    expect(verificarFirma(paquete, 'otra')).toBe(false);
  });
});
