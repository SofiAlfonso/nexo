import { describe, expect, it } from 'vitest';
import { cargarConfig } from './config.ts';

describe('configuración de boletería', () => {
  it('usa la semilla piloto y el puerto predeterminados', () => {
    expect(cargarConfig({})).toEqual({
      port: 8082, host: '0.0.0.0', boleteria: 'TaquillaAndina',
      eventoExterno: 'TA-FECHA-14', semilla: 'piloto', estadoArchivo: null, adminToken: null,
    });
  });

  it('prioriza PORT y permite una semilla vacía con estado persistente', () => {
    expect(cargarConfig({
      PORT: '18082', TICKETING_PORT: '18083', HOST: '127.0.0.1',
      BOLETERIA_NOMBRE: 'Boletería de prueba', BOLETERIA_EVENTO_EXTERNO: 'EVENTO-PRUEBA',
      TICKETING_SEMILLA: 'vacia', TICKETING_ESTADO_ARCHIVO: 'estado.json',
      TICKETING_ADMIN_TOKEN: 'token-de-prueba',
    })).toEqual({
      port: 18082, host: '127.0.0.1', boleteria: 'Boletería de prueba',
      eventoExterno: 'EVENTO-PRUEBA', semilla: 'vacia', estadoArchivo: 'estado.json',
      adminToken: 'token-de-prueba',
    });
    expect(cargarConfig({ TICKETING_PORT: '18084' }).port).toBe(18084);
    expect(() => cargarConfig({ TICKETING_SEMILLA: 'inventada' })).toThrow();
  });
});
