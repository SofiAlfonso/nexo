import { describe, expect, it } from 'vitest';
import { ServicioO2 } from '../../../src/central-core/application/o2/servicio-o2.ts';
import type { EventoConfigRepositorio, PuntoConfigRepositorio } from '../../../src/central-core/modules/configuration-permissions/application/index.ts';
import type { IncidenteRepositorio } from '../../../src/central-core/modules/evidence-ingestion/application/index.ts';
import type {
  AccionesRepositorio, ActividadRepositorio, BoletasRepositorio, EstadoOperativoRepositorio, IntentosRepositorio,
} from '../../../src/central-core/application/o2/puertos.ts';
import type { ConciliacionPuerto, PreparacionLeida, PreparacionRepositorio } from '../../../src/central-core/application/o2/puertos-preparacion.ts';

/** Prueba unitaria y rápida (sin Testcontainers) del guardián de negocio "controles pendientes
 * bloquean la apertura" y de la validación de `id` en `alternarControlPreparacion`. La ruta feliz
 * completa (con Postgres real) ya se cubre en tests/integration/central/c4-server.test.ts. */
function crearServicio(preparacionInicial: PreparacionLeida): { servicio: ServicioO2; escrituras: Array<{ id: string; ok: boolean }>; contadorConfirmaciones: { valor: number } } {
  const escrituras: Array<{ id: string; ok: boolean }> = [];
  const contadorConfirmaciones = { valor: 0 };
  let estado = preparacionInicial;

  const eventosConfig: EventoConfigRepositorio = {
    obtenerEventoActual: () => Promise.resolve({
      id: 'EVT-TEST', nombre: 'Evento de prueba', nombreCorto: 'Prueba', recinto: 'Recinto',
      boleteria: 'TaquillaAndina', aperturaS: 0, cierreS: 1,
      aperturaEn: new Date(2026, 0, 1).toISOString(), cierreEn: new Date(2026, 0, 1, 3).toISOString(),
      admisionesEstimadas: 0, gratuito: false, estado: 'preparacion', versionPermisos: 1,
      ultimoCambioRecibidoS: null,
      politicas: { version: 1, reingresoPermitido: false, reingresoTrasMin: 0, reingresoSuspendido: false },
    }),
    obtenerVersionPermisosVigente: () => Promise.resolve(1),
  };
  const preparacion: PreparacionRepositorio = {
    obtenerPreparacion: () => Promise.resolve(estado),
    alternarControl: (_eventoId, id, ok) => {
      escrituras.push({ id, ok });
      estado = { ...estado, controles: estado.controles.map(c => (c.id === id ? { ...c, ok } : c)) };
      return Promise.resolve();
    },
    confirmarApertura: () => {
      contadorConfirmaciones.valor += 1;
      estado = { ...estado, confirmada: true };
      return Promise.resolve();
    },
  };
  const vacio = () => Promise.reject(new Error('no debería llamarse en esta prueba'));
  const puntosConfig = { listarPuntosConfig: vacio } as unknown as PuntoConfigRepositorio;
  const operativo = { listarPuntos: vacio, obtenerPunto: vacio } as unknown as EstadoOperativoRepositorio;
  const incidentes = { listar: vacio, registrarAccion: vacio } as unknown as IncidenteRepositorio;
  const conciliacion = { obtenerConciliacion: vacio } as unknown as ConciliacionPuerto;
  const intentos = { listar: vacio } as unknown as IntentosRepositorio;
  const acciones = { listar: vacio, ejecutar: vacio } as unknown as AccionesRepositorio;
  const boletas = { obtener: vacio } as unknown as BoletasRepositorio;
  const actividad = { listar: vacio } as unknown as ActividadRepositorio;

  return {
    servicio: new ServicioO2(eventosConfig, puntosConfig, operativo, incidentes, preparacion, conciliacion, intentos, acciones, boletas, actividad),
    escrituras,
    contadorConfirmaciones,
  };
}

describe('ServicioO2 — preparación (controles y apertura)', () => {
  it('rechaza un id de control que no está en el enum de 6 controles', async () => {
    const { servicio } = crearServicio({ confirmada: false, controles: [] });
    const resultado = await servicio.alternarControlPreparacion('no-existe', true);
    expect(resultado).toBe('control-invalido');
  });

  it('alterna un control válido y refleja el cambio en la preparación compuesta', async () => {
    const { servicio, escrituras } = crearServicio({
      confirmada: false,
      controles: [{ id: 'permisos', titulo: 'Boletas y reglas verificadas', ok: false }],
    });
    const resultado = await servicio.alternarControlPreparacion('permisos', true);
    expect(escrituras).toEqual([{ id: 'permisos', ok: true }]);
    if (resultado === 'evento-no-encontrado' || resultado === 'control-invalido') throw new Error('resultado inesperado');
    expect(resultado.controles.find(c => c.id === 'permisos')?.ok).toBe(true);
  });

  it('bloquea confirmar apertura con "controles-pendientes" si algún control no está ok', async () => {
    const { servicio, contadorConfirmaciones } = crearServicio({
      confirmada: false,
      controles: [
        { id: 'permisos', titulo: 'Boletas y reglas verificadas', ok: true },
        { id: 'contingencia', titulo: 'Conectividad y contingencia acordadas', ok: false },
      ],
    });
    const resultado = await servicio.confirmarAperturaPreparacion();
    expect(resultado).toBe('controles-pendientes');
    expect(contadorConfirmaciones.valor).toBe(0);
  });

  it('bloquea confirmar apertura si no hay ningún control definido (evita el falso "0 de 0")', async () => {
    const { servicio } = crearServicio({ confirmada: false, controles: [] });
    const resultado = await servicio.confirmarAperturaPreparacion();
    expect(resultado).toBe('controles-pendientes');
  });

  it('confirma la apertura cuando todos los controles están ok', async () => {
    const { servicio } = crearServicio({
      confirmada: false,
      controles: [
        { id: 'permisos', titulo: 'Boletas y reglas verificadas', ok: true },
        { id: 'contingencia', titulo: 'Conectividad y contingencia acordadas', ok: true },
      ],
    });
    const resultado = await servicio.confirmarAperturaPreparacion();
    if (resultado === 'evento-no-encontrado' || resultado === 'controles-pendientes') throw new Error('resultado inesperado');
    expect(resultado.confirmada).toBe(true);
  });
});
