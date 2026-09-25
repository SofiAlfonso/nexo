import type { z } from 'zod';
import { Sesion, SolicitudLogin } from './auth.ts';
import { AcuseLoteEvidencia, LoteEvidencia } from './e1.ts';
import { AcuseLatido, AcuseLoteDiario, Latido, LoteDiario } from './h1.ts';
import {
  AccionIncidente,
  Boleta,
  CambioControl,
  Conciliacion,
  ConsultaIntentos,
  DecisionAccion,
  EstadoActual,
  Incidente,
  ListaIntentos,
  Accion,
  ListaAcciones,
  ListaActividad,
  ListaIncidentes,
  ListaPuntos,
  Preparacion,
  PuntoDetalle,
  ResolucionDiferencia,
  SolicitudCierre,
} from './o2.ts';
import { IndiceVersiones, VersionBoleteria } from './p1.ts';
import { ConsultaPermisos, PaquetePermisos } from './p2.ts';
import { RespuestaValidacion, SolicitudValidacion } from './v1.ts';

export type Metodo = 'GET' | 'POST';
export type Servidor = 'local-coordinator' | 'central-core' | 'ticketing-sim';

export interface Ruta {
  contrato: 'V1' | 'H1' | 'E1' | 'P1' | 'P2' | 'O2' | 'Auth';
  metodo: Metodo;
  /** Ruta con parámetros al estilo Fastify (`:id`). */
  ruta: string;
  servidor: Servidor;
  cuerpo?: z.ZodType;
  consulta?: z.ZodType;
  respuesta?: z.ZodType;
  estado: number;
}

/** Catálogo de rutas. Los servidores y clientes lo usan para validar entradas y salidas. */
export const RUTAS = {
  validar: { contrato: 'V1', metodo: 'POST', ruta: '/v1/validaciones', servidor: 'local-coordinator', cuerpo: SolicitudValidacion, respuesta: RespuestaValidacion, estado: 200 },
  latido: { contrato: 'H1', metodo: 'POST', ruta: '/v1/heartbeats', servidor: 'local-coordinator', cuerpo: Latido, respuesta: AcuseLatido, estado: 200 },
  loteDiario: { contrato: 'H1', metodo: 'POST', ruta: '/v1/diario/lotes', servidor: 'local-coordinator', cuerpo: LoteDiario, respuesta: AcuseLoteDiario, estado: 200 },
  loteEvidencia: { contrato: 'E1', metodo: 'POST', ruta: '/v1/lotes-evidencia', servidor: 'central-core', cuerpo: LoteEvidencia, respuesta: AcuseLoteEvidencia, estado: 200 },
  permisos: { contrato: 'P2', metodo: 'GET', ruta: '/v1/permisos', servidor: 'central-core', consulta: ConsultaPermisos, respuesta: PaquetePermisos, estado: 200 },
  versiones: { contrato: 'P1', metodo: 'GET', ruta: '/versiones', servidor: 'ticketing-sim', respuesta: IndiceVersiones, estado: 200 },
  version: { contrato: 'P1', metodo: 'GET', ruta: '/versiones/:n', servidor: 'ticketing-sim', respuesta: VersionBoleteria, estado: 200 },
  login: { contrato: 'Auth', metodo: 'POST', ruta: '/api/auth/login', servidor: 'central-core', cuerpo: SolicitudLogin, respuesta: Sesion, estado: 200 },
  logout: { contrato: 'Auth', metodo: 'POST', ruta: '/api/auth/logout', servidor: 'central-core', estado: 204 },
  me: { contrato: 'Auth', metodo: 'GET', ruta: '/api/auth/me', servidor: 'central-core', respuesta: Sesion, estado: 200 },
  estado: { contrato: 'O2', metodo: 'GET', ruta: '/api/eventos/actual/estado', servidor: 'central-core', respuesta: EstadoActual, estado: 200 },
  puntos: { contrato: 'O2', metodo: 'GET', ruta: '/api/puntos', servidor: 'central-core', respuesta: ListaPuntos, estado: 200 },
  punto: { contrato: 'O2', metodo: 'GET', ruta: '/api/puntos/:id', servidor: 'central-core', respuesta: PuntoDetalle, estado: 200 },
  intentos: { contrato: 'O2', metodo: 'GET', ruta: '/api/intentos', servidor: 'central-core', consulta: ConsultaIntentos, respuesta: ListaIntentos, estado: 200 },
  boleta: { contrato: 'O2', metodo: 'GET', ruta: '/api/boletas/:ref', servidor: 'central-core', respuesta: Boleta, estado: 200 },
  incidentes: { contrato: 'O2', metodo: 'GET', ruta: '/api/incidentes', servidor: 'central-core', respuesta: ListaIncidentes, estado: 200 },
  incidente: { contrato: 'O2', metodo: 'GET', ruta: '/api/incidentes/:id', servidor: 'central-core', respuesta: Incidente, estado: 200 },
  accionIncidente: { contrato: 'O2', metodo: 'POST', ruta: '/api/incidentes/:id/acciones', servidor: 'central-core', cuerpo: AccionIncidente, respuesta: Incidente, estado: 200 },
  acciones: { contrato: 'O2', metodo: 'GET', ruta: '/api/acciones', servidor: 'central-core', respuesta: ListaAcciones, estado: 200 },
  decidirAccion: { contrato: 'O2', metodo: 'POST', ruta: '/api/acciones/:id', servidor: 'central-core', cuerpo: DecisionAccion, respuesta: Accion, estado: 200 },
  actividad: { contrato: 'O2', metodo: 'GET', ruta: '/api/actividad', servidor: 'central-core', respuesta: ListaActividad, estado: 200 },
  control: { contrato: 'O2', metodo: 'POST', ruta: '/api/preparacion/controles/:id', servidor: 'central-core', cuerpo: CambioControl, respuesta: Preparacion, estado: 200 },
  confirmarApertura: { contrato: 'O2', metodo: 'POST', ruta: '/api/preparacion/confirmar', servidor: 'central-core', respuesta: Preparacion, estado: 200 },
  cierrePreliminar: { contrato: 'O2', metodo: 'POST', ruta: '/api/cierre/preliminar', servidor: 'central-core', cuerpo: SolicitudCierre, respuesta: Conciliacion, estado: 200 },
  cierreDefinitivo: { contrato: 'O2', metodo: 'POST', ruta: '/api/cierre/definitivo', servidor: 'central-core', cuerpo: SolicitudCierre, respuesta: Conciliacion, estado: 200 },
  resolverDiferencia: { contrato: 'O2', metodo: 'POST', ruta: '/api/cierre/diferencias/:id', servidor: 'central-core', cuerpo: ResolucionDiferencia, respuesta: Conciliacion, estado: 200 },
  cobro: { contrato: 'O2', metodo: 'POST', ruta: '/api/cierre/cobro', servidor: 'central-core', cuerpo: SolicitudCierre, respuesta: Conciliacion, estado: 200 },
  stream: { contrato: 'O2', metodo: 'GET', ruta: '/api/stream', servidor: 'central-core', estado: 200 },
} as const satisfies Record<string, Ruta>;

export type NombreRuta = keyof typeof RUTAS;
