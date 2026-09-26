import { describe, expect, it } from 'vitest';
import type { IndiceVersiones, VersionBoleteria } from '@nexo/shared/contracts';
import type { EventoConfigurado } from '../domain/index.ts';
import { LocalidadDesconocida, normalizarLocalidad, traducirVersion } from '../domain/index.ts';
import {
  ConflictoImportacion,
  ServicioImportacionBoleteria,
  huellaVersion,
  type FuenteBoleteria,
  type ImportacionRegistrada,
  type ImportacionesRepositorio,
  type SolicitudImportacion,
} from './index.ts';
import type { EventoConfigRepositorio } from './puertos.ts';

const INSTANTE = '2026-09-25T20:00:00.000Z';
const zonas = new Map([['NORTE', 'Z-NORTE'], ['SUR', 'Z-SUR'], ['PALCOS', 'Z-PALCOS']]);

function version(numero: number, cambios: VersionBoleteria['cambios'], instantanea = false): VersionBoleteria {
  return { numero, eventoExterno: 'TA-FECHA-14', publicadaEn: INSTANTE, instantanea, cambios };
}

const v0 = version(0, [
  { operacion: 'emision', referenciaExterna: 'TA-1', localidad: 'NORTE', instante: INSTANTE,
    comprador: { nombre: 'Comprador de prueba', documento: 'DOC-PRUEBA', correo: 'prueba@example.invalid' } },
  { operacion: 'emision', referenciaExterna: 'TA-2', localidad: 'Sur', instante: INSTANTE },
], true);
const v1 = version(1, [{ operacion: 'anulacion', referenciaExterna: 'TA-1', localidad: 'NORTE', instante: INSTANTE }]);

const evento = { id: 'EVT-2026-02', boleteria: 'TaquillaAndina' } as EventoConfigurado;

function fuente(versiones: VersionBoleteria[], boleteria = 'TaquillaAndina'): FuenteBoleteria {
  return {
    async indice(): Promise<IndiceVersiones> {
      return {
        boleteria,
        eventoExterno: 'TA-FECHA-14',
        ultimaVersion: Math.max(...versiones.map(v => v.numero)),
        versiones: versiones.map(v => ({ numero: v.numero, publicadaEn: v.publicadaEn, cambios: v.cambios.length })),
      };
    },
    async version(n) {
      const v = versiones.find(x => x.numero === n);
      if (!v) throw new Error('404');
      return v;
    },
  };
}

class ImportacionesFalsas implements ImportacionesRepositorio {
  readonly aplicadas: SolicitudImportacion[] = [];
  async ultimaImportacion(): Promise<ImportacionRegistrada | null> {
    const u = this.aplicadas.at(-1);
    return u ? { eventoExterno: u.eventoExterno, versionExterna: u.versionExterna, huella: u.huella } : null;
  }
  async huellaImportada(_e: string, n: number) {
    return this.aplicadas.find(a => a.versionExterna === n)?.huella ?? null;
  }
  async zonasPorLocalidad() {
    return zonas;
  }
  async importar(s: SolicitudImportacion) {
    this.aplicadas.push(s);
    return { repetida: false, versionPermisosDesde: 0, versionPermisosHasta: this.aplicadas.length, cambiosAplicados: s.cambios.length };
  }
}

const eventos: EventoConfigRepositorio = {
  obtenerEventoActual: async () => evento,
  obtenerVersionPermisosVigente: async () => 7,
};

describe('C3: traducción P1 → modelo canónico', () => {
  it('traduce localidades a zonas y descarta al comprador', () => {
    const cambios = traducirVersion(v0, zonas);
    expect(cambios).toEqual([
      { operacion: 'emision', referencia: 'TA-1', zonaId: 'Z-NORTE', instante: INSTANTE },
      { operacion: 'emision', referencia: 'TA-2', zonaId: 'Z-SUR', instante: INSTANTE },
    ]);
    expect(JSON.stringify(cambios)).not.toMatch(/Comprador|DOC-PRUEBA|example\.invalid/);
  });

  it('cambio-localidad se traduce a cambio-zona y una localidad desconocida falla', () => {
    const v = version(2, [{ operacion: 'cambio-localidad', referenciaExterna: 'TA-2', localidad: 'palcos', instante: INSTANTE }]);
    expect(traducirVersion(v, zonas)[0]).toMatchObject({ operacion: 'cambio-zona', zonaId: 'Z-PALCOS' });
    const mala = version(3, [{ operacion: 'emision', referenciaExterna: 'TA-9', localidad: 'GRAMILLA', instante: INSTANTE }]);
    expect(() => traducirVersion(mala, zonas)).toThrow(LocalidadDesconocida);
  });

  it('normaliza tildes y mayúsculas', () => {
    expect(normalizarLocalidad('  Tribuna  Oriental ')).toBe('TRIBUNA ORIENTAL');
    expect(normalizarLocalidad('Ñandú Sur')).toBe('NANDU SUR');
  });

  it('la huella ignora comprador y publicadaEn', () => {
    const sinComprador = version(0, v0.cambios.map(({ comprador: _c, ...c }) => c), true);
    expect(huellaVersion({ ...sinComprador, publicadaEn: '2030-01-01T00:00:00.000Z' })).toBe(huellaVersion(v0));
    expect(huellaVersion(v1)).not.toBe(huellaVersion(v0));
  });
});

describe('C3: sincronización con la boletería', () => {
  it('importa las versiones pendientes en orden y luego queda al día', async () => {
    const repo = new ImportacionesFalsas();
    const servicio = new ServicioImportacionBoleteria(fuente([v1, v0]), eventos, repo, 'TA-FECHA-14');
    const r = await servicio.sincronizar();
    expect(r).toMatchObject({ resultado: 'importado', versiones: [0, 1], cambiosAplicados: 3 });
    expect(repo.aplicadas.map(a => a.versionExterna)).toEqual([0, 1]);
    expect(await servicio.sincronizar()).toMatchObject({ resultado: 'al-dia', versionExterna: 1, versionPermisos: 7 });
  });

  it('solo importa lo nuevo cuando la boletería publica una anulación', async () => {
    const repo = new ImportacionesFalsas();
    const versiones = [v0];
    const servicio = new ServicioImportacionBoleteria(fuente(versiones), eventos, repo, 'TA-FECHA-14');
    await servicio.sincronizar();
    versiones.push(v1);
    expect(await servicio.sincronizar()).toMatchObject({ resultado: 'importado', versiones: [1] });
    expect(repo.aplicadas[1]?.cambios).toEqual([{ operacion: 'anulacion', referencia: 'TA-1', zonaId: 'Z-NORTE', instante: INSTANTE }]);
  });

  it('detecta una boletería reiniciada que reescribe versiones ya importadas', async () => {
    const repo = new ImportacionesFalsas();
    await new ServicioImportacionBoleteria(fuente([v0, v1]), eventos, repo, 'TA-FECHA-14').sincronizar();
    const reescrita = version(1, [{ operacion: 'anulacion', referenciaExterna: 'TA-2', localidad: 'SUR', instante: INSTANTE }]);
    const r = await new ServicioImportacionBoleteria(fuente([v0, reescrita]), eventos, repo, 'TA-FECHA-14').sincronizar();
    expect(r).toMatchObject({ resultado: 'conflicto' });
    const retroceso = await new ServicioImportacionBoleteria(fuente([v0]), eventos, repo, 'TA-FECHA-14').sincronizar();
    expect(retroceso).toMatchObject({ resultado: 'conflicto' });
    expect(repo.aplicadas).toHaveLength(2);
  });

  it('rechaza otra boletería o evento externo y no importa nada', async () => {
    const repo = new ImportacionesFalsas();
    expect(await new ServicioImportacionBoleteria(fuente([v0], 'OtraTaquilla'), eventos, repo, 'TA-FECHA-14').sincronizar())
      .toMatchObject({ resultado: 'conflicto' });
    expect(await new ServicioImportacionBoleteria(fuente([v0]), eventos, repo, 'TA-OTRO').sincronizar())
      .toMatchObject({ resultado: 'conflicto' });
    expect(repo.aplicadas).toHaveLength(0);
  });

  it('una boletería caída se informa como error sin lanzar', async () => {
    const caida: FuenteBoleteria = { indice: async () => { throw new Error('ECONNREFUSED'); }, version: async () => v0 };
    const r = await new ServicioImportacionBoleteria(caida, eventos, new ImportacionesFalsas(), 'TA-FECHA-14').sincronizar();
    expect(r).toEqual({ resultado: 'error', mensaje: 'ECONNREFUSED' });
  });

  it('sin evento actual no consulta la boletería', async () => {
    const sinEvento: EventoConfigRepositorio = { ...eventos, obtenerEventoActual: async () => null };
    const r = await new ServicioImportacionBoleteria(fuente([v0]), sinEvento, new ImportacionesFalsas(), 'TA-FECHA-14').sincronizar();
    expect(r).toEqual({ resultado: 'sin-evento' });
  });

  it('ConflictoImportacion es un Error con nombre propio', () => {
    expect(new ConflictoImportacion('x').name).toBe('ConflictoImportacion');
  });
});
