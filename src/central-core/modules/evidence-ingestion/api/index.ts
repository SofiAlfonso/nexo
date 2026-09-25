import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { AcuseLoteEvidencia, LoteEvidencia } from '../../../../shared/contracts/e1.ts';
import { Incidente, ListaIncidentes } from '../../../../shared/contracts/o2.ts';
import { RUTAS } from '../../../../shared/contracts/routes.ts';
import {
  ConflictoEvidencia, ServicioIngestaEvidencia, ServicioVigilanciaLatidos, type IncidenteRepositorio,
} from '../application/index.ts';
import { RepositorioIncidentesPg, RepositorioLotesPg, RepositorioPuntosPg } from '../infrastructure/index.ts';

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
    try {
      return AcuseLoteEvidencia.parse(await servicio.procesarLote(parsed.data));
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
}
