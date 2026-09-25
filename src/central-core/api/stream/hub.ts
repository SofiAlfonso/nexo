import { EventEmitter } from 'node:events';
import type { EventoStream } from '@nexo/shared/contracts';

/**
 * Difusor en memoria de eventos O2 (`GET /api/stream`). Nodo único en el laboratorio (sin
 * réplica): no necesita coordinarse entre procesos.
 */
export class HubStream {
  private readonly emisor = new EventEmitter();

  constructor() {
    this.emisor.setMaxListeners(0);
  }

  publicar(evento: EventoStream): void {
    this.emisor.emit('evento', evento);
  }

  suscribir(oyente: (evento: EventoStream) => void): () => void {
    this.emisor.on('evento', oyente);
    return () => this.emisor.off('evento', oyente);
  }
}
