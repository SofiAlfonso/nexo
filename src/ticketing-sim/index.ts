import { ejecutarComoProceso } from './main.ts';

export { crearServidor } from './api/index.ts';
export { cargarConfig } from './config.ts';
export type { ConfigBoleteria } from './config.ts';
export * from './domain/index.ts';
export { ejecutarComoProceso, iniciarBoleteria } from './main.ts';

if (import.meta.main) ejecutarComoProceso();
