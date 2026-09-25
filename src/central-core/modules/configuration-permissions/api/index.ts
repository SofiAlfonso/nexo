import type { FastifyInstance } from 'fastify';
import { ConsultaPermisos, PaquetePermisos, RUTAS, type ErrorRespuesta } from '@nexo/shared/contracts';
import type { Pool } from 'pg';
// El pool D2 compartido está fuera del módulo, en la infraestructura de C4.
// eslint-disable-next-line boundaries/dependencies
import { createD2Pool } from '../../../infrastructure/db/index.ts';
import { EventoPermisosNoEncontrado, ServicioPermisos, VersionPermisosInvalida } from '../application/index.ts';
import { EventoConfigRepositorioPg, PermisosRepositorioPg, PuntoConfigRepositorioPg } from '../infrastructure/index.ts';

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
