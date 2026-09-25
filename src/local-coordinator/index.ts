import { ejecutarComoProceso } from './main.ts';

export { crearServidor } from './api/servidor.ts';
export { ServicioValidacion } from './application/servicio-validacion.ts';
export { crearAlmacenMemoria, semillaDemo } from './infrastructure/persistence/memoria/almacen-memoria.ts';
export { ejecutarComoProceso, iniciarCoordinador } from './main.ts';

// `npm run dev` y la imagen Docker arrancan este archivo directamente.
if (import.meta.main) ejecutarComoProceso();
