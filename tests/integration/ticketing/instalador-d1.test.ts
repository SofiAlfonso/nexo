import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaquetePermisos } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { instalarPaquete } from '../../../src/local-coordinator/infrastructure/permisos/instalador-d1.ts';
import { dockerDisponible, EVENTO, iniciarD1, solicitud, type EntornoD1 } from '../coordinator/entorno.ts';

const instante = new Date();
function paquete(eventoId = EVENTO, desdeVersion = 37, hastaVersion = 40): PaquetePermisos {
  return {
    eventoId, origen: 'M1', tipo: desdeVersion === 0 ? 'instantanea' : 'cambios',
    desdeVersion, hastaVersion, emitidoEn: instante.toISOString(),
    vigenteHasta: new Date(instante.getTime() + 300_000).toISOString(),
    ventana: { aperturaEn: new Date(instante.getTime() - 3_600_000).toISOString(),
      cierreEn: new Date(instante.getTime() + 43_200_000).toISOString() },
    politicas: { version: 3, reingresoPermitido: false, reingresoTrasMin: 0, reingresoSuspendido: false },
    puntos: [{ puntoId: 'P-01', zonas: ['Norte', 'Palcos'] }],
    cambios: [
      { tipo: 'alta', version: 38, referencia: 'TA-8801-0041', zona: 'Norte' },
      { tipo: 'cambio-zona', version: 39, referencia: 'TA-8801-0041', zona: 'Palcos' },
      { tipo: 'anulacion', version: 40, referencia: 'TA-8801-0008', anuladaEn: instante.toISOString() },
    ],
    firma: { algoritmo: 'HMAC-SHA256', kid: 'm1-v1', valor: 'firma-prueba' },
  };
}
const alcance = { recibidoEn: new Date(instante.getTime() + 1_000), clienteId: 'CLI-001',
  boleteriaId: 'BOL-01', recintoId: 'REC-01' };

describe.skipIf(!dockerDisponible)('instalador P2 sobre D1', () => {
  let entorno: EntornoD1;
  beforeAll(async () => { entorno = await iniciarD1(); });
  afterAll(async () => { await entorno?.cerrar(); });

  it('instala cambios, anula sin borrar consumos y el motor rechaza la boleta anulada', async () => {
    const resultado = await instalarPaquete(entorno.pool, paquete(), alcance);
    expect(resultado).toMatchObject({ resultado: 'instalado', versionAnterior: 37, versionInstalada: 40,
      cambiosAplicados: 3, anulaciones: 1 });
    const evento = await entorno.pool.query('SELECT version_permisos, permisos_recibidos_en FROM evento WHERE evento_id=$1', [EVENTO]);
    expect(Number(evento.rows[0].version_permisos)).toBe(40);
    expect(evento.rows[0].permisos_recibidos_en).toEqual(alcance.recibidoEn);
    const anulada = await entorno.pool.query(
      'SELECT anulada_en, anulacion_recibida_en FROM boleta WHERE evento_id=$1 AND referencia=$2',
      [EVENTO, 'TA-8801-0008'],
    );
    expect(anulada.rows[0].anulacion_recibida_en).toEqual(alcance.recibidoEn);
    const zona = await entorno.pool.query('SELECT zona FROM boleta WHERE evento_id=$1 AND referencia=$2',
      [EVENTO, 'TA-8801-0041']);
    expect(zona.rows[0].zona).toBe('Palcos');
    const version = await entorno.pool.query('SELECT paquete FROM permiso_version WHERE evento_id=$1 AND version=40', [EVENTO]);
    expect(version.rows[0].paquete.firma.valor).toBe('firma-prueba');

    const motor = new ValidarPrimerIngreso({
      unidades: entorno.almacen.unidades, alcance: entorno.almacen.alcance,
      autoridad: new AutoridadNodoUnico('COORD-INT'), reloj: { ahora: () => new Date(alcance.recibidoEn.getTime() + 1_000) },
    });
    const peticion = solicitud('TA-8801-0008', { instanteLector: new Date(alcance.recibidoEn.getTime() + 1_000) });
    const decision = await motor.ejecutar(peticion);
    expect(decision).toMatchObject({ decision: 'rechazado', motivo: 'BOLETA_ANULADA' });
  });

  it('repetir un paquete conserva datos y una versión anterior no modifica D1', async () => {
    expect((await instalarPaquete(entorno.pool, paquete(), alcance)).resultado).toBe('repetido');
    expect((await instalarPaquete(entorno.pool, paquete(EVENTO, 37, 39), alcance)).resultado).toBe('retroceso');
    const row = await entorno.pool.query('SELECT version_permisos, permisos_recibidos_en FROM evento WHERE evento_id=$1', [EVENTO]);
    expect(Number(row.rows[0].version_permisos)).toBe(40);
    expect(row.rows[0].permisos_recibidos_en).toEqual(alcance.recibidoEn);
  });

  it('un fallo posterior a una alta revierte el paquete completo', async () => {
    const fallido = paquete(EVENTO, 40, 42);
    fallido.cambios = [
      { tipo: 'alta', version: 41, referencia: 'TA-ROLLBACK', zona: 'Norte' },
      { tipo: 'alta', version: 42, referencia: 'TA-NULO', zona: null as unknown as string },
    ];
    await expect(instalarPaquete(entorno.pool, fallido, alcance)).rejects.toThrow();
    expect((await entorno.pool.query('SELECT 1 FROM boleta WHERE referencia=$1', ['TA-ROLLBACK'])).rowCount).toBe(0);
    expect((await entorno.pool.query('SELECT 1 FROM permiso_version WHERE evento_id=$1 AND version=42', [EVENTO])).rowCount).toBe(0);
    expect(Number((await entorno.pool.query('SELECT version_permisos FROM evento WHERE evento_id=$1', [EVENTO])).rows[0].version_permisos)).toBe(40);
  });

  it('un paquete sin incremento refresca la antigüedad; un hueco y una referencia desconocida no alteran boletas', async () => {
    const vacio = paquete(EVENTO, 40, 40);
    vacio.cambios = [];
    vacio.puntos = [];
    const actualizado = new Date(alcance.recibidoEn.getTime() + 10_000);
    expect((await instalarPaquete(entorno.pool, vacio, { ...alcance, recibidoEn: actualizado })).resultado).toBe('sin-cambios');
    expect((await entorno.pool.query('SELECT permisos_recibidos_en FROM evento WHERE evento_id=$1', [EVENTO]))
      .rows[0].permisos_recibidos_en).toEqual(actualizado);
    expect((await instalarPaquete(entorno.pool, paquete(EVENTO, 39, 41), alcance)).resultado).toBe('hueco');

    const desconocido = paquete(EVENTO, 40, 41);
    desconocido.cambios = [{ tipo: 'anulacion', version: 41, referencia: 'TA-DESCONOCIDA',
      anuladaEn: instante.toISOString() }];
    expect(await instalarPaquete(entorno.pool, desconocido, alcance)).toMatchObject({
      resultado: 'instalado', cambiosAplicados: 0, anulaciones: 0,
    });
    expect((await entorno.pool.query('SELECT 1 FROM boleta WHERE referencia=$1', ['TA-DESCONOCIDA'])).rowCount).toBe(0);
  });

  it('anular una boleta consumida conserva el consumo y bloquea futuros ingresos', async () => {
    const reloj = { ahora: () => new Date(alcance.recibidoEn.getTime() + 20_000) };
    const motor = new ValidarPrimerIngreso({
      unidades: entorno.almacen.unidades, alcance: entorno.almacen.alcance,
      autoridad: new AutoridadNodoUnico('COORD-INT'), reloj,
    });
    const referencia = 'TA-8801-0011';
    expect((await motor.ejecutar(solicitud(referencia, { instanteLector: reloj.ahora() }))).decision).toBe('aceptado');
    const cancelacion = paquete(EVENTO, 41, 42);
    cancelacion.cambios = [{ tipo: 'anulacion', version: 42, referencia, anuladaEn: reloj.ahora().toISOString() }];
    expect((await instalarPaquete(entorno.pool, cancelacion, alcance)).anulaciones).toBe(1);
    expect((await entorno.pool.query('SELECT 1 FROM consumo WHERE evento_id=$1 AND referencia=$2',
      [EVENTO, referencia])).rowCount).toBe(1);
    expect((await motor.ejecutar(solicitud(referencia, { instanteLector: reloj.ahora() }))).motivo).toBe('BOLETA_ANULADA');
  });

  it('crea una instantánea de 5000 boletas en un evento nuevo por lotes', async () => {
    const nuevo = paquete('EVT-2026-03', 0, 1);
    nuevo.cambios = Array.from({ length: 5_000 }, (_, i) => ({
      tipo: 'alta' as const, version: 1, referencia: `TA-NEW-${i}`, zona: 'Norte',
    }));
    const resultado = await instalarPaquete(entorno.pool, nuevo, alcance);
    expect(resultado).toMatchObject({ resultado: 'instalado', cambiosAplicados: 5_000 });
    expect(Number((await entorno.pool.query('SELECT count(*) AS total FROM boleta WHERE evento_id=$1',
      [nuevo.eventoId])).rows[0].total)).toBe(5_000);
  });
});
