import { describe, expect, it } from 'vitest';
import { MotorPrimerIngreso, VENTANA_CONCURRENCIA_MS, admiteHorario, anulacionConocida } from '../../../src/shared/domain/index.ts';
import type { ContextoIngreso } from '../../../src/shared/domain/index.ts';
import { BASE, contexto } from './dobles.ts';

const motor = new MotorPrimerIngreso();
const evaluar = (cambios: Partial<ContextoIngreso> = {}) => motor.evaluar(contexto(cambios));

describe('MotorPrimerIngreso: prioridad y límites de evaluación', () => {
  it('PB-01 una misma referencia externa en dos eventos se evalúa con sus propios permisos', () => {
    const base = contexto();
    expect(evaluar({ boleta: { ...base.boleta!, eventoId: 'EVT-2026-11' } })).toMatchObject({
      decision: 'rechazado', motivo: 'CODIGO_DESCONOCIDO', zonaBoleta: 'Norte', admision: false,
    });
    const otroEvento = {
      ...base.evento, eventoId: 'EVT-2026-11', clienteId: 'CLI-002', boleteriaId: 'BOL-002',
    };
    const otroIntento = { ...base.intento, eventoId: otroEvento.eventoId, zonaSolicitada: 'Sur' };
    expect(evaluar({
      evento: otroEvento,
      intento: otroIntento,
      punto: { ...base.punto!, eventoId: otroEvento.eventoId, zonas: ['Sur'] },
      boleta: { ...base.boleta!, eventoId: otroEvento.eventoId, referencia: base.boleta!.referencia, zona: 'Sur' },
    })).toMatchObject({ decision: 'aceptado', zonaBoleta: 'Sur', admision: true });
    expect(evaluar().zonaBoleta).toBe('Norte');
    expect(evaluar({ boleta: null })).toMatchObject({ decision: 'rechazado', motivo: 'CODIGO_DESCONOCIDO', zonaBoleta: null });
  });
  it('PB-05 17:59:59 antes de la ventana se rechaza', () => {
    const instante = new Date('2026-10-10T17:59:59-05:00');
    expect(admiteHorario(contexto().evento.ventana, instante)).toBe(false);
    expect(evaluar({ instante }).motivo).toBe('FUERA_DE_HORARIO');
  });
  it('PB-06 18:00:00 abre el intervalo y admite', () => {
    const instante = new Date('2026-10-10T18:00:00-05:00');
    expect(admiteHorario(contexto().evento.ventana, instante)).toBe(true);
    expect(evaluar({ instante })).toMatchObject({ decision: 'aceptado', motivo: 'PERMISO_VIGENTE', proposito: 'ingreso', admision: true });
  });
  it('PB-07 22:00:00 queda fuera del intervalo semiabierto', () => {
    const instante = new Date('2026-10-10T22:00:00-05:00');
    expect(admiteHorario(contexto().evento.ventana, instante)).toBe(false);
    expect(evaluar({ instante }).motivo).toBe('FUERA_DE_HORARIO');
  });
  it('PB-08 zona ausente, vacía o ajena al punto se rechaza', () => {
    const base = contexto();
    for (const zonaSolicitada of [null, '', '  ']) {
      expect(evaluar({ intento: { ...base.intento, zonaSolicitada } }).motivo).toBe('ZONA_NO_AUTORIZADA');
    }
    expect(evaluar({ punto: { ...base.punto!, zonas: ['Sur'] } }).motivo).toBe('ZONA_NO_AUTORIZADA');
    const sur = contexto({ intento: { ...base.intento, puntoId: 'P-02', zonaSolicitada: 'Sur' } });
    expect(evaluar({ punto: sur.punto, boleta: { ...base.boleta!, zona: 'Sur' }, intento: sur.intento }).decision).toBe('aceptado');
    // Punto multizona: la zona solicitada debe coincidir con la de la boleta y estar servida por el punto.
    const multizona = { ...base.punto!, zonas: ['Norte', 'Palcos'] };
    expect(evaluar({ punto: multizona, intento: { ...base.intento, zonaSolicitada: 'Palcos' } }).motivo).toBe('ZONA_NO_AUTORIZADA');
    expect(evaluar({ punto: multizona, intento: { ...base.intento, zonaSolicitada: 'Sur' } }).motivo).toBe('ZONA_NO_AUTORIZADA');
    expect(evaluar({ punto: multizona }).decision).toBe('aceptado');
  });
  it('PB-09 punto ausente, deshabilitado o de otro evento prevalece sobre código desconocido', () => {
    const base = contexto();
    for (const punto of [null, { ...base.punto!, habilitado: false }, { ...base.punto!, eventoId: 'EVT-2026-11' }]) {
      expect(evaluar({ punto, boleta: null })).toMatchObject({ decision: 'rechazado', motivo: 'PUNTO_SUSPENDIDO' });
    }
  });
  it('PB-10 evento no abierto rechaza aun dentro de horario', () => {
    for (const estado of ['preparacion', 'cerrado'] as const) {
      expect(evaluar({ evento: { ...contexto().evento, estado } }).motivo).toBe('FUERA_DE_HORARIO');
    }
  });
  it('PB-11 coordinador sin autoridad y contingencia sin política no deciden', () => {
    for (const estado of ['sin-autoridad', 'protegiendo'] as const) {
      expect(evaluar({ coordinador: { coordinadorId: 'COORD-A', estado }, boleta: null })).toMatchObject({
        decision: 'sin-respuesta', motivo: 'SIN_COORDINADOR', admision: false,
      });
    }
    expect(evaluar({ modo: 'local-contingencia', boleta: null }).motivo).toBe('SIN_COORDINADOR');
    const base = contexto();
    expect(evaluar({
      modo: 'local-contingencia',
      evento: { ...base.evento, politicas: { ...base.evento.politicas, contingenciaLocal: true } },
    }).decision).toBe('aceptado');
  });
  it('PU-03-03 anulación recibida rechaza; anulación en tránsito permite con marca', () => {
    const boleta = contexto().boleta!;
    const anulacion = { anuladaEn: new Date('2026-10-10T18:30:00-05:00'), recibidaEn: new Date(BASE) };
    expect(anulacionConocida({ ...boleta, anulacion }, new Date(BASE))).toBe(true);
    expect(evaluar({ boleta: { ...boleta, anulacion } }).motivo).toBe('BOLETA_ANULADA');
    for (const recibidaEn of [null, new Date('2026-10-10T19:00:01-05:00')]) {
      expect(anulacionConocida({ ...boleta, anulacion: { ...anulacion, recibidaEn } }, new Date(BASE))).toBe(false);
      expect(evaluar({ boleta: { ...boleta, anulacion: { ...anulacion, recibidaEn } } })).toMatchObject({
        decision: 'aceptado', anulacionEnTransito: true,
      });
    }
  });
  it('PU-03-04 consumo previo distingue concurrencia de uso registrado, sin reingresos', () => {
    const boleta = contexto().boleta!;
    const evaluarConsumo = (ms: number) => evaluar({
      boleta: { ...boleta, consumo: { idOrigen: 'INT-ANTERIOR', puntoId: 'P-02', consumidoEn: new Date(Date.parse(BASE) - ms) } },
    });
    expect(evaluarConsumo(VENTANA_CONCURRENCIA_MS - 1)).toMatchObject({
      decision: 'rechazado', motivo: 'USO_CONCURRENTE', concurrente: true, admision: false,
    });
    expect(evaluarConsumo(VENTANA_CONCURRENCIA_MS)).toMatchObject({
      decision: 'rechazado', motivo: 'USO_YA_REGISTRADO', concurrente: false, admision: false,
    });
  });
  it('PU-03-01 evidencia refleja vía, versiones y antigüedad no negativa', () => {
    expect(evaluar().evidencia).toEqual({
      via: 'Coordinador COORD-A', versionPermisos: 4, versionPoliticas: 3, antiguedadPermisosS: 42,
    });
    expect(evaluar({ versiones: { ...contexto().versiones, permisosRecibidosEn: new Date(Date.parse(BASE) + 1000) } })
      .evidencia.antiguedadPermisosS).toBe(0);
  });
});
