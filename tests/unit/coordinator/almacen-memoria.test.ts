import { describe, expect, it } from 'vitest';
import { ErrorConsumoDuplicado, ErrorIntentoDuplicado } from '@nexo/shared/domain';
import type { ConsumoIngreso, IntentoDeValidacion, ResultadoValidacion } from '@nexo/shared/domain';
import { crearAlmacenMemoria, semillaDemo } from '../../../src/local-coordinator/infrastructure/persistence/memoria/almacen-memoria.ts';

const ahora = new Date('2026-09-25T17:00:00.000Z');
const intento: IntentoDeValidacion = {
  idOrigen: 'LX-2210-107:1', eventoId: 'EVT-2026-02', lectorId: 'LX-2210-107',
  puntoId: 'P-01', codigo: 'TA-8800-0001', proposito: 'ingreso',
  zonaSolicitada: 'Norte', instanteLector: ahora,
};
const resultado: ResultadoValidacion = {
  idOrigen: intento.idOrigen, decision: 'aceptado', motivo: 'PERMISO_VIGENTE', proposito: 'ingreso',
  admision: true, concurrente: false, anulacionEnTransito: false,
  versionPermisos: 37, evidencia: { via: 'Coordinador COORD-A', versionPermisos: 37, versionPoliticas: 2, antiguedadPermisosS: 0 },
  instanteDecision: ahora, repetida: false,
};
const consumo: ConsumoIngreso = {
  clave: { clienteId: 'CLI-001', eventoId: intento.eventoId, boleteriaId: 'BOL-01', referencia: intento.codigo, proposito: 'PRIMER_INGRESO' },
  idOrigen: intento.idOrigen, puntoId: intento.puntoId, lectorId: intento.lectorId, consumidoEn: ahora,
};
const registro = { eventoId: intento.eventoId, registro: {
  tipo: 'decision' as const, idOrigen: intento.idOrigen, lectorId: intento.lectorId, puntoId: intento.puntoId,
  codigo: intento.codigo, zona: 'Norte', zonaSolicitada: 'Norte', decision: 'aceptado' as const,
  motivo: 'PERMISO_VIGENTE' as const, proposito: 'ingreso' as const,
  admision: true, concurrente: false, anulacionEnTransito: false, evidencia: resultado.evidencia,
  instanteLector: ahora.toISOString(), instanteDecision: ahora.toISOString(),
} };

describe('D1 de memoria', () => {
  it('cancela todos los cambios staged y libera el bloqueo', async () => {
    const almacen = crearAlmacenMemoria();
    almacen.sembrar(semillaDemo(ahora));
    const primera = await almacen.unidades.abrir();
    await primera.cargarParaActualizar(intento);
    await primera.registrarIntento(intento, 'huella', resultado);
    await primera.registrarConsumo(consumo);
    await primera.agregarBitacora({ eventoId: intento.eventoId, tipo: 'decision', idOrigen: intento.idOrigen, contenido: {}, registradoEn: ahora });
    await primera.agregarOutbox(registro);
    const segunda = await almacen.unidades.abrir();
    let desbloqueada = false;
    const esperando = segunda.cargarParaActualizar(intento).then((datos) => {
      desbloqueada = true;
      return datos;
    });
    await Promise.resolve();
    expect(desbloqueada).toBe(false);
    await primera.cancelar();
    await primera.cancelar();
    expect((await esperando).boleta?.consumo).toBeNull();
    await segunda.cancelar();
    expect(almacen.volcado()).toMatchObject({ intentos: [], consumos: [], bitacora: [], outbox: [] });
  });

  it('confirma atómicamente, aplica UNIQUE y deja acuses sin borrar el outbox', async () => {
    const almacen = crearAlmacenMemoria();
    almacen.sembrar(semillaDemo(ahora));
    const primera = await almacen.unidades.abrir();
    await primera.cargarParaActualizar(intento);
    await primera.registrarIntento(intento, 'huella', resultado);
    await primera.registrarConsumo(consumo);
    await primera.agregarOutbox(registro);
    await primera.confirmar();
    await primera.cancelar();
    const segunda = await almacen.unidades.abrir();
    expect((await segunda.buscarIntento(intento.eventoId, intento.idOrigen))?.resultado).toEqual(resultado);
    expect((await segunda.cargarParaActualizar(intento)).boleta?.consumo?.idOrigen).toBe(intento.idOrigen);
    await expect(segunda.registrarIntento(intento, 'huella', resultado)).rejects.toBeInstanceOf(ErrorIntentoDuplicado);
    await expect(segunda.registrarConsumo(consumo)).rejects.toBeInstanceOf(ErrorConsumoDuplicado);
    await segunda.cancelar();
    await almacen.outbox.agregar([registro]);
    expect(await almacen.outbox.pendientes(10)).toHaveLength(1);
    await almacen.outbox.registrarAcuse([1], 'lote-00001', ahora);
    expect(await almacen.outbox.pendientes(10)).toHaveLength(0);
    expect(almacen.volcado().outbox).toHaveLength(1);
    expect((await almacen.outbox.resumen(ahora)).pendientes).toBe(0);
  });

  it('no permite confirmar cambios parciales cuando D1 falla', async () => {
    const almacen = crearAlmacenMemoria();
    almacen.sembrar(semillaDemo(ahora));
    const unidad = await almacen.unidades.abrir();
    await unidad.cargarParaActualizar(intento);
    await unidad.registrarIntento(intento, 'huella', resultado);
    almacen.simularCaida(true);
    await expect(unidad.confirmar()).rejects.toThrow('D1 no disponible');
    await unidad.cancelar();
    almacen.simularCaida(false);
    expect(almacen.volcado().intentos).toEqual([]);
    expect(await almacen.salud()).toBe(true);
  });
});
