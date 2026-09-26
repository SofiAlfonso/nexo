import { describe, expect, it } from 'vitest';
import type { PaquetePermisos } from '@nexo/shared/contracts';
import { canonicalizar as canonicalizarM1, firmarPaquete } from '../../../src/central-core/modules/configuration-permissions/application/firma.ts';
import { canonicalizar as canonicalizarC2, verificarFirma } from '../../../src/local-coordinator/infrastructure/permisos/firma.ts';

describe('compatibilidad de firmas M1 → C2', () => {
  it('comparte la canonización y verifica un paquete firmado por M1', () => {
    const contenido: Omit<PaquetePermisos, 'firma'> = {
      eventoId: 'EVT-2026-02', origen: 'M1 · TaquillaAndina', tipo: 'cambios',
      desdeVersion: 37, hastaVersion: 40, emitidoEn: '2026-09-25T12:00:00Z',
      vigenteHasta: '2026-09-25T12:05:00Z',
      ventana: { aperturaEn: '2026-09-25T11:00:00Z', cierreEn: '2026-09-26T01:00:00Z' },
      politicas: { version: 2, reingresoPermitido: false, reingresoTrasMin: 0, reingresoSuspendido: false },
      puntos: [{ puntoId: 'P-01', zonas: ['Norte', 'Palcos'] }],
      cambios: [
        { tipo: 'alta', version: 38, referencia: 'TA-8801-0041', zona: 'Norte' },
        { tipo: 'cambio-zona', version: 39, referencia: 'TA-8801-0041', zona: 'Palcos' },
        { tipo: 'anulacion', version: 40, referencia: 'TA-8801-0041', anuladaEn: '2026-09-25T12:00:00Z' },
      ],
    };
    expect(canonicalizarC2({ ...contenido, omitido: undefined })).toBe(canonicalizarM1(contenido));
    const paquete = { ...contenido, firma: firmarPaquete(contenido, 'clave') };
    expect(verificarFirma(paquete, 'clave')).toBe(true);
    expect(canonicalizarM1(paquete)).toBe(canonicalizarC2(paquete));
  });
});
