import type { FastifyInstance } from 'fastify';
import { RUTAS, type EventoStream } from '@nexo/shared/contracts';
import type { ServicioO2 } from '../../application/o2/servicio-o2.ts';
import type { HubStream } from '../stream/hub.ts';

/** Latido de conexión SSE, cada 15 s (contrato O2, comentario de `EventoStream`). */
const INTERVALO_LATIDO_MS = 15_000;

/**
 * `GET /api/stream`: al conectar (o reconectar) envía primero el `estado` completo (T2 §5.4),
 * luego retransmite lo que publique `HubStream` (lotes E1 procesados, incidentes nuevos) y
 * manda un latido `: ping` cada 15 s para mantener viva la conexión.
 */
export function registrarRutaStream(fastify: FastifyInstance, servicio: ServicioO2, hub: HubStream): void {
  fastify.get(RUTAS.stream.ruta, (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    let secuencia = 0;
    const enviar = (evento: EventoStream): void => {
      secuencia += 1;
      reply.raw.write(`id: ${secuencia}\nevent: ${evento.tipo}\ndata: ${JSON.stringify(evento.datos)}\n\n`);
    };

    servicio.obtenerEstadoActual()
      .then(estado => {
        if (estado) enviar({ tipo: 'estado', datos: estado });
      })
      .catch(error => fastify.log.error(error, 'No se pudo enviar el estado inicial de /api/stream'));

    const cancelarSuscripcion = hub.suscribir(enviar);
    const latido = setInterval(() => reply.raw.write(': ping\n\n'), INTERVALO_LATIDO_MS);

    request.raw.on('close', () => {
      clearInterval(latido);
      cancelarSuscripcion();
      reply.raw.end();
    });
  });
}
