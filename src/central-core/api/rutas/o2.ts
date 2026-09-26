import type { FastifyInstance } from 'fastify';
import {
  Accion, Boleta, CambioControl, ConsultaIntentos, DecisionAccion, EstadoActual, ListaAcciones, ListaActividad,
  ListaIntentos, ListaPuntos, PuntoDetalle, RUTAS, type CodigoError,
} from '@nexo/shared/contracts';
import type { ServicioO2 } from '../../application/o2/servicio-o2.ts';

/**
 * O2 mínimo (ola 1): estado/puntos/intentos/incidentes ya cubiertos por otras rutas registradas
 * en `server.ts`; aquí se añaden acciones, actividad, boletas y preparación (control/apertura).
 * Cierre (M3/M4) vive en `registrarRutasCierre`.
 */
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

  fastify.get(RUTAS.intentos.ruta, async (request, reply) => {
    const parseo = ConsultaIntentos.safeParse(request.query);
    if (!parseo.success) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Consulta de intentos inválida' };
      return reply.code(400).send(cuerpo);
    }
    const intentos = await servicio.listarIntentos({ limite: parseo.data.limite, puntoId: parseo.data.puntoId });
    return ListaIntentos.parse(intentos);
  });

  fastify.get(RUTAS.acciones.ruta, async () => ListaAcciones.parse(await servicio.listarAcciones()));

  fastify.post<{ Params: { id: string } }>(RUTAS.decidirAccion.ruta, async (request, reply) => {
    const parseo = DecisionAccion.safeParse(request.body);
    if (!parseo.success) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Decisión de acción inválida' };
      return reply.code(400).send(cuerpo);
    }
    const usuario = request.sesion?.operador.usuario;
    if (!usuario) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_AUTENTICADO', mensaje: 'Se requiere iniciar sesión' };
      return reply.code(401).send(cuerpo);
    }
    const resultado = await servicio.decidirAccion(request.params.id, parseo.data.aprobar, parseo.data.nota, usuario);
    if (!resultado || resultado.tipo === 'no-encontrada') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'Acción no encontrada' };
      return reply.code(404).send(cuerpo);
    }
    if (resultado.tipo === 'ya-decidida') {
      const cuerpo: { error: CodigoError; mensaje: string; detalles: { estado: string } } = {
        error: 'CONFLICTO_ESTADO', mensaje: 'La acción ya fue decidida', detalles: { estado: resultado.estado },
      };
      return reply.code(409).send(cuerpo);
    }
    return Accion.parse(resultado.accion);
  });

  fastify.get(RUTAS.actividad.ruta, async () => ListaActividad.parse(await servicio.listarActividad()));

  fastify.get<{ Params: { ref: string } }>(RUTAS.boleta.ruta, async (request, reply) => {
    const boleta = await servicio.obtenerBoleta(request.params.ref);
    if (!boleta) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'Boleta no encontrada' };
      return reply.code(404).send(cuerpo);
    }
    return Boleta.parse(boleta);
  });

  // Preparación (M1): control individual y confirmación de apertura, sobre `controles_preparacion`
  // sembrado por evento. Cierre (M3/M4): ver `registrarRutasCierre`.
  fastify.post<{ Params: { id: string }; Body: unknown }>(RUTAS.control.ruta, async (request, reply) => {
    const parseo = CambioControl.safeParse(request.body);
    if (!parseo.success) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Cambio de control inválido' };
      return reply.code(400).send(cuerpo);
    }
    const resultado = await servicio.alternarControlPreparacion(request.params.id, parseo.data.ok);
    if (resultado === 'control-invalido') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Control no reconocido' };
      return reply.code(400).send(cuerpo);
    }
    if (resultado === 'evento-no-encontrado') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'No hay un evento actual' };
      return reply.code(404).send(cuerpo);
    }
    return resultado;
  });

  fastify.post(RUTAS.confirmarApertura.ruta, async (_request, reply) => {
    const resultado = await servicio.confirmarAperturaPreparacion();
    if (resultado === 'evento-no-encontrado') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'No hay un evento actual' };
      return reply.code(404).send(cuerpo);
    }
    if (resultado === 'controles-pendientes') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'CONFLICTO_ESTADO', mensaje: 'Hay controles de preparación pendientes' };
      return reply.code(409).send(cuerpo);
    }
    return resultado;
  });
}
