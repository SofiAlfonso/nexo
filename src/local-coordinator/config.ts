/** Configuración de C2 desde variables de entorno (sin secretos en el código; ver README). */
export interface ConfigCoordinador {
  port: number;
  host: string;
  eventoId: string;
  recintoId: string;
  coordinadorId: string;
  /** URL base de C4; `null` desactiva el despachador E1. */
  centralUrl: string | null;
  plazoValidacionMs: number;
  loteEvidenciaMax: number;
  intervaloLatidoS: number;
  /** Aplica las migraciones de D1 al arrancar; `D1_MIGRAR=false` si las aplica otro paso (Job, `npm run dev`). */
  migrarD1: boolean;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  } | null;
}

function entero(v: string | undefined, porDefecto: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

/**
 * D1: `LOCAL_POSTGRES_*` (Kubernetes) tiene prioridad; si falta, `D1_DATABASE_URL` o las
 * variables `D1_*` de `deploy/compose/.env.example` (que usa `npm run dev`). Sin ninguna, D1 en memoria.
 */
function postgres(env: NodeJS.ProcessEnv): ConfigCoordinador['postgres'] {
  if (env.LOCAL_POSTGRES_HOST) {
    return {
      host: env.LOCAL_POSTGRES_HOST,
      port: entero(env.LOCAL_POSTGRES_PORT, 5432),
      database: env.LOCAL_POSTGRES_DB ?? 'nexo_venue',
      user: env.LOCAL_POSTGRES_USER ?? 'nexo_venue',
      password: env.LOCAL_POSTGRES_PASSWORD ?? '',
    };
  }
  if (env.D1_DATABASE_URL) {
    const url = new URL(env.D1_DATABASE_URL);
    return {
      host: url.hostname,
      port: entero(url.port, 5432),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'nexo_venue',
      user: decodeURIComponent(url.username) || 'nexo_venue',
      password: decodeURIComponent(url.password),
    };
  }
  if (env.D1_POSTGRES_USER) {
    return {
      host: env.D1_HOST ?? 'localhost',
      port: entero(env.D1_PORT, 5433),
      database: env.D1_POSTGRES_DB ?? 'nexo_venue',
      user: env.D1_POSTGRES_USER,
      password: env.D1_POSTGRES_PASSWORD ?? '',
    };
  }
  return null;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigCoordinador {
  return {
    port: entero(env.PORT, 8081),
    host: env.HOST ?? '0.0.0.0',
    eventoId: env.EVENTO_ID ?? 'EVT-2026-02',
    recintoId: env.RECINTO_ID ?? 'REC-01',
    coordinadorId: env.COORDINADOR_ID ?? 'COORD-A',
    centralUrl: env.CENTRAL_URL ? env.CENTRAL_URL.replace(/\/+$/, '') : null,
    plazoValidacionMs: entero(env.PLAZO_VALIDACION_MS, 500),
    loteEvidenciaMax: Math.min(100, entero(env.LOTE_EVIDENCIA_MAX, 100)),
    intervaloLatidoS: entero(env.INTERVALO_LATIDO_S, 10),
    migrarD1: env.D1_MIGRAR !== 'false',
    postgres: postgres(env),
  };
}
