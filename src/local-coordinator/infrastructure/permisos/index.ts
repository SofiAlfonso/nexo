import pg from 'pg';
import type { ConfigCoordinador } from '../../config.ts';
import { crearClienteP2Http } from './cliente-p2.ts';
import { instalarPaquete } from './instalador-d1.ts';
import { SincronizadorPermisos } from './sincronizador.ts';

export { canonicalizar, verificarFirma } from './firma.ts';
export { crearClienteP2Http, ErrorP2 } from './cliente-p2.ts';
export { instalarPaquete } from './instalador-d1.ts';
export type { ResultadoInstalacion } from './instalador-d1.ts';
export { SincronizadorPermisos } from './sincronizador.ts';
export type { ResultadoSincronizacion, OpcionesSincronizador } from './sincronizador.ts';

type OpcionesFabrica = {
  postgres: NonNullable<ConfigCoordinador['postgres']>;
  centralUrl: string;
  eventoId: string;
  clienteId: string;
  boleteriaId: string;
  recintoId: string;
  secreto: string;
  intervaloMs: number;
  log: ConstructorParameters<typeof SincronizadorPermisos>[0]['log'];
};

export function crearSincronizadorPermisos(opciones: OpcionesFabrica): {
  sincronizador: SincronizadorPermisos; cerrar(): Promise<void>;
} {
  const pool = new pg.Pool({ ...opciones.postgres, max: 2, connectionTimeoutMillis: 2_000 });
  pool.on('error', () => undefined);
  const sincronizador = new SincronizadorPermisos({
    eventoId: opciones.eventoId,
    cliente: crearClienteP2Http(opciones.centralUrl),
    instalar: (paquete, recibidoEn) => instalarPaquete(pool, paquete, {
      recibidoEn, clienteId: opciones.clienteId, boleteriaId: opciones.boleteriaId, recintoId: opciones.recintoId,
    }),
    versionInstalada: async () => {
      const r = await pool.query<{ version_permisos: string }>(
        'SELECT version_permisos FROM evento WHERE evento_id = $1', [opciones.eventoId],
      );
      return Number(r.rows[0]?.version_permisos ?? 0);
    },
    secreto: opciones.secreto,
    intervaloMs: opciones.intervaloMs,
    log: opciones.log,
  });
  return { sincronizador, async cerrar() { await sincronizador.detener(); await pool.end(); } };
}

export function cargarConfigPermisos(env: NodeJS.ProcessEnv = process.env): {
  secreto: string; intervaloMs: number; clienteId: string; boleteriaId: string;
} {
  const intervalo = Number(env.PERMISOS_INTERVALO_MS);
  return {
    // Solo para desarrollo local; producción debe inyectar PERMISOS_FIRMA_SECRETO.
    secreto: env.PERMISOS_FIRMA_SECRETO ?? 'nexo-desarrollo-inseguro',
    intervaloMs: Number.isInteger(intervalo) && intervalo > 0 ? intervalo : 5_000,
    clienteId: env.CLIENTE_ID ?? 'CLI-001',
    boleteriaId: env.BOLETERIA_ID ?? 'BOL-01',
  };
}
