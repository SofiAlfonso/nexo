import pg from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOTIVO_TEXTO } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { crearApp, type AppC4 } from '../../../src/central-core/api/server.ts';
import { createD2Pool, migrate } from '../../../src/central-core/infrastructure/db/index.ts';
import { iniciarAdaptadorBoleteria, type AdaptadorBoleteria } from '../../../src/central-core/modules/configuration-permissions/api/index.ts';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import type { Almacen } from '../../../src/local-coordinator/application/puertos.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor as crearServidorC2 } from '../../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { crearSincronizadorPermisos } from '../../../src/local-coordinator/infrastructure/permisos/index.ts';
import { crearAlmacenPostgres } from '../../../src/local-coordinator/infrastructure/persistence/postgres/almacen-postgres.ts';
import { crearServidor as crearServidorBoleteria } from '../../../src/ticketing-sim/api/servidor.ts';
import { Boleteria } from '../../../src/ticketing-sim/domain/boleteria.ts';
import { dockerDisponible } from '../coordinator/entorno.ts';

/**
 * Criterio de T23: una anulación hecha en la boletería llega a C2 por P1 → C3 → D2 → P2 → D1 y la
 * boleta se rechaza con "Boleta anulada por la boletería". Antes de que C2 instale la versión, la
 * anulación está en tránsito (ventana RN-06) y C2 decide con lo que tiene.
 */
const EVENTO = 'EVT-2026-02';
const SECRETO = 'secreto-prueba-extremo';
const silencio = { info: () => undefined, warn: () => undefined, error: () => undefined };
const config = cargarConfig({ EVENTO_ID: EVENTO, COORDINADOR_ID: 'C2-P2' });

async function sembrarD2(pool: pg.Pool): Promise<void> {
  await pool.query(`
    INSERT INTO m1_config_permisos.clientes (id, nombre) VALUES ('CLI-001', 'Cliente ficticio');
    INSERT INTO m1_config_permisos.recintos (id, cliente_id, nombre) VALUES ('REC-01', 'CLI-001', 'Estadio');
    INSERT INTO m1_config_permisos.eventos (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre, estado, version_permisos)
      VALUES ('${EVENTO}', 'REC-01', 'Fecha 14', 'F14', 'TaquillaAndina', now() - interval '1 hour', now() + interval '6 hours', 'abierto', 0);
    INSERT INTO m1_config_permisos.zonas (id, evento_id, nombre) VALUES ('Z-NORTE', '${EVENTO}', 'Norte'), ('Z-SUR', '${EVENTO}', 'Sur');
    INSERT INTO m1_config_permisos.puntos (id, evento_id, nombre, zona_id) VALUES ('P-01', '${EVENTO}', 'Puerta Norte 1', 'Z-NORTE');
    INSERT INTO m1_config_permisos.punto_zonas (evento_id, punto_id, zona_id) VALUES ('${EVENTO}', 'P-01', 'Z-NORTE');
    INSERT INTO m1_config_permisos.politicas (evento_id, version) VALUES ('${EVENTO}', 1);
  `);
}

describe.skipIf(!dockerDisponible)('Anulación de punta a punta: boletería → C3 → P2 → C2', () => {
  let d1: StartedPostgreSqlContainer;
  let d2: StartedPostgreSqlContainer;
  let poolD1: pg.Pool;
  let poolD2: pg.Pool;
  let boleteria: FastifyInstance;
  let urlBoleteria: string;
  let c4: AppC4;
  let c3: AdaptadorBoleteria;
  let p2: ReturnType<typeof crearSincronizadorPermisos>;
  let almacen: Almacen;
  let c2: FastifyInstance;
  let secuencia = 0;

  async function validar(codigo: string) {
    const r = await c2.inject({
      method: 'POST', url: '/v1/validaciones',
      payload: {
        idOrigen: `LX-E2E:${Date.now()}:${++secuencia}`, eventoId: EVENTO, lectorId: 'LX-E2E', puntoId: 'P-01',
        codigo, proposito: 'ingreso', zonaSolicitada: 'Norte', instanteLector: new Date().toISOString(),
      },
    });
    expect(r.statusCode).toBe(200);
    return r.json() as { decision: string; motivo: string };
  }

  async function anularEnBoleteria(referencia: string) {
    const r = await fetch(`${urlBoleteria}/admin/anulaciones`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ referencia }),
    });
    expect(r.status).toBe(201);
  }

  beforeAll(async () => {
    [d1, d2] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new PostgreSqlContainer('postgres:16-alpine').start(),
    ]);
    poolD2 = createD2Pool({ ...process.env, D2_DATABASE_URL: d2.getConnectionUri() });
    await migrate(poolD2);
    await sembrarD2(poolD2);

    const sim = new Boleteria({
      emisiones: ['0001', '0002', '0003', '0004'].map(n => ({ referencia: `TA-9000-${n}`, localidad: 'NORTE' as const })),
    });
    boleteria = crearServidorBoleteria({ boleteria: sim, adminToken: null, logger: false });
    urlBoleteria = await boleteria.listen({ host: '127.0.0.1', port: 0 });

    process.env.PERMISOS_FIRMA_SECRETO = SECRETO;
    c4 = crearApp(poolD2);
    const urlC4 = await c4.fastify.listen({ host: '127.0.0.1', port: 0 });
    // Intervalo largo: la prueba dispara cada ciclo para observar la ventana entre saltos.
    c3 = iniciarAdaptadorBoleteria(poolD2, { url: urlBoleteria, eventoExterno: 'TA-FECHA-14', intervaloMs: 3_600_000 }, silencio);

    poolD1 = new pg.Pool({ connectionString: d1.getConnectionUri(), max: 5 });
    poolD1.on('error', () => undefined);
    almacen = await crearAlmacenPostgres(null, { eventoId: EVENTO, pool: poolD1, migrar: true });
    p2 = crearSincronizadorPermisos({
      postgres: { host: d1.getHost(), port: d1.getPort(), database: d1.getDatabase(), user: d1.getUsername(), password: d1.getPassword() },
      centralUrl: urlC4, eventoId: EVENTO, clienteId: 'CLI-001', boleteriaId: 'BOL-01', recintoId: 'REC-01',
      secreto: SECRETO, intervaloMs: 3_600_000, log: silencio,
    });
    const reloj = { ahora: () => new Date() };
    const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
      unidades: almacen.unidades, alcance: almacen.alcance, autoridad: new AutoridadNodoUnico(config.coordinadorId), reloj,
    }), new ContadorV1(), config, reloj);
    c2 = crearServidorC2({ servicio, almacen, latidos: new RegistroLatidos(), config, reloj });
  }, 240_000);

  afterAll(async () => {
    delete process.env.PERMISOS_FIRMA_SECRETO;
    await c2?.close();
    await p2?.cerrar();
    await almacen?.cerrar();
    await poolD1?.end().catch(() => undefined);
    await c3?.detener();
    c4?.cerrar();
    await c4?.fastify.close();
    await poolD2?.end().catch(() => undefined);
    await boleteria?.close();
    await Promise.all([d1?.stop(), d2?.stop()]);
  });

  it('C2 recibe la instantánea firmada y acepta una boleta vigente', async () => {
    // El adaptador ya lanzó su primer ciclo al iniciar; este espera o repite sin duplicar.
    expect(await c3.sincronizar()).toMatchObject({ versionPermisos: 4 });
    expect(await p2.sincronizador.sincronizar()).toMatchObject({ resultado: 'instalado', versionInstalada: 4 });
    // El lector es configuración del recinto (no viaja en P2).
    await poolD1.query(`INSERT INTO lector (evento_id, lector_id, punto_id) VALUES ($1, 'LX-E2E', 'P-01')`, [EVENTO]);
    expect(await validar('TA-9000-0001')).toMatchObject({ decision: 'aceptado' });
    expect(p2.sincronizador.estado(new Date())).toMatchObject({ versionInstalada: 4, ultimoError: null });
  });

  it('una anulación en tránsito no afecta a C2 hasta que instala la versión (RN-06)', async () => {
    await anularEnBoleteria('TA-9000-0002');
    expect(await c3.sincronizar()).toMatchObject({ resultado: 'importado', versionPermisos: 5 });
    // D2 ya conoce la anulación, pero C2 todavía no: decide con sus permisos instalados.
    expect(await validar('TA-9000-0002')).toMatchObject({ decision: 'aceptado' });
    expect(await p2.sincronizador.sincronizar()).toMatchObject({ resultado: 'instalado', versionInstalada: 5 });
  });

  it('la anulación hecha en la boletería llega a C2 y la boleta se rechaza', async () => {
    await anularEnBoleteria('TA-9000-0003');
    await c3.sincronizar();
    expect(await p2.sincronizador.sincronizar()).toMatchObject({ resultado: 'instalado', versionInstalada: 6 });
    const r = await validar('TA-9000-0003');
    expect(r).toMatchObject({ decision: 'rechazado', motivo: 'BOLETA_ANULADA' });
    expect(MOTIVO_TEXTO[r.motivo as keyof typeof MOTIVO_TEXTO]).toBe('Boleta anulada por la boletería');
    // La boleta consumida en la ventana conserva su consumo: la anulación solo rige hacia adelante.
    const { rows } = await poolD1.query(`SELECT count(*)::int AS n FROM consumo WHERE referencia = 'TA-9000-0002'`);
    expect(rows[0].n).toBe(1);
  });

  it('sin cambios nuevos, C2 renueva la antigüedad de permisos sin crear versiones', async () => {
    const antes = await poolD1.query('SELECT permisos_recibidos_en FROM evento WHERE evento_id = $1', [EVENTO]);
    expect(await p2.sincronizador.sincronizar()).toMatchObject({ resultado: 'sin-cambios', versionInstalada: 6 });
    const despues = await poolD1.query('SELECT permisos_recibidos_en FROM evento WHERE evento_id = $1', [EVENTO]);
    expect(despues.rows[0].permisos_recibidos_en.getTime()).toBeGreaterThanOrEqual(antes.rows[0].permisos_recibidos_en.getTime());
    const versiones = await poolD1.query('SELECT count(*)::int AS n FROM permiso_version WHERE evento_id = $1', [EVENTO]);
    expect(versiones.rows[0].n).toBe(3);
  });
});
