import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import {
  AcuseLatido, AcuseLoteDiario, ErrorRespuesta, Latido, LoteDiario,
  MAX_REGISTROS_DIARIO, RespuestaValidacion, RUTAS, SolicitudValidacion,
} from '@nexo/shared/contracts';
import {
  ErrorConflictoIdempotencia, ErrorEntradaInvalida, ErrorSinConfianza, resultadoSinConfirmacion,
} from '@nexo/shared/domain';
import type { ResultadoValidacion } from '@nexo/shared/domain';
import {
  CAMPOS_LOG_PROHIBIDOS, conSpan, extraerContexto, pinoMixinTraza, SpanKind, trace,
} from '@nexo/shared/telemetry';
import type { Almacen } from '../application/puertos.ts';
import type { RegistroLatidos } from '../application/latidos.ts';
import type { ServicioValidacion } from '../application/servicio-validacion.ts';
import type { ConfigCoordinador } from '../config.ts';
import { opcionesTlsCoordinador, registrarAutenticacionLectores } from './tls.ts';

interface Dependencias {
  servicio: ServicioValidacion;
  almacen: Almacen;
  latidos: RegistroLatidos;
  config: ConfigCoordinador;
  reloj?: { ahora(): Date };
  logger?: FastifyServerOptions['logger'];
}

function error(status: number, codigo: ErrorRespuesta['error'], mensaje: string, detalles?: unknown) {
  return { status, cuerpo: ErrorRespuesta.parse({ error: codigo, mensaje, ...(detalles === undefined ? {} : { detalles }) }) };
}

/** T2 §8.4: agrega `trace_id`/`span_id` a cada línea y redacta campos prohibidos (QR, credenciales). */
function construirOpcionesLogger(logger: Dependencias['logger']): FastifyServerOptions['logger'] {
  if (!logger) return false;
  const base = logger === true ? {} : logger;
  return { ...base, mixin: pinoMixinTraza(), redact: { paths: [...CAMPOS_LOG_PROHIBIDOS], censor: '[REDACTADO]' } };
}

const tracer = trace.getTracer('nexo.local-coordinator');

export function crearServidor(deps: Dependencias): FastifyInstance {
  const app = Fastify({
    logger: construirOpcionesLogger(deps.logger), bodyLimit: 1024 * 1024,
    https: opcionesTlsCoordinador(deps.config.tls) ?? null,
  });
  registrarAutenticacionLectores(app, deps.config.tls);
  const ahora = () => deps.reloj?.ahora() ?? new Date();
  const responderSinConfirmacion = (idOrigen: string) => RespuestaValidacion.parse({
    ...resultadoSinConfirmacion(idOrigen, ahora(), deps.config.coordinadorId, null),
    instanteDecision: ahora().toISOString(),
  });
  const respuesta = (r: ResultadoValidacion) => RespuestaValidacion.parse({
    ...r, instanteDecision: r.instanteDecision.toISOString(),
  });

  app.setErrorHandler((fallo, _request, reply) => {
    const codigo = typeof fallo === 'object' && fallo !== null && 'statusCode' in fallo ? fallo.statusCode : undefined;
    const status = codigo === 413 ? 413 : codigo === 400 ? 400 : 500;
    const e = error(status, status === 413 ? 'LOTE_DEMASIADO_GRANDE' : status === 400 ? 'SOLICITUD_INVALIDA' : 'ERROR_INTERNO',
      status === 400 ? 'JSON inválido' : status === 413 ? 'Cuerpo demasiado grande' : 'Error interno');
    reply.code(e.status).send(e.cuerpo);
  });

  app.post(RUTAS.validar.ruta, async (request, reply) => {
    const parseado = SolicitudValidacion.safeParse(request.body);
    if (!parseado.success) {
      const e = error(400, 'SOLICITUD_INVALIDA', 'Solicitud V1 inválida', parseado.error.issues);
      return reply.code(e.status).send(e.cuerpo);
    }
    const s = parseado.data;
    // T25 enlazará lectorId con la identidad de la credencial mTLS.
    const padre = extraerContexto(request.headers);
    try {
      return await conSpan(tracer, 'validation.process', async (span) => {
        span.setAttribute('nexo.punto_id', s.puntoId);
        return respuesta(await deps.servicio.ejecutar({ ...s, instanteLector: new Date(s.instanteLector) }));
      }, { kind: SpanKind.SERVER, padre });
    } catch (fallo) {
      if (fallo instanceof ErrorConflictoIdempotencia) {
        const e = error(409, 'CONFLICTO_IDEMPOTENCIA', fallo.message);
        return reply.code(e.status).send(e.cuerpo);
      }
      if (fallo instanceof ErrorSinConfianza) {
        const e = error(403, 'NO_AUTORIZADO', fallo.message);
        return reply.code(e.status).send(e.cuerpo);
      }
      if (fallo instanceof ErrorEntradaInvalida) {
        const e = error(400, 'SOLICITUD_INVALIDA', fallo.message);
        return reply.code(e.status).send(e.cuerpo);
      }
      return responderSinConfirmacion(s.idOrigen);
    }
  });

  app.post(RUTAS.latido.ruta, async (request, reply) => {
    const parseado = Latido.safeParse(request.body);
    if (!parseado.success) {
      const e = error(400, 'SOLICITUD_INVALIDA', 'Latido inválido', parseado.error.issues);
      return reply.code(e.status).send(e.cuerpo);
    }
    deps.latidos.registrar(parseado.data);
    return AcuseLatido.parse({ recibidoEn: ahora().toISOString(), intervaloS: deps.config.intervaloLatidoS });
  });

  app.post(RUTAS.loteDiario.ruta, async (request, reply) => {
    if (typeof request.body === 'object' && request.body !== null && 'registros' in request.body &&
      Array.isArray(request.body.registros) && request.body.registros.length > MAX_REGISTROS_DIARIO) {
      const e = error(413, 'LOTE_DEMASIADO_GRANDE', `Máximo ${MAX_REGISTROS_DIARIO} registros`);
      return reply.code(e.status).send(e.cuerpo);
    }
    const parseado = LoteDiario.safeParse(request.body);
    if (!parseado.success) {
      const e = error(400, 'SOLICITUD_INVALIDA', 'Lote H1 inválido', parseado.error.issues);
      return reply.code(e.status).send(e.cuerpo);
    }
    try {
      return AcuseLoteDiario.parse(await deps.almacen.diario.registrarLote(parseado.data, ahora()));
    } catch (fallo) {
      const e = fallo instanceof ErrorConflictoIdempotencia
        ? error(409, 'CONFLICTO_IDEMPOTENCIA', fallo.message)
        : error(503, 'NO_DISPONIBLE', 'Diario no confirmado; reintente el lote');
      return reply.code(e.status).send(e.cuerpo);
    }
  });

  app.get('/salud', async () => ({ estado: 'ok' }));
  app.get('/listo', async (_request, reply) => {
    try {
      if (await deps.almacen.salud()) return { estado: 'ok' };
    } catch { /* D1 indisponible. */ }
    return reply.code(503).send(ErrorRespuesta.parse({ error: 'NO_DISPONIBLE', mensaje: 'D1 no disponible' }));
  });
  return app;
}
