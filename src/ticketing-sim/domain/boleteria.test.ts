import { describe, expect, it } from 'vitest';
import { IndiceVersiones, VersionBoleteria } from '@nexo/shared/contracts';
import {
  BoletaDesconocida, BoletaYaAnulada, BoletaYaEmitida, Boleteria, LocalidadInvalida, semillaPiloto,
} from './boleteria.ts';

const instante = '2026-09-25T12:00:00.000Z';
const ahora = () => new Date(instante);
const crear = () => new Boleteria({
  emisiones: [{ referencia: 'TA-1', localidad: 'NORTE', comprador: { nombre: 'Comprador de prueba' } },
    { referencia: 'TA-2', localidad: 'SUR' }],
  anuladasIniciales: ['TA-2'], ahora,
});

describe('Boleteria', () => {
  it('publica la instantánea v0 y las anulaciones iniciales v1', () => {
    const boleteria = crear();
    expect(IndiceVersiones.parse(boleteria.indice()).versiones.map((v) => v.cambios)).toEqual([1, 1]);
    expect(boleteria.version(0)).toEqual(VersionBoleteria.parse({
      numero: 0, eventoExterno: 'TA-FECHA-14', publicadaEn: instante, instantanea: true,
      cambios: [{ operacion: 'emision', referenciaExterna: 'TA-1', localidad: 'NORTE',
        instante, comprador: { nombre: 'Comprador de prueba' } }],
    }));
    expect(boleteria.version(1)?.cambios).toEqual([
      { operacion: 'anulacion', referenciaExterna: 'TA-2', localidad: 'SUR', instante },
    ]);
    expect(boleteria.version(2)).toBeNull();
  });

  it('mantiene la instantánea vacía en v0 hasta la primera emisión', () => {
    const boleteria = new Boleteria({ emisiones: [], ahora });
    expect(boleteria.indice().ultimaVersion).toBe(0);
    expect(boleteria.version(0)?.cambios).toEqual([]);
    expect(boleteria.emitir('TA-NUEVA', 'NORTE').numero).toBe(1);
  });

  it('la semilla piloto coincide en cantidades, límites y comprador ficticio', () => {
    const semilla = semillaPiloto();
    const boleteria = new Boleteria({ ...semilla, ahora });
    expect(semilla.emisiones).toHaveLength(16_240);
    expect(boleteria.indice().versiones.map((v) => v.cambios)).toEqual([16_239, 1]);
    expect(semilla.emisiones[0]).toMatchObject({
      referencia: 'TA-8800-0000', localidad: 'NORTE', comprador: { correo: 'prueba@example.invalid' },
    });
    for (const [n, localidad] of [[4979, 'NORTE'], [4980, 'SUR'], [8339, 'SUR'], [8340, 'ORIENTAL'],
      [12349, 'ORIENTAL'], [12350, 'OCCIDENTAL'], [15709, 'OCCIDENTAL'], [15710, 'PALCOS']] as const) {
      expect(semilla.emisiones[n]?.localidad).toBe(localidad);
    }
    expect(semilla.emisiones[16239]?.referencia).toBe('TA-8816-0239');
    expect(boleteria.version(1)?.cambios[0]?.referenciaExterna).toBe('TA-8800-0001');
  });

  it('publica nuevas versiones y conserva todas las versiones anteriores inmutables', () => {
    const boleteria = crear();
    const anterior = boleteria.version(0);
    expect(boleteria.anular('TA-1')).toMatchObject({ numero: 2, instantanea: false,
      cambios: [{ operacion: 'anulacion', localidad: 'NORTE' }] });
    expect(() => boleteria.anular('TA-1')).toThrow(BoletaYaAnulada);
    expect(() => boleteria.anular('TA-X')).toThrow(BoletaDesconocida);
    expect(boleteria.emitir('TA-3', 'PALCOS')).toMatchObject({ numero: 3, cambios: [{ operacion: 'emision' }] });
    expect(() => boleteria.emitir('TA-3', 'SUR')).toThrow(BoletaYaEmitida);
    expect(() => boleteria.emitir('TA-2', 'SUR')).toThrow(BoletaYaEmitida);
    expect(() => boleteria.emitir('TA-4', 'INVALIDA')).toThrow(LocalidadInvalida);
    expect(boleteria.cambiarLocalidad('TA-3', 'ORIENTAL')).toMatchObject({
      numero: 4, cambios: [{ operacion: 'cambio-localidad', localidad: 'ORIENTAL' }],
    });
    expect(() => boleteria.cambiarLocalidad('TA-X', 'SUR')).toThrow(BoletaDesconocida);
    expect(() => boleteria.cambiarLocalidad('TA-1', 'SUR')).toThrow(BoletaYaAnulada);
    expect(() => boleteria.cambiarLocalidad('TA-3', 'INVALIDA')).toThrow(LocalidadInvalida);
    const copia = boleteria.version(0)!;
    copia.cambios[0]!.localidad = 'ALTERADA';
    copia.cambios[0]!.comprador!.nombre = 'ALTERADO';
    expect(boleteria.version(0)).toEqual(anterior);
    expect(boleteria.indice().ultimaVersion).toBe(4);
  });

  it('restaura versiones y estados sin modificar el historial', () => {
    const original = crear();
    original.cambiarLocalidad('TA-1', 'PALCOS');
    const json = original.exportar();
    const restaurada = Boleteria.restaurar(json, ahora);
    expect(restaurada.exportar()).toBe(json);
    expect(restaurada.version(2)).toEqual(original.version(2));
    expect(() => restaurada.anular('TA-2')).toThrow(BoletaYaAnulada);
    expect(restaurada.anular('TA-1').cambios[0]?.localidad).toBe('PALCOS');
    expect(restaurada.version(3)?.numero).toBe(3);
  });
});
