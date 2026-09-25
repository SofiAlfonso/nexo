import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { PaquetePermisos, type CambioPermiso } from '@nexo/shared/contracts';
import type { Pool } from 'pg';
import { canonicalizar } from '../../../../src/central-core/modules/configuration-permissions/application/firma.ts';
import { EventoPermisosNoEncontrado, ServicioPermisos, VersionPermisosInvalida } from '../../../../src/central-core/modules/configuration-permissions/application/servicio-permisos.ts';
import { registrarRutasPermisos } from '../../../../src/central-core/modules/configuration-permissions/api/index.ts';
import type { EventoConfigRepositorio, PermisosRepositorio, PuntoConfigRepositorio } from '../../../../src/central-core/modules/configuration-permissions/application/puertos.ts';
import type { EventoConfigurado } from '../../../../src/central-core/modules/configuration-permissions/domain/index.ts';
import { EventoConfigRepositorioPg, PermisosRepositorioPg, PuntoConfigRepositorioPg } from '../../../../src/central-core/modules/configuration-permissions/infrastructure/repositorios-pg.ts';

const evento: EventoConfigurado = {
  id: 'EVT-2026-02',
  nombre: 'Partido',
  nombreCorto: 'Partido',
  recinto: 'Estadio',
  boleteria: 'Taquilla',
  aperturaS: 3600,
  cierreS: 7200,
  aperturaEn: new Date(2026, 8, 25, 1).toISOString(),
  cierreEn: new Date(2026, 8, 25, 2).toISOString(),
  admisionesEstimadas: 15000,
  gratuito: false,
  estado: 'abierto',
  versionPermisos: 3,
  ultimoCambioRecibidoS: null,
  politicas: { version: 2, reingresoPermitido: true, reingresoTrasMin: 10, reingresoSuspendido: false },
};

const cambios: CambioPermiso[] = [
  { tipo: 'alta', version: 1, referencia: 'TA-001', zona: 'Norte' },
  { tipo: 'cambio-zona', version: 2, referencia: 'TA-001', zona: 'Sur' },
  { tipo: 'alta', version: 3, referencia: 'TA-002', zona: 'Norte' },
];

function crearFakes(actual: EventoConfigurado | null = evento) {
  const eventos: EventoConfigRepositorio = {
    obtenerEventoActual: async () => actual,
    obtenerVersionPermisosVigente: async () => 3,
  };
  const puntos: PuntoConfigRepositorio = {
    listarPuntosConfig: async () => [{ id: 'P-01', nombre: 'Puerta', zona: 'Sur', zonas: ['Sur'] }],
  };
  const permisos: PermisosRepositorio = {
    obtenerCambiosDesde: async (_id, desde, hasta) => ({
      hastaVersion: hasta,
      cambios: desde === 0
        ? [{ tipo: 'alta', version: 2, referencia: 'TA-001', zona: 'Sur' }, cambios[2]!]
        : cambios.filter(cambio => cambio.version > desde && cambio.version <= hasta),
    }),
  };
  const servicio = new ServicioPermisos(eventos, puntos, permisos, 'secreto-prueba', () => new Date('2026-09-25T15:00:00.000Z'));
  return { servicio };
}

describe('ServicioPermisos', () => {
  it('arma instantánea con políticas, puntos, vigencia y ventana de hoy', async () => {
    const { servicio } = crearFakes();
    const paquete = await servicio.construirPaquete(evento.id, 0);
    expect(PaquetePermisos.parse(paquete)).toEqual(paquete);
    expect(paquete).toMatchObject({
      tipo: 'instantanea',
      desdeVersion: 0,
      hastaVersion: 3,
      politicas: evento.politicas,
      puntos: [{ puntoId: 'P-01', zonas: ['Sur'] }],
      cambios: [
        { tipo: 'alta', version: 2, referencia: 'TA-001', zona: 'Sur' },
        { tipo: 'alta', version: 3, referencia: 'TA-002', zona: 'Norte' },
      ],
      emitidoEn: '2026-09-25T15:00:00.000Z',
      vigenteHasta: '2026-09-25T15:05:00.000Z',
    });
    const apertura = new Date(paquete.ventana.aperturaEn);
    const cierre = new Date(paquete.ventana.cierreEn);
    expect(apertura.getHours()).toBe(1);
    expect(cierre.getHours()).toBe(2);
    expect(apertura.getDate()).toBe(25);
  });

    describe('repositorios D2 de M1', () => {
      it('consulta el esquema real y convierte timestamps, zonas y políticas', async () => {
        const consultadas: string[] = [];
        const pool = {
          query: async (sql: string) => {
            consultadas.push(sql);
            if (sql.includes('JOIN m1_config_permisos.politicas')) {
              return { rows: [{
                id: evento.id, nombre: evento.nombre, nombre_corto: evento.nombreCorto,
                recinto: evento.recinto, boleteria: evento.boleteria,
                apertura: new Date(evento.aperturaEn), cierre: new Date(evento.cierreEn),
                admisiones_estimadas: evento.admisionesEstimadas, gratuito: false, estado: 'abierto',
                version_permisos: 3, ultimo_cambio_recibido: null,
                version_politicas: 2, reingreso_permitido: true,
                reingreso_tras_min: 10, reingreso_suspendido: false,
              }] };
            }
            if (sql.includes('m1_config_permisos.punto_zonas')) {
              return { rows: [{ id: 'P-01', nombre: 'Puerta', zona: 'Sur', zonas: ['Sur'] }] };
            }
            return { rows: [] };
          },
        } as unknown as Pool;
        const actual = await new EventoConfigRepositorioPg(pool).obtenerEventoActual();
        expect(actual).toMatchObject({
          aperturaS: 3600, cierreS: 7200, aperturaEn: evento.aperturaEn,
          cierreEn: evento.cierreEn, politicas: evento.politicas,
        });
        expect(await new PuntoConfigRepositorioPg(pool).listarPuntosConfig(evento.id)).toEqual([
          { id: 'P-01', nombre: 'Puerta', zona: 'Sur', zonas: ['Sur'] },
        ]);
        expect(consultadas.join(' ')).toContain('m1_config_permisos.recintos');
        expect(consultadas.join(' ')).toContain('m1_config_permisos.zonas');
      });

      it('lee instantánea de boletas e incrementos de cambios_permisos', async () => {
        const consultadas: Array<{ sql: string; parametros: unknown[] }> = [];
        const pool = {
          query: async (sql: string, parametros: unknown[]) => {
            consultadas.push({ sql, parametros });
            return sql.includes('m1_config_permisos.boletas')
              ? { rows: [{ version: 2, referencia: 'TA-001', zona: 'Sur' }] }
              : { rows: [{ operacion: 'anulacion', version: 3, referencia: 'TA-001', zona: null,
                recibido_en: new Date('2026-09-25T15:00:00.000Z') }] };
          },
        } as unknown as Pool;
        const repositorio = new PermisosRepositorioPg(pool);
        expect((await repositorio.obtenerCambiosDesde(evento.id, 0, 3)).cambios).toEqual([
          { tipo: 'alta', version: 2, referencia: 'TA-001', zona: 'Sur' },
        ]);
        expect((await repositorio.obtenerCambiosDesde(evento.id, 2, 3)).cambios).toEqual([
          { tipo: 'anulacion', version: 3, referencia: 'TA-001', anuladaEn: '2026-09-25T15:00:00.000Z' },
        ]);
        expect(consultadas[0]?.sql).toContain('NOT b.anulada AND NOT b.excluida');
        expect(consultadas[0]?.parametros).toEqual([evento.id, 3]);
        expect(consultadas[1]?.sql).toContain('m1_config_permisos.cambios_permisos');
        expect(consultadas[1]?.parametros).toEqual([evento.id, 2, 3]);
      });
    });

  describe('GET /v1/permisos', () => {
    it('devuelve paquete, 404 para otro evento y 400 para consulta inválida', async () => {
      const servidor = Fastify();
      registrarRutasPermisos(servidor, crearFakes().servicio);
      try {
        const correcto = await servidor.inject('/v1/permisos?eventoId=EVT-2026-02&desdeVersion=0');
        expect(correcto.statusCode).toBe(200);
        expect(PaquetePermisos.parse(correcto.json()).tipo).toBe('instantanea');
        const ausente = await servidor.inject('/v1/permisos?eventoId=EVT-2026-03&desdeVersion=0');
        expect(ausente.statusCode).toBe(404);
        expect(ausente.json()).toMatchObject({ error: 'NO_ENCONTRADO' });
        const invalido = await servidor.inject('/v1/permisos?eventoId=EVT-2026-02&desdeVersion=-1');
        expect(invalido.statusCode).toBe(400);
        expect(invalido.json()).toMatchObject({ error: 'SOLICITUD_INVALIDA' });
      } finally {
        await servidor.close();
      }
    });
  });

  it('entrega solo cambios posteriores y firma HMAC verificable sin firma en el contenido', async () => {
    const paquete = await crearFakes().servicio.construirPaquete(evento.id, 1);
    expect(paquete.tipo).toBe('cambios');
    expect(paquete.cambios).toEqual(cambios.slice(1));
    const { firma, ...contenido } = paquete;
    expect(firma.algoritmo).toBe('HMAC-SHA256');
    expect(firma.valor).toBe(createHmac('sha256', 'secreto-prueba').update(canonicalizar(contenido)).digest('base64url'));
    expect(canonicalizar({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
  });

  it('rechaza otro evento o ausencia de evento actual', async () => {
    await expect(crearFakes().servicio.construirPaquete('EVT-2026-03', 0)).rejects.toBeInstanceOf(EventoPermisosNoEncontrado);
    await expect(crearFakes(null).servicio.construirPaquete(evento.id, 0)).rejects.toBeInstanceOf(EventoPermisosNoEncontrado);
  });

  it('rechaza versiones futuras', async () => {
    await expect(crearFakes().servicio.construirPaquete(evento.id, 4)).rejects.toBeInstanceOf(VersionPermisosInvalida);
  });
});
