import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { ROL_TEXTO, type Rol, type Sesion } from '@nexo/shared/contracts';
import type { AuthRepositorio, SesionesRepositorio } from './puertos.ts';

/** Duración de la sesión del panel (laboratorio; ADR-016 no fija un valor). */
export const DURACION_SESION_MS = 8 * 60 * 60 * 1000;

export class CredencialesInvalidas extends Error {
  constructor() {
    super('Usuario o contraseña inválidos');
  }
}

/** Digesto SHA-256 del token de cookie; es lo único que se guarda en `auth.sesiones.id`. */
export function digestoToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Verifica usuario y contraseña contra D2 (argon2), crea la sesión server-side en
 * `auth.sesiones` y arma la `Sesion` a devolver. El rol siempre sale del usuario
 * autenticado, nunca de un selector del cliente (ADR-016). El token de cookie es opaco
 * y aleatorio; solo su digesto se persiste (schema.md).
 */
export class ServicioAuth {
  private readonly repositorio: AuthRepositorio;
  private readonly sesiones: SesionesRepositorio;

  constructor(repositorio: AuthRepositorio, sesiones: SesionesRepositorio) {
    this.repositorio = repositorio;
    this.sesiones = sesiones;
  }

  /** Devuelve el token de cookie (en claro, para `Set-Cookie`) y la `Sesion` del operador. */
  async iniciarSesion(usuario: string, contrasena: string): Promise<{ token: string; sesion: Sesion }> {
    const registro = await this.repositorio.buscarPorUsuario(usuario);
    if (!registro) throw new CredencialesInvalidas();

    const valida = await argon2.verify(registro.contrasenaHash, contrasena).catch(() => false);
    if (!valida) throw new CredencialesInvalidas();

    const token = randomBytes(32).toString('base64url');
    const expiraEn = new Date(Date.now() + DURACION_SESION_MS);
    await this.sesiones.crear(digestoToken(token), registro.id, expiraEn);

    return { token, sesion: this.construirSesion(registro.usuario, registro.nombre, registro.rol, expiraEn) };
  }

  /** `null` si el token no corresponde a una sesión vigente. */
  async verificarToken(token: string): Promise<Sesion | null> {
    const vigente = await this.sesiones.buscarVigente(digestoToken(token));
    if (!vigente) return null;
    const registro = await this.repositorio.buscarPorId(vigente.operadorId);
    if (!registro) return null;
    return this.construirSesion(registro.usuario, registro.nombre, registro.rol, vigente.expiraEn);
  }

  async cerrarSesion(token: string): Promise<void> {
    await this.sesiones.revocar(digestoToken(token));
  }

  private construirSesion(usuario: string, nombre: string, rol: Rol, expiraEn: Date): Sesion {
    return {
      operador: { usuario, nombre, rol, rolTexto: ROL_TEXTO[rol] },
      expiraEn: expiraEn.toISOString(),
    };
  }
}
