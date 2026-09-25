import type { FastifyInstance } from 'fastify';
import { NOMBRE_COOKIE_SESION, SolicitudLogin, type CodigoError } from '@nexo/shared/contracts';
import { CredencialesInvalidas, DURACION_SESION_MS, type ServicioAuth } from '../../application/auth/servicioAuth.ts';
import '../tipos-fastify.ts';

/** Registra `POST /api/auth/login`, `POST /api/auth/logout` y `GET /api/auth/me` (ADR-016). */
export function registrarRutasAuth(fastify: FastifyInstance, servicioAuth: ServicioAuth): void {
  fastify.post('/api/auth/login', async (request, reply) => {
    const parseo = SolicitudLogin.safeParse(request.body);
    if (!parseo.success) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Usuario y contraseña son obligatorios' };
      return reply.code(400).send(cuerpo);
    }

    try {
      const { token, sesion } = await servicioAuth.iniciarSesion(parseo.data.usuario, parseo.data.contrasena);
      reply.cookie(NOMBRE_COOKIE_SESION, token, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: Math.floor(DURACION_SESION_MS / 1000),
      });
      return reply.code(200).send(sesion);
    } catch (error) {
      if (error instanceof CredencialesInvalidas) {
        const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_AUTENTICADO', mensaje: 'Usuario o contraseña inválidos' };
        return reply.code(401).send(cuerpo);
      }
      throw error;
    }
  });

  fastify.post('/api/auth/logout', async (request, reply) => {
    const crudo = request.cookies[NOMBRE_COOKIE_SESION];
    if (crudo) {
      const desfirmado = request.unsignCookie(crudo);
      if (desfirmado.valid && desfirmado.value) await servicioAuth.cerrarSesion(desfirmado.value);
    }
    reply.clearCookie(NOMBRE_COOKIE_SESION, { path: '/' });
    return reply.code(204).send();
  });

  fastify.get('/api/auth/me', async (request, reply) => {
    // El guardia de sesión (plugins/sesion.ts) ya validó la cookie y llenó request.sesion.
    return reply.code(200).send(request.sesion);
  });
}
