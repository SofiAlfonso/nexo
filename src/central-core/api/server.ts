import path from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { LoteEvidencia, RUTAS } from '@nexo/shared/contracts';
import { conSpan, trace } from '@nexo/shared/telemetry';
import { ServicioAuth } from '../application/auth/servicioAuth.ts';
import { ServicioO2 } from '../application/o2/servicio-o2.ts';
import { AuthRepositorioPg, SesionesRepositorioPg } from '../infrastructure/auth-repositorio.ts';
import { EstadoOperativoRepositorioPg, EventoActualO2RepositorioPg, IntentosRepositorioPg, PreparacionRepositorioPg, AccionesRepositorioPg, BoletasRepositorioPg, ActividadRepositorioPg } from '../infrastructure/o2-repositorio.ts';
import { crearServicioPermisos, registrarRutasPermisos } from '../modules/configuration-permissions/api/index.ts';
import { PuntoConfigRepositorioPg } from '../modules/configuration-permissions/infrastructure/index.ts';
import {
  crearServicioIngestaEvidencia, crearServicioVigilanciaLatidos, registrarRutasEvidencia, registrarRutasIncidentes,
} from '../modules/evidence-ingestion/api/index.ts';
import { RepositorioIncidentesPg } from '../modules/evidence-ingestion/infrastructure/index.ts';
import { crearServicioLiquidacion } from '../modules/contracting-settlement/api/index.ts';
import { crearServicioConciliacion } from '../modules/reconciliation/api/index.ts';
import { HubStream } from './stream/hub.ts';
import { registrarRutasAuth } from './rutas/auth.ts';
import { registrarRutasCierre } from './rutas/cierre.ts';
import { registrarRutasO2 } from './rutas/o2.ts';
import { registrarRutaStream } from './rutas/stream.ts';
import { registrarGuardiaSesion } from './plugins/sesion.ts';

const tracer = trace.getTracer('nexo.central-core');

const RAIZ_WEB = path.join(import.meta.dirname, '..', 'web');

/** Cadencia de la vigilancia de latidos (regla SIN_COMUNICACION > 60 s). */
const INTERVALO_VIGILANCIA_MS = 10_000;

export interface AppC4 {
  fastify: FastifyInstance;
  /** Detiene el temporizador de vigilancia de latidos; usar en el cierre ordenado y en pruebas. */
  cerrar: () => void;
}

/** Construye y cablea el servidor Fastify de C4 (composición); no abre el puerto. */
export function crearApp(pool: Pool): AppC4 {
  const fastify = Fastify({ logger: true });

  const servicioAuth = new ServicioAuth(new AuthRepositorioPg(pool), new SesionesRepositorioPg(pool));
  const servicioPermisos = crearServicioPermisos(pool);
  const servicioIngesta = crearServicioIngestaEvidencia(pool);
  const servicioVigilancia = crearServicioVigilanciaLatidos(pool);
  const incidentesRepositorio = new RepositorioIncidentesPg(pool);
  const intentosRepositorio = new IntentosRepositorioPg(pool);
  const servicioLiquidacion = crearServicioLiquidacion(pool);
  const servicioConciliacion = crearServicioConciliacion(pool, servicioLiquidacion);
  const servicioO2 = new ServicioO2(
    new EventoActualO2RepositorioPg(pool),
    new PuntoConfigRepositorioPg(pool),
    new EstadoOperativoRepositorioPg(pool),
    incidentesRepositorio,
    new PreparacionRepositorioPg(pool),
    { obtenerConciliacion: eventoId => servicioConciliacion.obtenerConciliacion(eventoId) },
    intentosRepositorio,
    new AccionesRepositorioPg(pool),
    new BoletasRepositorioPg(pool),
    new ActividadRepositorioPg(pool),
  );
  const hub = new HubStream();


  const vigilancia = setInterval(() => {
    servicioVigilancia.revisarPuntosSinComunicacion()
      .then(async incidentes => {
        if (incidentes.length === 0) return;
        for (const incidente of incidentes) hub.publicar({ tipo: 'incidente', datos: incidente });
        const estado = await servicioO2.obtenerEstadoActual();
        if (estado) hub.publicar({ tipo: 'estado', datos: estado });
      })
      .catch(error => fastify.log.error(error, 'Fallo la vigilancia de latidos'));
  }, INTERVALO_VIGILANCIA_MS);
  vigilancia.unref();

  void fastify.register(fastifyCookie, {
    // Solo para desarrollo local: configurar SESSION_COOKIE_SECRET en cualquier entorno real.
    secret: process.env.SESSION_COOKIE_SECRET ?? 'nexo-desarrollo-inseguro',
  });
  void fastify.register(fastifyCors, { origin: true, credentials: true });
  void fastify.register(fastifyStatic, { root: RAIZ_WEB, prefix: '/' });

  registrarGuardiaSesion(fastify, servicioAuth);
  registrarRutasAuth(fastify, servicioAuth);
  registrarRutasPermisos(fastify, servicioPermisos);
  registrarRutasEvidencia(fastify, servicioIngesta);
  registrarRutasIncidentes(fastify, incidentesRepositorio);
  registrarRutasO2(fastify, servicioO2);
  registrarRutasCierre(fastify, servicioConciliacion);
  registrarRutaStream(fastify, servicioO2, hub);

  // Difunde por SSE cuando un lote E1 se acepta (no en reintentos repetidos): la reconexión ya
  // recupera el estado completo, así que basta con republicar el snapshot tras cada ingesta; los
  // registros `decision` recién aceptados también se emiten como eventos `intento` puntuales.
  fastify.addHook('onResponse', (request, reply, done) => {
    const esLoteEvidencia = request.method === 'POST' && request.url.split('?')[0] === RUTAS.loteEvidencia.ruta;
    if (esLoteEvidencia && reply.statusCode === RUTAS.loteEvidencia.estado) {
      void (async () => {
        try {
          await conSpan(tracer, 'panel.update', async () => {
            const estado = await servicioO2.obtenerEstadoActual();
            if (estado) hub.publicar({ tipo: 'estado', datos: estado });

            const lote = LoteEvidencia.safeParse(request.body);
            if (!lote.success) return;
            const idOrigenesDecision = lote.data.registros
              .filter(registro => registro.tipo === 'decision')
              .map(registro => registro.idOrigen);
            if (idOrigenesDecision.length === 0) return;
            const intentos = await intentosRepositorio.listarPorIdOrigen(lote.data.eventoId, idOrigenesDecision);
            for (const intento of intentos) hub.publicar({ tipo: 'intento', datos: intento });
          });
        } catch (error) {
          fastify.log.error(error, 'No se pudo difundir el estado/intento tras un lote E1');
        }
      })();
    }
    done();
  });

  return { fastify, cerrar: () => clearInterval(vigilancia) };
}

