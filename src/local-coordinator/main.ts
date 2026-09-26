import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from './application/autoridad.ts';
import { DespachadorOutbox } from './application/despachador-outbox.ts';
import { RegistroLatidos } from './application/latidos.ts';
import { ContadorV1 } from './application/prioridad.ts';
import type { Almacen } from './application/puertos.ts';
import { ServicioValidacion } from './application/servicio-validacion.ts';
import { crearServidor } from './api/servidor.ts';
import { cargarConfig } from './config.ts';
import type { ConfigCoordinador } from './config.ts';
import { crearClienteE1Http } from './infrastructure/e1/cliente-e1.ts';
import { cargarConfigPermisos, crearSincronizadorPermisos } from './infrastructure/permisos/index.ts';
import { crearAlmacenMemoria, semillaDemo } from './infrastructure/persistence/memoria/almacen-memoria.ts';
import { crearAlmacenPostgres } from './infrastructure/persistence/postgres/index.ts';

export async function iniciarCoordinador(config: ConfigCoordinador = cargarConfig()) {
  let almacen: Almacen;
  if (config.postgres) {
    almacen = await crearAlmacenPostgres(config.postgres, { eventoId: config.eventoId, migrar: config.migrarD1, lockTimeoutMs: config.plazoValidacionMs, sentenciaTimeoutMs: config.plazoValidacionMs });
  } else {
    const memoria = crearAlmacenMemoria();
    memoria.sembrar(semillaDemo(new Date()));
    almacen = memoria;
  }
  const autoridad = new AutoridadNodoUnico(config.coordinadorId);
  const latidos = new RegistroLatidos();
  const contador = new ContadorV1();
  const reloj = { ahora: () => new Date() };
  const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
    unidades: almacen.unidades, alcance: almacen.alcance, autoridad, reloj,
  }), contador, config, reloj);
  const app = crearServidor({ servicio, almacen, latidos, config, reloj, logger: true });
  if (!config.postgres) app.log.warn('D1 en memoria: datos de demostración, no persistentes');

  let versiones = await almacen.permisos.versionInstalada(config.eventoId);
  const refresco = config.centralUrl ? setInterval(() => {
    void almacen.permisos.versionInstalada(config.eventoId).then((nuevas) => { versiones = nuevas; })
      .catch((fallo: unknown) => app.log.warn({ fallo }, 'No se pudieron refrescar versiones'));
  }, 10_000) : null;
  refresco?.unref();
  // P2: C2 instala en D1 los permisos firmados por M1; la decisión sigue siendo local.
  const permisosP2 = config.centralUrl && config.postgres ? crearSincronizadorPermisos({
    ...cargarConfigPermisos(), postgres: config.postgres, centralUrl: config.centralUrl,
    eventoId: config.eventoId, recintoId: config.recintoId, log: app.log,
  }) : null;
  const despachador = config.centralUrl ? new DespachadorOutbox({
    outbox: almacen.outbox, latidos, v1: contador, cliente: crearClienteE1Http(config.centralUrl),
    config, estado: () => ({
      estado: autoridad.actual().estado,
      versionPermisos: versiones?.versionPermisos ?? 0,
      versionPoliticas: versiones?.versionPoliticas ?? 0,
    }), log: app.log,
  }) : null;
  try {
    await app.listen({ host: config.host, port: config.port });
    despachador?.iniciar();
    permisosP2?.sincronizador.iniciar();
  } catch (fallo) {
    if (refresco) clearInterval(refresco);
    await permisosP2?.cerrar();
    await app.close();
    await almacen.cerrar();
    throw fallo;
  }

  let deteniendo: Promise<void> | null = null;
  const detener = () => {
    deteniendo ??= (async () => {
      if (refresco) clearInterval(refresco);
      await despachador?.detener();
      await permisosP2?.cerrar();
      await app.close();
      await almacen.cerrar();
    })();
    return deteniendo;
  };
  return { app, almacen, autoridad, servicio, detener };
}

/** Arranca C2 como proceso: señales SIGINT/SIGTERM detienen ordenadamente. */
export function ejecutarComoProceso(): void {
  void iniciarCoordinador().then(({ detener }) => {
    const salir = () => { void detener().then(() => { process.exitCode = 0; }).catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    }); };
    process.once('SIGINT', salir);
    process.once('SIGTERM', salir);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

if (import.meta.main) ejecutarComoProceso();
