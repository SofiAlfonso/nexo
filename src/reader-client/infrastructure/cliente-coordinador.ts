import {
  AcuseLatido,
  AcuseLoteDiario,
  Latido,
  LoteDiario,
  RespuestaValidacion,
  RUTAS,
  SolicitudValidacion,
} from '@nexo/shared/contracts';
import { inyectarCabeceras } from '@nexo/shared/telemetry';
import { Agent, fetch as undiciFetch } from 'undici';

export interface CredencialesCoordinador {
  ca: string;
  cert: string;
  key: string;
}

export interface CoordinadorLector {
  validar(solicitud: SolicitudValidacion, timeoutMs: number): Promise<RespuestaValidacion>;
  latido(latido: Latido, timeoutMs: number): Promise<AcuseLatido>;
  loteDiario(lote: LoteDiario, timeoutMs: number): Promise<AcuseLoteDiario>;
}

export class ErrorHttpCoordinador extends Error {
  readonly status: number;
  constructor(status: number, ruta: string) {
    super(`Coordinador respondió HTTP ${status} en ${ruta}`);
    this.status = status;
  }
}

/** Transporte JSON V1/H1 con CA y certificado propios por lector cuando usa HTTPS. */
export class ClienteHttpCoordinador implements CoordinadorLector {
  private readonly baseUrl: string | URL;
  private readonly enviar: (url: URL, init: RequestInit) => Promise<Response>;
  private readonly agente?: Agent;
  constructor(baseUrl: string | URL, credenciales?: CredencialesCoordinador) {
    this.baseUrl = baseUrl;
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('El coordinador debe usar http o https');
    if (url.username || url.password) throw new Error('No se admiten credenciales en la URL');
    if (url.protocol === 'https:' && !credenciales) throw new Error('HTTPS requiere CA y credenciales de lector');
    if (url.protocol === 'http:' && credenciales) throw new Error('Las credenciales TLS requieren HTTPS');
    if (credenciales && (!credenciales.ca || !credenciales.cert || !credenciales.key)) {
      throw new Error('HTTPS requiere CA, certificado y clave del lector');
    }
    if (credenciales) {
      this.agente = new Agent({ connect: { ...credenciales, rejectUnauthorized: true } });
      this.enviar = (input, init) => undiciFetch(input, {
        method: init.method, headers: init.headers as Record<string, string>,
        body: init.body as string, signal: init.signal,
        dispatcher: this.agente, redirect: 'manual',
      }) as Promise<Response>;
    } else {
      this.enviar = fetch;
    }
  }

  async cerrar(): Promise<void> {
    await this.agente?.close();
  }

  private async post<T>(
    ruta: string,
    cuerpo: unknown,
    esquemaCuerpo: { parse(value: unknown): unknown },
    esquemaRespuesta: { parse(value: unknown): T },
    timeoutMs: number,
  ): Promise<T> {
    const url = new URL(ruta, this.baseUrl);
    const respuesta = await this.enviar(url, {
      method: 'POST',
      headers: inyectarCabeceras({ 'content-type': 'application/json' }),
      body: JSON.stringify(esquemaCuerpo.parse(cuerpo)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!respuesta.ok) throw new ErrorHttpCoordinador(respuesta.status, ruta);
    return esquemaRespuesta.parse(await respuesta.json());
  }

  validar(solicitud: SolicitudValidacion, timeoutMs: number): Promise<RespuestaValidacion> {
    return this.post(RUTAS.validar.ruta, solicitud, SolicitudValidacion, RespuestaValidacion, timeoutMs);
  }

  latido(latido: Latido, timeoutMs: number): Promise<AcuseLatido> {
    return this.post(RUTAS.latido.ruta, latido, Latido, AcuseLatido, timeoutMs);
  }

  loteDiario(lote: LoteDiario, timeoutMs: number): Promise<AcuseLoteDiario> {
    return this.post(RUTAS.loteDiario.ruta, lote, LoteDiario, AcuseLoteDiario, timeoutMs);
  }
}
