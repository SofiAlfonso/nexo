import { z } from 'zod';
import { Instante, Rol, ROL_TEXTO } from './common.ts';

/**
 * Auth del panel (ADR-016): usuario y contraseña por rol, argon2 en D2 y cookie de sesión firmada
 * (`nexo_sesion`, HttpOnly, SameSite=Lax). El rol sale del usuario, no del cliente.
 *
 * - `POST /api/auth/login` → 200 `Sesion` y `Set-Cookie`; 401 `NO_AUTENTICADO` si falla (mensaje genérico).
 * - `POST /api/auth/logout` → 204 y cookie expirada.
 * - `GET /api/auth/me` → 200 `Sesion` o 401.
 * Todas las rutas `/api/*` salvo `login` exigen la cookie.
 */
export const NOMBRE_COOKIE_SESION = 'nexo_sesion';

export const SolicitudLogin = z.object({
  usuario: z.string().min(1).max(64),
  contrasena: z.string().min(1).max(256),
});
export type SolicitudLogin = z.infer<typeof SolicitudLogin>;

export const Operador = z.object({
  usuario: z.string().min(1),
  nombre: z.string().min(1),
  rol: Rol,
  rolTexto: z.enum(Object.values(ROL_TEXTO) as [string, ...string[]]),
});
export type Operador = z.infer<typeof Operador>;

export const Sesion = z.object({
  operador: Operador,
  expiraEn: Instante,
});
export type Sesion = z.infer<typeof Sesion>;
