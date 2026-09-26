/**
 * Operación de C2 (PU-05-02): reemplaza el lector de un punto y solicita revocar su credencial.
 *
 *   node src/local-coordinator/infrastructure/cli/reemplazar-lector.ts \
 *     --punto P-01 --anterior LEC-001 --nuevo LEC-002 [--motivo lost|compromised|retired] \
 *     [--certs-script scripts/certs.mjs] [--store NOMBRE]
 *   node src/local-coordinator/infrastructure/cli/reemplazar-lector.ts --pendientes [--certs-script ...]
 *
 * Usa la misma configuración de D1 y `COORDINATOR_TLS_REVOKED_FILE` que C2. Sin `--certs-script`
 * la solicitud queda pendiente hasta que el custodio de la CA ejecute `scripts/certs.mjs revoke`.
 */
import { parseArgs } from 'node:util';
import { cargarConfig } from '../../config.ts';
import { ReemplazarLector } from '../../application/reemplazo-lector.ts';
import type { MotivoRevocacion } from '../../application/puertos.ts';
import { RevocadorCertsMjs } from '../credenciales/revocador-certs.ts';
import { crearPoolD1 } from '../persistence/postgres/almacen-postgres.ts';
import { RepositorioAsignacionesPg } from '../persistence/postgres/asignaciones-postgres.ts';

const { values } = parseArgs({
  options: {
    punto: { type: 'string' }, anterior: { type: 'string' }, nuevo: { type: 'string' },
    motivo: { type: 'string', default: 'retired' }, pendientes: { type: 'boolean', default: false },
    'certs-script': { type: 'string' }, store: { type: 'string' },
  },
  strict: true,
});

const config = cargarConfig(process.env);
const revokedPath = config.tls?.revokedPath ?? process.env.COORDINATOR_TLS_REVOKED_FILE;
if (!config.postgres) throw new Error('El reemplazo de lectores requiere D1 en PostgreSQL');
if (!revokedPath) throw new Error('COORDINATOR_TLS_REVOKED_FILE es obligatorio');

const pool = crearPoolD1(config.postgres, 5_000, 2);
try {
  const caso = new ReemplazarLector({
    asignaciones: new RepositorioAsignacionesPg(pool),
    revocador: new RevocadorCertsMjs({ revokedPath, certsScript: values['certs-script'], store: values.store }),
    reloj: { ahora: () => new Date() },
  });
  const resultado = values.pendientes
    ? await caso.revocarPendientes(config.eventoId)
    : await caso.ejecutar({
      eventoId: config.eventoId, puntoId: values.punto ?? '', lectorAnterior: values.anterior ?? '',
      lectorNuevo: values.nuevo ?? '', motivo: values.motivo as MotivoRevocacion,
    });
  console.log(JSON.stringify(resultado, null, 2));
  const pendiente = Array.isArray(resultado)
    ? resultado.some((r) => r.estado === 'pendiente')
    : resultado.revocacion.estado === 'pendiente';
  if (pendiente) process.exitCode = 2;
} finally {
  await pool.end();
}
