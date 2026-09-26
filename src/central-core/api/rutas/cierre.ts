import type { FastifyInstance, FastifyReply } from 'fastify';
import { Conciliacion, ResolucionDiferencia, RUTAS, SolicitudCierre, type CodigoError, type Rol } from '@nexo/shared/contracts';
import {
  ConflictoEstadoConciliacion,
  DiferenciaNoEncontrada,
  OpcionInvalida,
  type ServicioConciliacion,
} from '../../modules/reconciliation/api/index.ts';

function error(reply: FastifyReply, estado: number, error: CodigoError, mensaje: string, detalles?: unknown) {
  const cuerpo: { error: CodigoError; mensaje: string; detalles?: unknown } = { error, mensaje, ...(detalles !== undefined ? { detalles } : {}) };
  return reply.code(estado).send(cuerpo);
}

/** Mapea los errores de dominio de M3 a la taxonomía de errores O2 (D12). */
async function conManejoDeErrores(reply: FastifyReply, tarea: () => Promise<unknown>): Promise<unknown> {
  try {
    const resultado = await tarea();
    return Conciliacion.parse(resultado);
  } catch (fallo) {
    if (fallo instanceof ConflictoEstadoConciliacion) {
      return error(reply, 409, 'CONFLICTO_ESTADO', fallo.message, { pendientes: fallo.pendientes });
    }
    if (fallo instanceof DiferenciaNoEncontrada) {
      return error(reply, 404, 'NO_ENCONTRADO', fallo.message);
    }
    if (fallo instanceof OpcionInvalida) {
      return error(reply, 400, 'SOLICITUD_INVALIDA', fallo.message);
    }
    throw fallo;
  }
}

/**
 * M3/M4: rutas O2 de cierre (`#/cierre`). El panel nunca decide; solo `CIERRE` puede entregar el
 * preliminar, declarar conciliado y resolver diferencias, y solo `FINANZAS` puede registrar el
 * cobro (ADR-016). Reemplaza los 501 de `registrarRutasO2`.
 */
export function registrarRutasCierre(fastify: FastifyInstance, servicio: ServicioConciliacion): void {
  fastify.post(RUTAS.cierrePreliminar.ruta, async (request, reply) => {
    const sesion = request.sesion;
    if (!sesion) return error(reply, 401, 'NO_AUTENTICADO', 'Se requiere iniciar sesión');
    if (sesion.operador.rol !== 'CIERRE') return error(reply, 403, 'NO_AUTORIZADO', 'Solo el responsable de cierre puede entregar el informe preliminar');
    const parseo = SolicitudCierre.safeParse(request.body ?? {});
    if (!parseo.success) return error(reply, 400, 'SOLICITUD_INVALIDA', 'Solicitud de cierre inválida');
    const eventoId = await servicio.eventoActualId();
    if (!eventoId) return error(reply, 404, 'NO_ENCONTRADO', 'No hay un evento actual');
    return conManejoDeErrores(reply, () => servicio.entregarPreliminar(eventoId, sesion.operador.usuario));
  });

  fastify.post(RUTAS.cierreDefinitivo.ruta, async (request, reply) => {
    const sesion = request.sesion;
    if (!sesion) return error(reply, 401, 'NO_AUTENTICADO', 'Se requiere iniciar sesión');
    if (sesion.operador.rol !== 'CIERRE') return error(reply, 403, 'NO_AUTORIZADO', 'Solo el responsable de cierre puede declarar el cierre definitivo');
    const parseo = SolicitudCierre.safeParse(request.body ?? {});
    if (!parseo.success) return error(reply, 400, 'SOLICITUD_INVALIDA', 'Solicitud de cierre inválida');
    const eventoId = await servicio.eventoActualId();
    if (!eventoId) return error(reply, 404, 'NO_ENCONTRADO', 'No hay un evento actual');
    return conManejoDeErrores(reply, () => servicio.declararConciliado(eventoId, sesion.operador.usuario));
  });

  fastify.post<{ Params: { id: string } }>(RUTAS.resolverDiferencia.ruta, async (request, reply) => {
    const sesion = request.sesion;
    if (!sesion) return error(reply, 401, 'NO_AUTENTICADO', 'Se requiere iniciar sesión');
    if (sesion.operador.rol !== 'CIERRE') return error(reply, 403, 'NO_AUTORIZADO', 'Solo el responsable de cierre puede resolver diferencias');
    const parseo = ResolucionDiferencia.safeParse(request.body);
    if (!parseo.success) return error(reply, 400, 'SOLICITUD_INVALIDA', 'Resolución de diferencia inválida');
    const eventoId = await servicio.eventoActualId();
    if (!eventoId) return error(reply, 404, 'NO_ENCONTRADO', 'No hay un evento actual');
    const operador: { usuario: string; rol: Rol } = { usuario: sesion.operador.usuario, rol: sesion.operador.rol };
    return conManejoDeErrores(reply, () => servicio.resolverDiferencia(eventoId, request.params.id, parseo.data.opcion, operador));
  });

  fastify.post(RUTAS.cobro.ruta, async (request, reply) => {
    const sesion = request.sesion;
    if (!sesion) return error(reply, 401, 'NO_AUTENTICADO', 'Se requiere iniciar sesión');
    if (sesion.operador.rol !== 'FINANZAS') return error(reply, 403, 'NO_AUTORIZADO', 'Solo el líder comercial y financiero puede registrar el cobro');
    const parseo = SolicitudCierre.safeParse(request.body ?? {});
    if (!parseo.success) return error(reply, 400, 'SOLICITUD_INVALIDA', 'Solicitud de cobro inválida');
    const eventoId = await servicio.eventoActualId();
    if (!eventoId) return error(reply, 404, 'NO_ENCONTRADO', 'No hay un evento actual');
    return conManejoDeErrores(reply, () => servicio.registrarCobro(eventoId));
  });
}
