import { iniciarTelemetria } from '@nexo/shared/telemetry';
import { ejecutarComoProceso } from './main.ts';

export { crearApp } from './api/server.ts';
export { iniciarCentral, ejecutarComoProceso } from './main.ts';

// `npm run dev` y el Dockerfile arrancan este archivo directamente.
if (import.meta.main) {
  iniciarTelemetria({ servicio: 'nexo-central-core' });
  ejecutarComoProceso();
}
