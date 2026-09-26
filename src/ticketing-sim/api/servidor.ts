import Fastify from 'fastify';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { ErrorRespuesta, IndiceVersiones, RUTAS, VersionBoleteria } from '@nexo/shared/contracts';
import { z } from 'zod';
import {
  BoletaDesconocida, BoletaYaAnulada, BoletaYaEmitida, Localidad, LocalidadInvalida,
} from '../domain/boleteria.ts';
import type { Boleteria } from '../domain/boleteria.ts';

interface Dependencias {
  boleteria: Boleteria;
  adminToken?: string | null;
  logger?: FastifyServerOptions['logger'];
  alCambiar?: () => void | Promise<void>;
}

const Referencia = z.string().min(1);
const Anulacion = z.object({ referencia: Referencia });
const Emision = Anulacion.extend({ localidad: Localidad });
const CambioLocalidad = Emision;

function error(codigo: ErrorRespuesta['error'], mensaje: string): ErrorRespuesta {
  return ErrorRespuesta.parse({ error: codigo, mensaje });
}

export function crearServidor(deps: Dependencias): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? false });
  let pendientes: Promise<void> = Promise.resolve();
  const enOrden = <T>(operacion: () => Promise<T>): Promise<T> => {
    const actual = pendientes.then(operacion);
    pendientes = actual.then(() => undefined, () => undefined);
    return actual;
  };

  app.setErrorHandler((fallo, _request, reply) => {
    const status = typeof fallo === 'object' && fallo !== null && 'statusCode' in fallo && fallo.statusCode === 400 ? 400 : 500;
    if (status === 500) app.log.error({ fallo }, 'Error en la boletería');
    return reply.code(status).send(error(
      status === 400 ? 'SOLICITUD_INVALIDA' : 'ERROR_INTERNO',
      status === 400 ? 'JSON inválido' : 'Error interno',
    ));
  });

  app.get(RUTAS.versiones.ruta, async () => IndiceVersiones.parse(deps.boleteria.indice()));
  app.get<{ Params: { n: string } }>(RUTAS.version.ruta, async (request, reply) => {
    const valor = request.params.n;
    if (!/^\d+$/.test(valor) || !Number.isSafeInteger(Number(valor))) {
      return reply.code(400).send(error('SOLICITUD_INVALIDA', 'La versión debe ser un entero no negativo'));
    }
    const version = deps.boleteria.version(Number(valor));
    if (!version) return reply.code(404).send(error('NO_ENCONTRADO', 'Versión no publicada'));
    return VersionBoleteria.parse(version);
  });

  app.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/admin/') && deps.adminToken && request.headers['x-admin-token'] !== deps.adminToken) {
      return reply.code(401).send(error('NO_AUTENTICADO', 'Token administrativo requerido'));
    }
  });

  const registrar = (ruta: string, esquema: z.ZodType<{ referencia: string; localidad?: Localidad }>,
    ejecutar: (referencia: string, localidad?: string) => VersionBoleteria) => {
    app.post(ruta, async (request, reply) => {
      const cuerpo = esquema.safeParse(request.body);
      if (!cuerpo.success) {
        return reply.code(400).send(error('SOLICITUD_INVALIDA', 'Cuerpo administrativo inválido'));
      }
      return enOrden(async () => {
        try {
          const version = ejecutar(cuerpo.data.referencia, 'localidad' in cuerpo.data ? cuerpo.data.localidad : undefined);
          await deps.alCambiar?.();
          return reply.code(201).send({ version: version.numero, referencia: cuerpo.data.referencia });
        } catch (fallo) {
          if (fallo instanceof BoletaDesconocida) return reply.code(404).send(error('NO_ENCONTRADO', fallo.message));
          if (fallo instanceof BoletaYaAnulada || fallo instanceof BoletaYaEmitida) {
            return reply.code(409).send(error('CONFLICTO_ESTADO', fallo.message));
          }
          if (fallo instanceof LocalidadInvalida) return reply.code(400).send(error('SOLICITUD_INVALIDA', fallo.message));
          throw fallo;
        }
      });
    });
  };

  registrar('/admin/anulaciones', Anulacion, (referencia) => deps.boleteria.anular(referencia));
  registrar('/admin/emisiones', Emision, (referencia, localidad) => deps.boleteria.emitir(referencia, localidad!));
  registrar('/admin/cambios-localidad', CambioLocalidad,
    (referencia, localidad) => deps.boleteria.cambiarLocalidad(referencia, localidad!));
  app.get('/salud', async () => ({ estado: 'ok', ultimaVersion: deps.boleteria.indice().ultimaVersion }));
  return app;
}
