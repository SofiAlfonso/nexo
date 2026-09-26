import type { FastifyInstance } from 'fastify';
import {
  Accion, Boleta, ConsultaIntentos, DecisionAccion, EstadoActual, ListaAcciones, ListaActividad, ListaIntentos,
  ListaPuntos, PuntoDetalle, RUTAS, type CodigoError,
} from '@nexo/shared/contracts';
import type { ServicioO2 } from '../../application/o2/servicio-o2.ts';

// No hay un código de la taxonomía D12 para "no implementado": estas rutas quedan fuera del
// alcance de M1 (preparación/cierre) y devuelven 501 explícito en vez de un 404 genérico.
function sinImplementar(mensaje: string) {
  return async (_request: unknown, reply: { code(n: number): { send(body: unknown): unknown } }) => reply.code(501).send({
    mensaje,
  });
}

/**
 * O2 mínimo (ola 1): estado/puntos/intentos/incidentes ya cubiertos por otras rutas registradas
 * en `server.ts`; aquí se añaden acciones, actividad y boletas, y se dejan explícitos con 501 los
 * puntos de preparación/cierre que quedan fuera de alcance de M1.
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

  // Preparación (M1): fuera de alcance de M1 ola 1; 501 explícito para que el panel distinga
  // "no implementado" de un 404 genérico. Cierre (M3/M4): ver `registrarRutasCierre`.
  fastify.post(RUTAS.control.ruta, sinImplementar('Preparación no implementada en M1'));
  fastify.post(RUTAS.confirmarApertura.ruta, sinImplementar('Preparación no implementada en M1'));
}
