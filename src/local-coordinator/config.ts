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

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigCoordinador {
  const pgHost = env.LOCAL_POSTGRES_HOST;
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
    postgres: pgHost
      ? {
          host: pgHost,
          port: entero(env.LOCAL_POSTGRES_PORT, 5432),
          database: env.LOCAL_POSTGRES_DB ?? 'nexo_venue',
          user: env.LOCAL_POSTGRES_USER ?? 'nexo_venue',
          password: env.LOCAL_POSTGRES_PASSWORD ?? '',
        }
      : null,
  };
}
