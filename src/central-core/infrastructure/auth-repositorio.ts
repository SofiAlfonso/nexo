import type { Pool } from 'pg';
import type { Rol } from '@nexo/shared/contracts';
import type { AuthRepositorio, SesionesRepositorio, UsuarioAuth } from '../application/auth/puertos.ts';

interface FilaOperador {
  id: string;
  usuario: string;
  nombre: string;
  rol: string;
  contrasena_hash: string;
}

const mapearOperador = (fila: FilaOperador): UsuarioAuth => ({
  id: fila.id,
  usuario: fila.usuario,
  nombre: fila.nombre,
  rol: fila.rol as Rol,
  contrasenaHash: fila.contrasena_hash,
});

/** Repositorio de login contra `auth.operadores` (D2, ver `infrastructure/db/schema.md`). */
export class AuthRepositorioPg implements AuthRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async buscarPorUsuario(usuario: string): Promise<UsuarioAuth | null> {
    const resultado = await this.pool.query<FilaOperador>(
      'SELECT id::text, usuario, nombre, rol, contrasena_hash FROM auth.operadores WHERE usuario = $1 AND activo',
      [usuario],
    );
    const fila = resultado.rows[0];
    return fila ? mapearOperador(fila) : null;
  }

  async buscarPorId(operadorId: string): Promise<UsuarioAuth | null> {
    const resultado = await this.pool.query<FilaOperador>(
      'SELECT id::text, usuario, nombre, rol, contrasena_hash FROM auth.operadores WHERE id = $1 AND activo',
      [operadorId],
    );
    const fila = resultado.rows[0];
    return fila ? mapearOperador(fila) : null;
  }
}

/**
 * Repositorio de sesiones contra `auth.sesiones`. El `id` almacenado es el digesto SHA-256
 * del token de cookie (nunca el token en claro, ver schema.md).
 */
export class SesionesRepositorioPg implements SesionesRepositorio {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  async crear(digestoToken: string, operadorId: string, expiraEn: Date): Promise<void> {
    await this.pool.query(
      'INSERT INTO auth.sesiones (id, operador_id, expira_en) VALUES ($1, $2, $3)',
      [digestoToken, operadorId, expiraEn],
    );
  }

  async buscarVigente(digestoToken: string): Promise<{ operadorId: string; expiraEn: Date } | null> {
    const resultado = await this.pool.query<{ operador_id: string; expira_en: Date }>(
      `SELECT operador_id::text, expira_en FROM auth.sesiones
       WHERE id = $1 AND revocada_en IS NULL AND expira_en > now()`,
      [digestoToken],
    );
    const fila = resultado.rows[0];
    return fila ? { operadorId: fila.operador_id, expiraEn: fila.expira_en } : null;
  }

  async revocar(digestoToken: string): Promise<void> {
    await this.pool.query(
      'UPDATE auth.sesiones SET revocada_en = now() WHERE id = $1 AND revocada_en IS NULL',
      [digestoToken],
    );
  }
}
