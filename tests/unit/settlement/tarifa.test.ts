import { describe, expect, it } from 'vitest';
import {
  PLAZO_COBRO_MS,
  PLAZO_DEFINITIVO_MS,
  PLAZO_PRELIMINAR_MS,
  ajusteContraAnticipo,
  anticipo,
  contribucionYMargen,
  costosEvento,
  dentroDePlazo,
  evaluarRecompra,
  importe,
} from '../../../src/central-core/modules/contracting-settlement/domain/index.ts';

describe('T12 · liquidación y plazos (decimal.js)', () => {
  // PU-07-01: 100 admisiones dan USD 540.
  it('PU-07-01: 100 admisiones dan USD 540,00', () => {
    expect(importe(100)).toBe('540.00');
  });

  // PB-17: evento pagado con cero admisiones da USD 500.
  it('PB-17: cero admisiones da USD 500,00', () => {
    expect(importe(0)).toBe('500.00');
  });

  // PB-18: una admisión da exactamente USD 500,40, con decimal y no punto flotante.
  it('PB-18: una admisión da exactamente USD 500,40', () => {
    expect(importe(1)).toBe('500.40');
  });

  // PB-19: admisiones negativas se rechazan.
  it('PB-19: admisiones negativas se rechazan', () => {
    expect(() => importe(-1)).toThrow();
  });

  // PB-20: una admisión estimada para el anticipo da exactamente USD 500,20.
  it('PB-20: una admisión estimada para el anticipo da USD 500,20', () => {
    expect(anticipo(1)).toBe('500.20');
  });

  // PU-07-05: descuento de 20 sobre 540 da 520.
  it('PU-07-05: un descuento de 20 sobre 540 da 520,00', () => {
    expect(importe(100, '20')).toBe('520.00');
  });

  // PU-07-03: anticipo 520 y uso real de 25 admisiones (importe 510) dan devolución de 10.
  it('PU-07-03: anticipo 520 y uso real de 25 dan importe 510 y devolución 10', () => {
    const real = importe(25);
    expect(real).toBe('510.00');
    expect(ajusteContraAnticipo(real, '520.00')).toEqual({ saldo: '0.00', devolucion: '10.00' });
  });

  // PU-07-04: uso de 150 da 560 y saldo de 40 sobre un anticipo de 520.
  it('PU-07-04: uso de 150 da 560 y saldo de 40', () => {
    const real = importe(150);
    expect(real).toBe('560.00');
    expect(ajusteContraAnticipo(real, '520.00')).toEqual({ saldo: '40.00', devolucion: '0.00' });
  });

  it('costos y margen: sin falla del coordinador, contribución y margen sobre el importe', () => {
    const real = importe(100);
    expect(costosEvento(false)).toBe('300.00');
    expect(costosEvento(true)).toBe('320.00');
    expect(contribucionYMargen(real, costosEvento(false))).toEqual({ contribucion: '240.00', margen: '0.4444' });
  });

  // PB-15: preliminar a 30 min exactos y a 30 min + 1 ms.
  it('PB-15: preliminar a 30 min exactos está dentro; a 30 min + 1 ms está fuera', () => {
    expect(dentroDePlazo(PLAZO_PRELIMINAR_MS, PLAZO_PRELIMINAR_MS)).toBe(true);
    expect(dentroDePlazo(PLAZO_PRELIMINAR_MS + 1, PLAZO_PRELIMINAR_MS)).toBe(false);
  });

  // PB-16: definitivo a 24 h exactas y a 24 h + 1 ms.
  it('PB-16: definitivo a 24 h exactas está dentro; a 24 h + 1 ms está fuera', () => {
    expect(dentroDePlazo(PLAZO_DEFINITIVO_MS, PLAZO_DEFINITIVO_MS)).toBe(true);
    expect(dentroDePlazo(PLAZO_DEFINITIVO_MS + 1, PLAZO_DEFINITIVO_MS)).toBe(false);
  });

  // PB-24: cobro a 30 días exactos y a 30 días + 1 ms.
  it('PB-24: cobro a 30 días exactos está dentro; a 30 días + 1 ms está vencido', () => {
    expect(dentroDePlazo(PLAZO_COBRO_MS, PLAZO_COBRO_MS)).toBe(true);
    expect(dentroDePlazo(PLAZO_COBRO_MS + 1, PLAZO_COBRO_MS)).toBe(false);
  });

  // PU-08-01: recompra vinculante del mismo cliente dentro del plazo acredita KR5.2.
  it('PU-08-01: recompra vinculante del mismo cliente dentro de 60 días acredita KR5.2', () => {
    const resultado = evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-01',
      vinculante: true,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-09-15T00:00:00Z'),
    });
    expect(resultado).toEqual({ esRecompra: true, acreditaKR52: true, diasTranscurridos: 45 });
  });

  // PB-22: recompra firmada a los 60 días exactos cumple KR5.2.
  it('PB-22: recompra a los 60 días exactos cumple KR5.2', () => {
    const resultado = evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-01',
      vinculante: true,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-09-30T00:00:00Z'),
    });
    expect(resultado.diasTranscurridos).toBe(60);
    expect(resultado.esRecompra).toBe(true);
    expect(resultado.acreditaKR52).toBe(true);
  });

  // PB-23: recompra a los 61 días es recompra, pero no acredita KR5.2.
  it('PB-23: recompra a los 61 días es recompra, pero no acredita KR5.2', () => {
    const resultado = evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-01',
      vinculante: true,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-10-01T00:00:00Z'),
    });
    expect(resultado.diasTranscurridos).toBe(61);
    expect(resultado.esRecompra).toBe(true);
    expect(resultado.acreditaKR52).toBe(false);
  });

  // PU-08-03: una nueva contratación no vinculante (solo intención) no cuenta como recompra.
  it('PU-08-03: una contratación no vinculante no es recompra', () => {
    const resultado = evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-01',
      vinculante: false,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-08-15T00:00:00Z'),
    });
    expect(resultado.esRecompra).toBe(false);
    expect(resultado.acreditaKR52).toBe(false);
  });

  // PU-08-04: una contratación vinculante de otro cliente no es recompra del piloto.
  it('PU-08-04: una contratación vinculante de otro cliente no es recompra', () => {
    const resultado = evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-02',
      vinculante: true,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-08-15T00:00:00Z'),
    });
    expect(resultado.esRecompra).toBe(false);
    expect(resultado.acreditaKR52).toBe(false);
  });

  it('rechaza una nueva contratación anterior al primer piloto pagado', () => {
    expect(() => evaluarRecompra({
      clienteOriginalId: 'CLI-01',
      clienteNuevoId: 'CLI-01',
      vinculante: true,
      primerPilotoPagadoEn: new Date('2026-08-01T00:00:00Z'),
      nuevaContratacionEn: new Date('2026-07-01T00:00:00Z'),
    })).toThrow();
  });
});
