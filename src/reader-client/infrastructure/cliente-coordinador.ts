import {
  AcuseLatido,
  AcuseLoteDiario,
  Latido,
  LoteDiario,
  RespuestaValidacion,
  RUTAS,
  SolicitudValidacion,
} from '@nexo/shared/contracts';

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

/** Transporte JSON V1/H1; la función fetch inyectable permite configurar mTLS fuera del lector. */
export class ClienteHttpCoordinador implements CoordinadorLector {
  private readonly baseUrl: string | URL;
  private readonly enviar: typeof fetch;
  constructor(baseUrl: string | URL, enviar: typeof fetch = fetch) {
    this.baseUrl = baseUrl;
    this.enviar = enviar;
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
      headers: { 'content-type': 'application/json' },
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
