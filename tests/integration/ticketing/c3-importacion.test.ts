import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { IndiceVersiones, VersionBoleteria } from '@nexo/shared/contracts';
import { createD2Pool, migrate } from '../../../src/central-core/infrastructure/db/index.ts';
import {
  ServicioImportacionBoleteria,
  ServicioPermisos,
  type FuenteBoleteria,
} from '../../../src/central-core/modules/configuration-permissions/application/index.ts';
import {
  EventoConfigRepositorioPg,
  ImportacionesRepositorioPg,
  PermisosRepositorioPg,
  PuntoConfigRepositorioPg,
} from '../../../src/central-core/modules/configuration-permissions/infrastructure/index.ts';
import { dockerDisponible } from '../coordinator/entorno.ts';

const EVENTO = 'EVT-2026-02';
const EXTERNO = 'TA-FECHA-14';
const INSTANTE = '2026-09-25T20:00:00.000Z';

function version(numero: number, cambios: VersionBoleteria['cambios'], instantanea = false): VersionBoleteria {
  return { numero, eventoExterno: EXTERNO, publicadaEn: INSTANTE, instantanea, cambios };
}

class FuenteEnMemoria implements FuenteBoleteria {
  versiones: VersionBoleteria[] = [];
  async indice(): Promise<IndiceVersiones> {
    return {
      boleteria: 'TaquillaAndina',
      eventoExterno: EXTERNO,
      ultimaVersion: this.versiones.length - 1,
      versiones: this.versiones.map(v => ({ numero: v.numero, publicadaEn: v.publicadaEn, cambios: v.cambios.length })),
    };
  }
  async version(n: number) {
    const v = this.versiones[n];
    if (!v) throw new Error('404');
    return v;
  }
}

async function sembrarD2(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO m1_config_permisos.clientes (id, nombre) VALUES ('CLI-001', 'Cliente ficticio');
    INSERT INTO m1_config_permisos.recintos (id, cliente_id, nombre) VALUES ('REC-01', 'CLI-001', 'Estadio');
    INSERT INTO m1_config_permisos.eventos (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre, estado, version_permisos)
      VALUES ('${EVENTO}', 'REC-01', 'Fecha 14', 'F14', 'TaquillaAndina', now() - interval '1 hour', now() + interval '6 hours', 'abierto', 1);
    INSERT INTO m1_config_permisos.zonas (id, evento_id, nombre) VALUES
      ('Z-NORTE', '${EVENTO}', 'Norte'), ('Z-SUR', '${EVENTO}', 'Sur'), ('Z-PALCOS', '${EVENTO}', 'Palcos');
    INSERT INTO m1_config_permisos.puntos (id, evento_id, nombre, zona_id) VALUES ('P-01', '${EVENTO}', 'Puerta Norte 1', 'Z-NORTE');
    INSERT INTO m1_config_permisos.punto_zonas (evento_id, punto_id, zona_id) VALUES ('${EVENTO}', 'P-01', 'Z-NORTE');
    INSERT INTO m1_config_permisos.politicas (evento_id, version) VALUES ('${EVENTO}', 1);
    INSERT INTO m1_config_permisos.boletas (evento_id, referencia, zona_id, version) VALUES
      ('${EVENTO}', 'TA-8800-0000', 'Z-NORTE', 1), ('${EVENTO}', 'TA-8800-0005', 'Z-NORTE', 1);
  `);
}

describe.skipIf(!dockerDisponible)('C3 → D2 → P2 (importación de la boletería)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  const fuente = new FuenteEnMemoria();
  let c3: ServicioImportacionBoleteria;
  let p2: ServicioPermisos;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = createD2Pool({ ...process.env, D2_DATABASE_URL: contenedor.getConnectionUri() });
    await migrate(pool);
    await sembrarD2(pool);
    const eventos = new EventoConfigRepositorioPg(pool);
    c3 = new ServicioImportacionBoleteria(fuente, eventos, new ImportacionesRepositorioPg(pool), EXTERNO);
    p2 = new ServicioPermisos(eventos, new PuntoConfigRepositorioPg(pool), new PermisosRepositorioPg(pool), 'secreto-prueba');
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
    await contenedor?.stop();
  });

  it('la instantánea solo versiona lo que cambia y descarta datos del comprador', async () => {
    fuente.versiones.push(version(0, [
      { operacion: 'emision', referenciaExterna: 'TA-8800-0000', localidad: 'NORTE', instante: INSTANTE,
        comprador: { nombre: 'Comprador de prueba', documento: 'DOC-PRUEBA', correo: 'prueba@example.invalid' } },
      { operacion: 'emision', referenciaExterna: 'TA-8800-0005', localidad: 'NORTE', instante: INSTANTE },
      { operacion: 'emision', referenciaExterna: 'TA-8800-0100', localidad: 'SUR', instante: INSTANTE },
    ], true));
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'importado', versiones: [0], versionPermisos: 2, cambiosAplicados: 1 });
    const paquete = await p2.construirPaquete(EVENTO, 1);
    expect(paquete.cambios).toEqual([{ tipo: 'alta', version: 2, referencia: 'TA-8800-0100', zona: 'Sur' }]);
    const volcado = await pool.query(`SELECT row_to_json(b)::text AS t FROM m1_config_permisos.boletas b
      UNION ALL SELECT row_to_json(c)::text FROM m1_config_permisos.cambios_permisos c
      UNION ALL SELECT row_to_json(i)::text FROM m1_config_permisos.importaciones_boleteria i`);
    expect(volcado.rows.map(f => f.t).join('\n')).not.toMatch(/Comprador|DOC-PRUEBA|example\.invalid/);
  });

  it('una anulación en la boletería llega a P2 con el instante de emisión', async () => {
    const anuladaEn = '2026-09-25T20:05:00.000Z';
    fuente.versiones.push(version(1, [
      { operacion: 'anulacion', referenciaExterna: 'TA-8800-0005', localidad: 'NORTE', instante: anuladaEn },
    ]));
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'importado', versiones: [1], versionPermisos: 3 });
    const paquete = await p2.construirPaquete(EVENTO, 2);
    expect(paquete).toMatchObject({ desdeVersion: 2, hastaVersion: 3 });
    expect(paquete.cambios).toEqual([{ tipo: 'anulacion', version: 3, referencia: 'TA-8800-0005', anuladaEn }]);
    const { rows } = await pool.query(`SELECT anulada, anulacion_emitida_en, anulacion_recibida_en FROM m1_config_permisos.boletas
      WHERE evento_id = $1 AND referencia = 'TA-8800-0005'`, [EVENTO]);
    expect(rows[0].anulada).toBe(true);
    expect(rows[0].anulacion_emitida_en.toISOString()).toBe(anuladaEn);
    expect(rows[0].anulacion_recibida_en).not.toBeNull();
    const instantanea = await p2.construirPaquete(EVENTO, 0);
    expect(instantanea.cambios.map(c => c.referencia)).not.toContain('TA-8800-0005');
  });

  it('repetir la misma versión es idempotente y reanular no crea versiones', async () => {
    const importaciones = new ImportacionesRepositorioPg(pool);
    const v1 = fuente.versiones[1]!;
    const { huellaVersion } = await import('../../../src/central-core/modules/configuration-permissions/application/index.ts');
    const r = await importaciones.importar({
      eventoId: EVENTO, eventoExterno: EXTERNO, versionExterna: 1, huella: huellaVersion(v1), instantanea: false,
      cambios: [{ operacion: 'anulacion', referencia: 'TA-8800-0005', zonaId: 'Z-NORTE', instante: INSTANTE }], recibidoEn: new Date(),
    });
    expect(r).toMatchObject({ repetida: true, versionPermisosHasta: 3, cambiosAplicados: 0 });
    await expect(importaciones.importar({
      eventoId: EVENTO, eventoExterno: EXTERNO, versionExterna: 1, huella: 'f'.repeat(64), instantanea: false, cambios: [], recibidoEn: new Date(),
    })).rejects.toThrow(/otro contenido/);
    fuente.versiones.push(version(2, [
      { operacion: 'anulacion', referenciaExterna: 'TA-8800-0005', localidad: 'NORTE', instante: INSTANTE },
      { operacion: 'anulacion', referenciaExterna: 'TA-DESCONOCIDA', localidad: 'NORTE', instante: INSTANTE },
    ]));
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'importado', versiones: [2], versionPermisos: 3, cambiosAplicados: 0 });
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'al-dia', versionExterna: 2, versionPermisos: 3 });
  });

  it('una versión con una localidad desconocida no aplica nada (todo o nada)', async () => {
    fuente.versiones.push(version(3, [
      { operacion: 'emision', referenciaExterna: 'TA-8800-0200', localidad: 'SUR', instante: INSTANTE },
      { operacion: 'emision', referenciaExterna: 'TA-8800-0201', localidad: 'GRAMILLA', instante: INSTANTE },
    ]));
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'error' });
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM m1_config_permisos.boletas WHERE referencia = 'TA-8800-0200'`);
    expect(rows[0].n).toBe(0);
    expect((await pool.query('SELECT version_permisos FROM m1_config_permisos.eventos WHERE id = $1', [EVENTO])).rows[0].version_permisos).toBe(3);
    fuente.versiones.pop();
  });

  it('cambio de localidad y bitácora de importaciones solo de adición', async () => {
    fuente.versiones.push(version(3, [
      { operacion: 'cambio-localidad', referenciaExterna: 'TA-8800-0000', localidad: 'PALCOS', instante: INSTANTE },
    ]));
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'importado', versionPermisos: 4 });
    expect((await p2.construirPaquete(EVENTO, 3)).cambios).toEqual([{ tipo: 'cambio-zona', version: 4, referencia: 'TA-8800-0000', zona: 'Palcos' }]);
    await expect(pool.query('DELETE FROM m1_config_permisos.importaciones_boleteria')).rejects.toThrow(/solo de adicion/);
  });
});
