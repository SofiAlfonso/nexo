/** Configuración de C4 desde variables de entorno (sin secretos en el código; ver README). */

export interface ConfigCentral {
  port: number;
  host: string;
}

function entero(v: string | undefined, porDefecto: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

/**
 * `createD2Pool` espera `D2_DATABASE_URL` o `CENTRAL_POSTGRES_*` (Kubernetes/prod). Si
 * ninguna está presente, se traducen aquí las variables `D2_*` de
 * `deploy/compose/.env.example` (que usa `npm run dev`), análogo a la resolución de D1
 * en `local-coordinator/config.ts`.
 */
export function envParaPoolD2(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.D2_DATABASE_URL || env.CENTRAL_POSTGRES_HOST) return env;
  if (!env.D2_POSTGRES_USER) return env;
  return {
    ...env,
    CENTRAL_POSTGRES_HOST: env.D2_HOST ?? 'localhost',
    CENTRAL_POSTGRES_PORT: String(entero(env.D2_PORT, 5434)),
    CENTRAL_POSTGRES_DB: env.D2_POSTGRES_DB ?? 'nexo_central',
    CENTRAL_POSTGRES_USER: env.D2_POSTGRES_USER,
    CENTRAL_POSTGRES_PASSWORD: env.D2_POSTGRES_PASSWORD ?? '',
  };
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigCentral {
  return {
    port: entero(env.PORT, 8080),
    host: env.HOST ?? '0.0.0.0',
  };
}
