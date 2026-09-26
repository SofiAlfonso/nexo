import { describe, expect, it } from 'vitest';
import {
  condicionesPendientes,
  diferenciaAnulacion,
  diferenciaDiario,
  evaluarCondicionesCierre,
} from '../../../src/central-core/modules/reconciliation/domain/index.ts';

const TODAS_LAS_CONDICIONES_OK = {
  ventanaCerrada: true,
  diariosSincronizados: true,
  buzonVacio: true,
  cambiosAlDia: true,
  preliminarEntregado: true,
  diferenciasResueltas: true,
};

describe('reconciliation/domain: diferenciaDiario', () => {
  it('genera una única opción "registrar sin aceptación"', () => {
    const diferencia = diferenciaDiario(3, 1000);
    expect(diferencia.tipo).toBe('diario');
    expect(diferencia.casos).toBe(3);
    expect(diferencia.referencia).toBeNull();
    expect(diferencia.opciones).toHaveLength(1);
    expect(diferencia.opciones[0]?.id).toBe('registrar-sin-aceptacion');
    expect(diferencia.detectadaEnS).toBe(1000);
  });
});

describe('reconciliation/domain: diferenciaAnulacion', () => {
  it('ofrece excluir del cobro o mantener la admisión, con la referencia y el intento', () => {
    const diferencia = diferenciaAnulacion('REF-001', 'INTENTO-42', 500);
    expect(diferencia.tipo).toBe('anulacion');
    expect(diferencia.referencia).toBe('REF-001');
    expect(diferencia.intentoId).toBe('INTENTO-42');
    expect(diferencia.opciones.map((opcion) => opcion.id)).toEqual(['excluir-del-cobro', 'mantener-admision']);
  });
});

describe('reconciliation/domain: evaluarCondicionesCierre', () => {
  it('marca las seis condiciones cuando todo está en orden', () => {
    const condiciones = evaluarCondicionesCierre(TODAS_LAS_CONDICIONES_OK);
    expect(condiciones).toHaveLength(6);
    expect(condiciones.every((condicion) => condicion.ok)).toBe(true);
    expect(condicionesPendientes(condiciones)).toEqual([]);
  });

  it('reporta como pendiente cada condición individual que falla', () => {
    const casos: [keyof typeof TODAS_LAS_CONDICIONES_OK, string][] = [
      ['ventanaCerrada', 'ventana-cerrada'],
      ['diariosSincronizados', 'diarios-sincronizados'],
      ['buzonVacio', 'buzon-vacio'],
      ['cambiosAlDia', 'cambios-al-dia'],
      ['preliminarEntregado', 'preliminar-entregado'],
      ['diferenciasResueltas', 'diferencias-resueltas'],
    ];
    for (const [campo, id] of casos) {
      const condiciones = evaluarCondicionesCierre({ ...TODAS_LAS_CONDICIONES_OK, [campo]: false });
      expect(condicionesPendientes(condiciones)).toEqual([id]);
    }
  });

  it('acumula varias condiciones pendientes a la vez', () => {
    const condiciones = evaluarCondicionesCierre({
      ...TODAS_LAS_CONDICIONES_OK,
      diariosSincronizados: false,
      diferenciasResueltas: false,
    });
    expect(condicionesPendientes(condiciones)).toEqual(['diarios-sincronizados', 'diferencias-resueltas']);
  });
});
