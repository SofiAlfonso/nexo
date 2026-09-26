import type { FastifyInstance } from 'fastify';
import { ConsultaPermisos, PaquetePermisos, RUTAS, type ErrorRespuesta } from '@nexo/shared/contracts';
import type { Pool } from 'pg';
// El pool D2 compartido está fuera del módulo, en la infraestructura de C4.
// eslint-disable-next-line boundaries/dependencies
import { createD2Pool } from '../../../infrastructure/db/index.ts';
import {
  EventoPermisosNoEncontrado,
  ServicioImportacionBoleteria,
  ServicioPermisos,
  VersionPermisosInvalida,
  type ResultadoSincronizacionBoleteria,
} from '../application/index.ts';
import {
  EventoConfigRepositorioPg,
  ImportacionesRepositorioPg,
  PermisosRepositorioPg,
  PuntoConfigRepositorioPg,
  crearClienteP1Http,
} from '../infrastructure/index.ts';

export interface ConfigAdaptadorBoleteria {
  url: string;
  eventoExterno: string;
  intervaloMs: number;
}

/** `BOLETERIA_URL` activa C3; sin ella M1 distribuye solo lo que ya está en D2. */
export function cargarConfigAdaptadorBoleteria(env: NodeJS.ProcessEnv = process.env): ConfigAdaptadorBoleteria | null {
  if (!env.BOLETERIA_URL) return null;
  const intervalo = Number(env.BOLETERIA_INTERVALO_MS);
  return {
    url: env.BOLETERIA_URL,
    eventoExterno: env.BOLETERIA_EVENTO_EXTERNO ?? 'TA-FECHA-14',
    intervaloMs: Number.isInteger(intervalo) && intervalo > 0 ? intervalo : 5_000,
  };
}

interface Registro {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
}

export interface AdaptadorBoleteria {
  servicio: ServicioImportacionBoleteria;
  sincronizar(): Promise<ResultadoSincronizacionBoleteria>;
  detener(): Promise<void>;
}

/** Arranca el sondeo P1 de C3 sin solapar ciclos; `detener()` espera el ciclo en curso. */
export function iniciarAdaptadorBoleteria(pool: Pool, config: ConfigAdaptadorBoleteria, log: Registro): AdaptadorBoleteria {
  const servicio = new ServicioImportacionBoleteria(
    crearClienteP1Http(config.url),
    new EventoConfigRepositorioPg(pool),
    new ImportacionesRepositorioPg(pool),
    config.eventoExterno,
  );
  let enCurso: Promise<ResultadoSincronizacionBoleteria> | null = null;
  let ultimoAviso = '';
  const sincronizar = () => {
    enCurso ??= servicio.sincronizar().then((r) => {
      if (r.resultado === 'importado') {
        ultimoAviso = '';
        log.info({ c3: r }, 'C3 importó versiones de la boletería');
      } else if (r.resultado === 'conflicto' || r.resultado === 'error') {
        // Evita repetir el mismo aviso en cada ciclo mientras la boletería siga inalcanzable.
        if (r.mensaje !== ultimoAviso) log.warn({ c3: r }, 'C3 no pudo sincronizar la boletería');
        ultimoAviso = r.mensaje;
      } else {
        ultimoAviso = '';
      }
      return r;
    }).finally(() => { enCurso = null; });
    return enCurso;
  };
  void sincronizar();
  const temporizador = setInterval(() => { void sincronizar(); }, config.intervaloMs);
  temporizador.unref();
  return {
    servicio,
    sincronizar,
    async detener() {
      clearInterval(temporizador);
      await enCurso;
    },
  };
}

export function crearServicioPermisos(pool: Pool = createD2Pool()): ServicioPermisos {
  // Solo para desarrollo local: configurar PERMISOS_FIRMA_SECRETO en cualquier entorno real.
  const secreto = process.env.PERMISOS_FIRMA_SECRETO ?? 'nexo-desarrollo-inseguro';
  return new ServicioPermisos(
    new EventoConfigRepositorioPg(pool),
    new PuntoConfigRepositorioPg(pool),
    new PermisosRepositorioPg(pool),
    secreto,
  );
}

export function registrarRutasPermisos(fastify: FastifyInstance, servicio: ServicioPermisos): void {
  fastify.get(RUTAS.permisos.ruta, async (solicitud, respuesta) => {
    const validacion = ConsultaPermisos.safeParse(solicitud.query);
    if (!validacion.success) {
      const error: ErrorRespuesta = { error: 'SOLICITUD_INVALIDA', mensaje: 'Consulta de permisos inválida' };
      return respuesta.code(400).send(error);
    }
    try {
      const paquete = await servicio.construirPaquete(validacion.data.eventoId, validacion.data.desdeVersion);
      return respuesta.code(RUTAS.permisos.estado).send(PaquetePermisos.parse(paquete));
    } catch (error) {
      if (error instanceof EventoPermisosNoEncontrado) {
        const cuerpo: ErrorRespuesta = { error: 'NO_ENCONTRADO', mensaje: error.message };
        return respuesta.code(404).send(cuerpo);
      }
      if (error instanceof VersionPermisosInvalida) {
        const cuerpo: ErrorRespuesta = { error: 'CONFLICTO_ESTADO', mensaje: error.message };
        return respuesta.code(409).send(cuerpo);
      }
      throw error;
    }
  });
}
