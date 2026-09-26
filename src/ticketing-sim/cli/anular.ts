import { ErrorRespuesta } from '@nexo/shared/contracts';

export async function anularDesdeCli(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const [referencia, opcion, base] = args;
  if (!referencia || (opcion !== undefined && (opcion !== '--url' || !base)) || args.length > 3) {
    throw new Error('Uso: node src/ticketing-sim/cli/anular.ts <referencia> [--url <base>]');
  }
  const url = new URL('/admin/anulaciones', base ?? env.TICKETING_URL ?? 'http://localhost:8082');
  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.TICKETING_ADMIN_TOKEN ? { 'x-admin-token': env.TICKETING_ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify({ referencia }),
  });
  const contenido: unknown = await respuesta.json();
  if (!respuesta.ok) {
    const fallo = ErrorRespuesta.safeParse(contenido);
    throw new Error(fallo.success ? `${fallo.data.error}: ${fallo.data.mensaje}` : `Error HTTP ${respuesta.status}`);
  }
  if (typeof contenido !== 'object' || contenido === null || !('version' in contenido) || typeof contenido.version !== 'number') {
    throw new Error('Respuesta de boletería inválida');
  }
  console.log(`Anulada ${referencia} en la versión ${contenido.version}`);
}

if (import.meta.main) {
  void anularDesdeCli().catch((fallo: unknown) => {
    console.error(fallo instanceof Error ? fallo.message : fallo);
    process.exitCode = 1;
  });
}
