import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { conSpan, extraerContexto, SpanKind, trace } from '../../../../shared/telemetry/index.ts';
import { AcuseLoteEvidencia, LoteEvidencia } from '../../../../shared/contracts/e1.ts';
import { AccionIncidente, Incidente, ListaIncidentes } from '../../../../shared/contracts/o2.ts';
import type { CodigoError } from '../../../../shared/contracts/common.ts';
import { RUTAS } from '../../../../shared/contracts/routes.ts';
import {
  ConflictoEvidencia, ServicioIngestaEvidencia, ServicioVigilanciaLatidos, type IncidenteRepositorio,
} from '../application/index.ts';
import { RepositorioIncidentesPg, RepositorioLotesPg, RepositorioPuntosPg } from '../infrastructure/index.ts';

const tracer = trace.getTracer('nexo.central-core.evidence-ingestion');

export function crearServicioIngestaEvidencia(pool: Pool): ServicioIngestaEvidencia {
  return new ServicioIngestaEvidencia(new RepositorioLotesPg(pool));
}

export function crearServicioVigilanciaLatidos(pool: Pool): ServicioVigilanciaLatidos {
  return new ServicioVigilanciaLatidos(new RepositorioPuntosPg(pool), new RepositorioIncidentesPg(pool));
}

export function registrarRutasEvidencia(fastify: FastifyInstance, servicio: ServicioIngestaEvidencia): void {
  fastify.post(RUTAS.loteEvidencia.ruta, async (request, reply) => {
    const parsed = LoteEvidencia.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'SOLICITUD_INVALIDA', mensaje: 'Lote de evidencia inválido' });
    }
    const padre = extraerContexto(request.headers);
    try {
      return await conSpan(tracer, 'evidence.receive', async (span) => {
        span.setAttribute('nexo.id_lote', parsed.data.idLote);
        span.setAttribute('nexo.registros', parsed.data.registros.length);
        return AcuseLoteEvidencia.parse(await servicio.procesarLote(parsed.data));
      }, { kind: SpanKind.SERVER, padre });
    } catch (error) {
      if (error instanceof ConflictoEvidencia) {
        return reply.code(409).send({ error: error.codigo, mensaje: error.message });
      }
      throw error;
    }
  });
}

export function registrarRutasIncidentes(fastify: FastifyInstance, incidentes: IncidenteRepositorio): void {
  fastify.get(RUTAS.incidentes.ruta, async () => ListaIncidentes.parse(await incidentes.listar()));
  fastify.get<{ Params: { id: string } }>(RUTAS.incidente.ruta, async (request, reply) => {
    const incidente = await incidentes.obtener(request.params.id);
    if (!incidente) {
      return reply.code(404).send({ error: 'NO_ENCONTRADO', mensaje: 'Incidente no encontrado' });
    }
    return Incidente.parse(incidente);
  });

  // T31/KR1.3: persiste la acción del operador (y su tiempo de reacción) en D2.
  fastify.post<{ Params: { id: string } }>(RUTAS.accionIncidente.ruta, async (request, reply) => {
    const parseo = AccionIncidente.safeParse(request.body);
    if (!parseo.success) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'SOLICITUD_INVALIDA', mensaje: 'Acción de incidente inválida' };
      return reply.code(400).send(cuerpo);
    }
    const operador = request.sesion?.operador;
    if (!operador) {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_AUTENTICADO', mensaje: 'Se requiere iniciar sesión' };
      return reply.code(401).send(cuerpo);
    }
    const resultado = await incidentes.aplicarAccion(request.params.id, parseo.data, { usuario: operador.usuario, rol: operador.rol });
    if (resultado.tipo === 'no-encontrada') {
      const cuerpo: { error: CodigoError; mensaje: string } = { error: 'NO_ENCONTRADO', mensaje: 'Incidente no encontrado' };
      return reply.code(404).send(cuerpo);
    }
    return Incidente.parse(resultado.incidente);
  });
}
