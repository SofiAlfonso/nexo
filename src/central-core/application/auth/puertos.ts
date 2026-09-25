import type { Rol } from '@nexo/shared/contracts';

/** Fila de `auth.operadores` (D2): un usuario de laboratorio por rol (ADR-016). */
export interface UsuarioAuth {
  /** Identificador interno (`auth.operadores.id`, `bigint`); no se expone al cliente. */
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  contrasenaHash: string;
}

/** Puerto de persistencia para el login; la infraestructura lo implementa contra D2. */
export interface AuthRepositorio {
  buscarPorUsuario(usuario: string): Promise<UsuarioAuth | null>;
  buscarPorId(operadorId: string): Promise<UsuarioAuth | null>;
}

/**
 * Puerto de sesiones (`auth.sesiones`): el `id` almacenado es un digesto del token de la
 * cookie, nunca el token en claro (schema.md), para que una fuga de la tabla no equivalga
 * a robar cookies válidas.
 */
export interface SesionesRepositorio {
  crear(digestoToken: string, operadorId: string, expiraEn: Date): Promise<void>;
  /** `null` si no existe, está revocada o venció. */
  buscarVigente(digestoToken: string): Promise<{ operadorId: string; expiraEn: Date } | null>;
  revocar(digestoToken: string): Promise<void>;
}
