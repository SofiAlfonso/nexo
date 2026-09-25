import type { Sesion } from '@nexo/shared/contracts';
import type {} from '@fastify/cookie';

/**
 * Aumenta `FastifyRequest` con la sesión ya verificada por el guardia de `/api/*`
 * (`plugins/sesion.ts`). `null` antes de pasar por el guardia o en rutas públicas.
 */
declare module 'fastify' {
  interface FastifyRequest {
    sesion: Sesion | null;
  }
}
