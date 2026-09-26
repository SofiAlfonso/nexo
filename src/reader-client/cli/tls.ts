import { readFile } from 'node:fs/promises';
import { createSecureContext } from 'node:tls';

export interface RutasTls {
  ca?: string;
  cert?: string;
  key?: string;
}

export interface CredencialesTls {
  ca: string;
  cert: string;
  key: string;
}

export function validarTls(coordinador: string, lectores: number, rutas: RutasTls): void {
  let url: URL;
  try {
    url = new URL(coordinador);
  } catch {
    throw new Error('URL del coordinador inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('El coordinador debe usar http o https');
  }
  if (url.username || url.password) throw new Error('No se admiten credenciales en la URL');
  const presentes = [rutas.ca, rutas.cert, rutas.key].filter(Boolean).length;
  if (url.protocol === 'http:') {
    if (presentes) throw new Error('Las credenciales TLS requieren un coordinador https');
    return;
  }
  if (presentes !== 3) throw new Error('HTTPS requiere --ca, --cert y --key');
  if (lectores > 1 && (!rutas.cert!.includes('{lectorId}') || !rutas.key!.includes('{lectorId}'))) {
    throw new Error('Varios lectores requieren {lectorId} en --cert y --key para credenciales individuales');
  }
}

export async function cargarTls(rutas: RutasTls, lectorId: string): Promise<CredencialesTls> {
  const archivo = (ruta: string) => ruta.replaceAll('{lectorId}', lectorId);
  const leer = async (ruta: string, nombre: string) => {
    try {
      return await readFile(archivo(ruta), 'utf8');
    } catch (error) {
      throw new Error(`No se pudo leer ${nombre} TLS para ${lectorId}: ${archivo(ruta)}`, { cause: error });
    }
  };
  const [ca, cert, key] = await Promise.all([
    leer(rutas.ca!, 'CA'), leer(rutas.cert!, 'certificado'), leer(rutas.key!, 'clave'),
  ]);
  try {
    createSecureContext({ ca, cert, key });
  } catch (error) {
    throw new Error(`Credenciales TLS inválidas para ${lectorId}`, { cause: error });
  }
  return { ca, cert, key };
}
