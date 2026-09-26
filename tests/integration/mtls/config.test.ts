import { describe, expect, it } from 'vitest';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';

describe('configuración mTLS de C2', () => {
  it('mantiene HTTP por defecto para el entorno M1', () => {
    expect(cargarConfig({}).tls).toBeNull();
    expect(cargarConfig({ COORDINATOR_TLS: 'false' }).tls).toBeNull();
  });

  it('exige las cuatro rutas cuando se activa TLS', () => {
    expect(() => cargarConfig({ COORDINATOR_TLS: 'true' })).toThrow(/COORDINATOR_TLS_CERT_FILE/);
    expect(() => cargarConfig({ COORDINATOR_TLS: 'yes' })).toThrow(/COORDINATOR_TLS/);
    expect(cargarConfig({
      COORDINATOR_TLS: 'true',
      COORDINATOR_TLS_CERT_FILE: 'servidor.crt',
      COORDINATOR_TLS_KEY_FILE: 'servidor.key',
      COORDINATOR_TLS_CA_FILE: 'ca.crt',
      COORDINATOR_TLS_REVOKED_FILE: 'revocados.json',
    }).tls).toEqual({
      certPath: 'servidor.crt',
      keyPath: 'servidor.key',
      caPath: 'ca.crt',
      revokedPath: 'revocados.json',
    });
  });
});
