export interface ConfigBoleteria {
  port: number;
  host: string;
  boleteria: string;
  eventoExterno: string;
  semilla: 'piloto' | 'vacia';
  estadoArchivo: string | null;
  adminToken: string | null;
}

export function cargarConfig(env: NodeJS.ProcessEnv = process.env): ConfigBoleteria {
  const port = Number(env.PORT ?? env.TICKETING_PORT ?? 8082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto de boletería inválido');
  const semilla = env.TICKETING_SEMILLA ?? 'piloto';
  if (semilla !== 'piloto' && semilla !== 'vacia') throw new Error('TICKETING_SEMILLA debe ser piloto o vacia');
  return {
    port,
    host: env.HOST ?? '0.0.0.0',
    boleteria: env.BOLETERIA_NOMBRE ?? 'TaquillaAndina',
    eventoExterno: env.BOLETERIA_EVENTO_EXTERNO ?? 'TA-FECHA-14',
    semilla,
    estadoArchivo: env.TICKETING_ESTADO_ARCHIVO ?? null,
    adminToken: env.TICKETING_ADMIN_TOKEN ?? null,
  };
}
