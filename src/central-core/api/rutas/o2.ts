import type { FastifyInstance } from 'fastify';
import { EstadoActual, ListaPuntos, PuntoDetalle, RUTAS, type CodigoError } from '@nexo/shared/contracts';
import type { ServicioO2 } from '../../application/o2/servicio-o2.ts';

/** `GET /api/eventos/actual/estado`, `GET /api/puntos`, `GET /api/puntos/:id` (O2 mínimo). */
export function registrarRutasO2(fastify: FastifyInstance, servicio: ServicioO2): void {
  fastify.get(RUTAS.estado.ruta, async (_request, reply) => {
    const estado = await servicio.obtenerEstadoActual();
    if (!estado) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'No hay un evento actual' };
      return reply.code(404).send(cuerpo);
    }
    return EstadoActual.parse(estado);
  });

  fastify.get(RUTAS.puntos.ruta, async () => ListaPuntos.parse(await servicio.listarPuntos()));

  fastify.get<{ Params: { id: string } }>(RUTAS.punto.ruta, async (request, reply) => {
    const punto = await servicio.obtenerPunto(request.params.id);
    if (!punto) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'Punto no encontrado' };
      return reply.code(404).send(cuerpo);
    }
    return PuntoDetalle.parse(punto);
  });
}
