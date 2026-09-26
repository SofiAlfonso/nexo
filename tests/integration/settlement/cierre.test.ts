import argon2 from 'argon2';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOMBRE_COOKIE_SESION } from '@nexo/shared/contracts';
import { createD2Pool, migrate } from '../../../src/central-core/infrastructure/db/index.ts';
import { crearApp, type AppC4 } from '../../../src/central-core/api/server.ts';

const EVENTO_ID = 'EVT-2025-05';
const RECINTO_ID = 'REC-05';
const CLIENTE_ID = 'cli-5';

/**
 * Cubre el "reemplaza los 501" de T22/M3: las 4 rutas de cierre (`/api/cierre/*`) contra
 * Postgres real, incluyendo las migraciones 010/011 (detalle de liquidación y diferencias) y el
 * flujo completo preliminar → resolver diferencia → definitivo → cobro, más el control de roles.
 */
describe('C4 - rutas de cierre (#/cierre): conciliación y liquidación (M3/M4)', () => {
  let contenedor: StartedPostgreSqlContainer;
  let pool: Pool;
  let app: AppC4;

  beforeAll(async () => {
    contenedor = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = createD2Pool({ ...process.env, D2_DATABASE_URL: contenedor.getConnectionUri() });
    await migrate(pool);
    await sembrarDatos(pool);
    app = crearApp(pool);
    await app.fastify.ready();
  }, 180_000);

  afterAll(async () => {
    app.cerrar();
    await app.fastify.close();
    await pool.end();
    await contenedor.stop();
  });

  it('rechaza el preliminar para un rol distinto de CIERRE', async () => {
    const cookie = await iniciarSesion(app, 'supervisor1', 'clave-prueba-123');
    const respuesta = await app.fastify.inject({ method: 'POST', url: '/api/cierre/preliminar', cookies: cookie, payload: {} });
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().error).toBe('NO_AUTORIZADO');
  });

  it('rechaza rutas de cierre sin sesión', async () => {
    const respuesta = await app.fastify.inject({ method: 'POST', url: '/api/cierre/preliminar', payload: {} });
    expect(respuesta.statusCode).toBe(401);
  });

  it('entrega el preliminar y reporta la diferencia de anulación detectada', async () => {
    const cookie = await iniciarSesion(app, 'cierre1', 'clave-prueba-123');
    const respuesta = await app.fastify.inject({ method: 'POST', url: '/api/cierre/preliminar', cookies: cookie, payload: {} });
    expect(respuesta.statusCode).toBe(200);
    const conciliacion = respuesta.json() as {
      estado: string; diferencias: Array<{ id: string; tipo: string; estado: string; opciones: Array<{ id: string }> }>;
    };
    expect(conciliacion.estado).toBe('preliminar');
    expect(conciliacion.diferencias).toHaveLength(1);
    expect(conciliacion.diferencias[0]?.tipo).toBe('anulacion');
    expect(conciliacion.diferencias[0]?.estado).toBe('abierta');
  });

  it('bloquea el cierre definitivo mientras queden diferencias abiertas', async () => {
    const cookie = await iniciarSesion(app, 'cierre1', 'clave-prueba-123');
    const respuesta = await app.fastify.inject({ method: 'POST', url: '/api/cierre/definitivo', cookies: cookie, payload: {} });
    expect(respuesta.statusCode).toBe(409);
    const cuerpo = respuesta.json() as { error: string; detalles: { pendientes: string[] } };
    expect(cuerpo.error).toBe('CONFLICTO_ESTADO');
    expect(cuerpo.detalles.pendientes).toContain('diferencias-resueltas');
  });

  it('resuelve la diferencia excluyendo la boleta del cobro y permite el cierre definitivo', async () => {
    const cookie = await iniciarSesion(app, 'cierre1', 'clave-prueba-123');
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM m3_conciliacion.diferencias WHERE evento_id = $1 AND estado = 'pendiente'`,
      [EVENTO_ID],
    );
    const diferenciaId = rows[0]?.id;
    expect(diferenciaId).toBeDefined();

    const resolver = await app.fastify.inject({
      method: 'POST', url: `/api/cierre/diferencias/${diferenciaId}`, cookies: cookie, payload: { opcion: 'excluir-del-cobro' },
    });
    expect(resolver.statusCode).toBe(200);
    const trasResolver = resolver.json() as { diferencias: Array<{ estado: string }> };
    expect(trasResolver.diferencias[0]?.estado).toBe('resuelta');

    const boleta = await pool.query<{ excluida: boolean }>(
      `SELECT excluida FROM m1_config_permisos.boletas WHERE evento_id = $1 AND referencia = 'BOL-0001'`,
      [EVENTO_ID],
    );
    expect(boleta.rows[0]?.excluida).toBe(true);

    const definitivo = await app.fastify.inject({ method: 'POST', url: '/api/cierre/definitivo', cookies: cookie, payload: {} });
    expect(definitivo.statusCode).toBe(200);
    expect(definitivo.json().estado).toBe('conciliado');
  });

  it('responde 404 al resolver una diferencia inexistente (D12)', async () => {
    const cookie = await iniciarSesion(app, 'cierre1', 'clave-prueba-123');
    const respuesta = await app.fastify.inject({
      method: 'POST', url: '/api/cierre/diferencias/DIF-999', cookies: cookie, payload: { opcion: 'excluir-del-cobro' },
    });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json().error).toBe('NO_ENCONTRADO');
  });

  it('rechaza el cobro para un rol distinto de FINANZAS, y lo acepta para FINANZAS', async () => {
    const cookieCierre = await iniciarSesion(app, 'cierre1', 'clave-prueba-123');
    const rechazo = await app.fastify.inject({ method: 'POST', url: '/api/cierre/cobro', cookies: cookieCierre, payload: {} });
    expect(rechazo.statusCode).toBe(403);

    const cookieFinanzas = await iniciarSesion(app, 'finanzas1', 'clave-prueba-123');
    const respuesta = await app.fastify.inject({ method: 'POST', url: '/api/cierre/cobro', cookies: cookieFinanzas, payload: {} });
    expect(respuesta.statusCode).toBe(200);
    const conciliacion = respuesta.json() as { saldoCobrado: boolean };
    expect(conciliacion.saldoCobrado).toBe(true);

    const repetido = await app.fastify.inject({ method: 'POST', url: '/api/cierre/cobro', cookies: cookieFinanzas, payload: {} });
    expect(repetido.statusCode).toBe(409);
  });
});

async function iniciarSesion(app: AppC4, usuario: string, contrasena: string): Promise<Record<string, string>> {
  const respuesta = await app.fastify.inject({
    method: 'POST', url: '/api/auth/login', payload: { usuario, contrasena },
  });
  const cookie = respuesta.cookies.find((c) => c.name === NOMBRE_COOKIE_SESION);
  if (!cookie) throw new Error(`Login de prueba (${usuario}) no devolvió cookie de sesión`);
  return { [cookie.name]: cookie.value };
}

async function sembrarDatos(pool: Pool): Promise<void> {
  const contrasenaHash = await argon2.hash('clave-prueba-123');
  for (const [usuario, rol] of [
    ['supervisor1', 'SUPERVISOR'], ['cierre1', 'CIERRE'], ['finanzas1', 'FINANZAS'],
  ] as const) {
    await pool.query('INSERT INTO auth.operadores (usuario, nombre, rol, contrasena_hash) VALUES ($1, $2, $3, $4)', [
      usuario, `Operadora ${rol}`, rol, contrasenaHash,
    ]);
  }

  await pool.query('INSERT INTO m1_config_permisos.clientes (id, nombre) VALUES ($1, $2)', [CLIENTE_ID, 'Cliente de prueba']);
  await pool.query('INSERT INTO m1_config_permisos.recintos (id, cliente_id, nombre) VALUES ($1, $2, $3)', [
    RECINTO_ID, CLIENTE_ID, 'Recinto de prueba',
  ]);
  await pool.query(
    `INSERT INTO m1_config_permisos.eventos
       (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre, admisiones_estimadas, estado)
     VALUES ($1, $2, $3, $4, $5, now() - interval '5 hours', now() - interval '1 hour', 0, 'cerrado')`,
    [EVENTO_ID, RECINTO_ID, 'Evento de prueba', 'Prueba', 'boleteria-sim'],
  );
  await pool.query('INSERT INTO m1_config_permisos.zonas (id, evento_id, nombre) VALUES ($1, $2, $3)', [
    'GENERAL', EVENTO_ID, 'General',
  ]);
  await pool.query(
    `INSERT INTO m1_config_permisos.puntos (id, evento_id, nombre, zona_id, estado) VALUES ($1, $2, $3, $4, 'en-linea')`,
    ['P-01', EVENTO_ID, 'Puerta 1', 'GENERAL'],
  );
  await pool.query(
    'INSERT INTO m1_config_permisos.boletas (evento_id, referencia, zona_id, version) VALUES ($1, $2, $3, 0)',
    [EVENTO_ID, 'BOL-0001', 'GENERAL'],
  );

  // Condiciones de cierre (prototipo §9) satisfechas salvo la diferencia que se detecta abajo.
  await pool.query(
    `INSERT INTO m2_evidencia.puntos_estado (evento_id, punto_id, estado, pendientes_diario)
     VALUES ($1, $2, 'en-linea', 0)`,
    [EVENTO_ID, 'P-01'],
  );
  await pool.query(
    `INSERT INTO m2_evidencia.eventos_estado (evento_id, coordinador_estado, enlace_en_linea, outbox_pendientes)
     VALUES ($1, 'operando', true, 0)`,
    [EVENTO_ID],
  );

  // Decisión única de D2 (una admisión aceptada) y su anulación tardía: dispara la diferencia
  // de anulación (prototipo §9: "la boleta fue aceptada antes de recibir su anulación").
  await pool.query(
    `INSERT INTO m2_evidencia.lotes (id_lote, evento_id, recinto_id, coordinador_id, emitido_en, contenido_hash, acuse)
     VALUES ('LOTE-1', $1, $2, 'coord-1', now() - interval '30 minutes', 'hash-lote', '{}'::jsonb)`,
    [EVENTO_ID, RECINTO_ID],
  );
  const { rows: evidencia } = await pool.query<{ id: number }>(
    `INSERT INTO m2_evidencia.evidencias (id_lote, evento_id, tipo, id_origen, contenido_hash, contenido, ocurrido_en)
     VALUES ('LOTE-1', $1, 'decision', 'dec-bol-0001', 'hash-dec', '{}'::jsonb, now() - interval '20 minutes')
     RETURNING id`,
    [EVENTO_ID],
  );
  await pool.query(
    `INSERT INTO m2_evidencia.decisiones
       (evidencia_id, evento_id, id_origen, referencia, punto_id, instante_decision, decision, motivo, proposito, admision)
     VALUES ($1, $2, 'dec-bol-0001', 'BOL-0001', 'P-01', now() - interval '20 minutes', 'aceptado', 'PERMISO_VIGENTE', 'ingreso', true)`,
    [evidencia[0]?.id, EVENTO_ID],
  );
  await pool.query(
    `UPDATE m1_config_permisos.boletas SET anulacion_recibida_en = now() WHERE evento_id = $1 AND referencia = 'BOL-0001'`,
    [EVENTO_ID],
  );

  // Contrato de liquidación (M4) para que el cobro pueda calcular y guardar la liquidación.
  await pool.query(
    `INSERT INTO m4_liquidacion.contratos (id, cliente_id, tarifa_por_admision, minimo, moneda)
     VALUES ('CTR-1', $1, 500, 0, 'USD')`,
    [CLIENTE_ID],
  );
  await pool.query(
    'INSERT INTO m4_liquidacion.contrato_eventos (contrato_id, evento_id) VALUES ($1, $2)',
    ['CTR-1', EVENTO_ID],
  );
}
