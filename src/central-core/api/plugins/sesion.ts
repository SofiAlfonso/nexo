import type { FastifyInstance, FastifyReply } from 'fastify';
import { NOMBRE_COOKIE_SESION, RUTAS, type CodigoError } from '@nexo/shared/contracts';
import type { ServicioAuth } from '../../application/auth/servicioAuth.ts';
import '../tipos-fastify.ts';

/** Ruta de login: única excepción a la exigencia de sesión bajo `/api/*` (contracts.md, Auth). */
const RUTA_LOGIN = RUTAS.login.ruta;

function responderNoAutenticado(reply: FastifyReply): FastifyReply {
  const cuerpo: { error: CodigoError; mensaje: string } = {
    error: 'NO_AUTENTICADO',
    mensaje: 'Se requiere iniciar sesión',
  };
  return reply.code(401).send(cuerpo);
}

/**
 * Registra el guardia de sesión: toda ruta `/api/*` (salvo `POST /api/auth/login`) exige la
 * cookie `nexo_sesion` vigente; decora `request.sesion` con la sesión reconstruida desde D2
 * (el rol siempre sale del operador autenticado, ADR-016).
 */
export function registrarGuardiaSesion(fastify: FastifyInstance, servicioAuth: ServicioAuth): void {
  fastify.decorateRequest('sesion', null);

  fastify.addHook('onRequest', async (request, reply) => {
    const ruta = request.url.split('?')[0];
    if (!ruta || !ruta.startsWith('/api/')) return;
    if (request.method === 'POST' && ruta === RUTA_LOGIN) return;

    const crudo = request.cookies[NOMBRE_COOKIE_SESION];
    if (!crudo) return responderNoAutenticado(reply);

    const desfirmado = request.unsignCookie(crudo);
    if (!desfirmado.valid || !desfirmado.value) return responderNoAutenticado(reply);

    const sesion = await servicioAuth.verificarToken(desfirmado.value);
    if (!sesion) return responderNoAutenticado(reply);

    request.sesion = sesion;
  });
}
