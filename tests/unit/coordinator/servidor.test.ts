import { afterEach, describe, expect, it } from 'vitest';
import { AcuseLatido, AcuseLoteDiario, ErrorRespuesta, RespuestaValidacion } from '@nexo/shared/contracts';
import { ValidarPrimerIngreso } from '@nexo/shared/domain';
import { AutoridadNodoUnico } from '../../../src/local-coordinator/application/autoridad.ts';
import { RegistroLatidos } from '../../../src/local-coordinator/application/latidos.ts';
import { ContadorV1 } from '../../../src/local-coordinator/application/prioridad.ts';
import { ServicioValidacion } from '../../../src/local-coordinator/application/servicio-validacion.ts';
import { crearServidor } from '../../../src/local-coordinator/api/servidor.ts';
import { cargarConfig } from '../../../src/local-coordinator/config.ts';
import { crearAlmacenMemoria, semillaDemo } from '../../../src/local-coordinator/infrastructure/persistence/memoria/almacen-memoria.ts';

const inicial = new Date('2026-09-25T17:00:00.000Z');
const aplicaciones: ReturnType<typeof crearServidor>[] = [];
afterEach(async () => { await Promise.all(aplicaciones.splice(0).map((app) => app.close())); });

function preparar(plazo = 500) {
  let instante = new Date(inicial);
  const reloj = { ahora: () => new Date(instante) };
  const avanzar = (ms: number) => { instante = new Date(instante.getTime() + ms); };
  const almacen = crearAlmacenMemoria();
  almacen.sembrar(semillaDemo(inicial));
  const latidos = new RegistroLatidos();
  const config = { ...cargarConfig({}), plazoValidacionMs: plazo };
  const contador = new ContadorV1();
  const servicio = new ServicioValidacion(new ValidarPrimerIngreso({
    unidades: almacen.unidades, alcance: almacen.alcance,
    autoridad: new AutoridadNodoUnico(config.coordinadorId), reloj,
  }), contador, config, reloj);
  const app = crearServidor({ servicio, almacen, latidos, config, reloj });
  aplicaciones.push(app);
  return { app, almacen, latidos, contador, avanzar };
}

function solicitud(idOrigen = 'LX-2210-107:1', codigo = 'TA-8800-0001', puntoId = 'P-01', lectorId = 'LX-2210-107') {
  return {
    idOrigen, eventoId: 'EVT-2026-02', lectorId, puntoId, codigo,
    proposito: 'ingreso', zonaSolicitada: 'Norte', instanteLector: inicial.toISOString(),
  };
}

describe('C2 HTTP V1 y H1', () => {
  it('confirma una admisión una sola vez, rechaza reuso y preserva la decisión idempotente', async () => {
    const { app, almacen, avanzar } = preparar();
    const original = solicitud();
    const primero = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: original });
    expect(primero.statusCode).toBe(200);
    expect(RespuestaValidacion.parse(primero.json())).toMatchObject({ decision: 'aceptado', admision: true, repetida: false });
    avanzar(4000);
    const reuso = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud('LX-2210-107:2') });
    expect(RespuestaValidacion.parse(reuso.json())).toMatchObject({ decision: 'rechazado', motivo: 'USO_YA_REGISTRADO' });
    const repetido = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: original });
    expect(RespuestaValidacion.parse(repetido.json())).toMatchObject({ decision: 'aceptado', repetida: true });
    const conflicto = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud(original.idOrigen, 'TA-8800-0002') });
    expect(conflicto.statusCode).toBe(409);
    expect(ErrorRespuesta.parse(conflicto.json()).error).toBe('CONFLICTO_IDEMPOTENCIA');
    const filas = await almacen.outbox.pendientes(20);
    expect(filas.filter((f) => f.registro.tipo === 'decision' && f.registro.decision === 'aceptado')).toHaveLength(1);
  });

  it('valida el cuerpo, revocación y errores de JSON', async () => {
    const { app, almacen } = preparar();
    const invalida = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: {} });
    expect(invalida.statusCode).toBe(400);
    expect(ErrorRespuesta.parse(invalida.json()).detalles).toBeDefined();
    almacen.sembrar({ ...semillaDemo(inicial), lectores: [{ lectorId: 'LX-2210-107', eventoId: 'EVT-2026-02', puntoId: 'P-01', revocado: true }] });
    const revocado = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() });
    expect(revocado.statusCode).toBe(403);
    expect(ErrorRespuesta.parse(revocado.json()).error).toBe('NO_AUTORIZADO');
    const json = await app.inject({ method: 'POST', url: '/v1/validaciones', headers: { 'content-type': 'application/json' }, payload: '{' });
    expect(json.statusCode).toBe(400);
    expect(ErrorRespuesta.parse(json.json()).error).toBe('SOLICITUD_INVALIDA');
  });

  it('no autoriza si D1 cae y notifica salud no disponible', async () => {
    const { app, almacen } = preparar();
    almacen.simularCaida(true);
    const falla = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() });
    expect(RespuestaValidacion.parse(falla.json()).decision).toBe('sin-respuesta');
    expect((await app.inject('/listo')).statusCode).toBe(503);
    almacen.simularCaida(false);
    expect(almacen.volcado().consumos).toHaveLength(0);
    expect(RespuestaValidacion.parse((await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() })).json()).decision).toBe('aceptado');
    expect((await app.inject('/salud')).json()).toEqual({ estado: 'ok' });
  });

  it('vence el plazo sin cancelar la transacción que luego recupera el reintento', async () => {
    const { app, almacen, contador } = preparar(15);
    const abrir = almacen.unidades.abrir.bind(almacen.unidades);
    almacen.unidades.abrir = async () => {
      const unidad = await abrir();
      const cargar = unidad.cargarParaActualizar.bind(unidad);
      unidad.cargarParaActualizar = async (intento) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return cargar(intento);
      };
      return unidad;
    };
    const inicio = Date.now();
    const respuesta = await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() });
    expect(RespuestaValidacion.parse(respuesta.json()).decision).toBe('sin-respuesta');
    expect(Date.now() - inicio).toBeLessThan(55);
    expect(contador.enCurso()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(contador.enCurso()).toBe(0);
    expect(almacen.volcado().consumos).toHaveLength(1);
    almacen.unidades.abrir = abrir;
    expect(RespuestaValidacion.parse((await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() })).json()))
      .toMatchObject({ decision: 'aceptado', repetida: true });
  });

  it('serializa dos puntos competidores y acepta exactamente una vez', async () => {
    const { app, almacen } = preparar();
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud('LX-2210-107:11') }),
      app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud('LX-2210-114:11', 'TA-8800-0001', 'P-02', 'LX-2210-114') }),
    ]);
    expect([RespuestaValidacion.parse(a.json()).decision, RespuestaValidacion.parse(b.json()).decision].sort())
      .toEqual(['aceptado', 'rechazado']);
    expect(almacen.volcado().consumos).toHaveLength(1);
  });

  it('registra latidos y recupera el diario sin volver a decidir', async () => {
    const { app, almacen, latidos } = preparar();
    const latido = {
      lectorId: 'LX-2210-107', puntoId: 'P-01', eventoId: 'EVT-2026-02',
      instanteLector: inicial.toISOString(), secuencia: 1, estadoLector: 'operativo',
      pendientesDiario: 1, diarioTotal: 1, versionPermisos: 37,
    };
    const l = await app.inject({ method: 'POST', url: '/v1/heartbeats', payload: latido });
    expect(AcuseLatido.parse(l.json()).intervaloS).toBe(10);
    expect(latidos.ultimo('P-01')?.secuencia).toBe(1);
    await app.inject({ method: 'POST', url: '/v1/validaciones', payload: solicitud() });
    const registro = (idOrigen: string) => ({
      idOrigen, codigo: 'TA-8800-0002', proposito: 'ingreso', zonaSolicitada: 'Norte',
      instanteLector: inicial.toISOString(), motivoLocal: 'SIN_COORDINADOR', latenciaMs: null,
    });
    const lote = {
      idLote: 'lote-00001', lectorId: latido.lectorId, puntoId: latido.puntoId,
      eventoId: latido.eventoId, registros: [registro('LX-2210-107:1'), registro('LX-2210-107:diario1')],
    };
    const uno = await app.inject({ method: 'POST', url: '/v1/diario/lotes', payload: lote });
    expect(AcuseLoteDiario.parse(uno.json())).toMatchObject({
      aceptados: ['LX-2210-107:diario1'], duplicados: [], yaDecididos: ['LX-2210-107:1'], repetido: false,
    });
    const repetido = await app.inject({ method: 'POST', url: '/v1/diario/lotes', payload: lote });
    expect(AcuseLoteDiario.parse(repetido.json()).repetido).toBe(true);
    const otro = await app.inject({ method: 'POST', url: '/v1/diario/lotes', payload: { ...lote, idLote: 'lote-00002' } });
    expect(AcuseLoteDiario.parse(otro.json()).duplicados).toEqual(['LX-2210-107:diario1']);
    expect(almacen.volcado().consumos).toHaveLength(1);
    expect((await almacen.outbox.pendientes(20)).filter((f) => f.registro.tipo === 'intento-diario')).toHaveLength(1);
    const grande = await app.inject({ method: 'POST', url: '/v1/diario/lotes', payload: { ...lote, registros: Array(501).fill(registro('LX-2210-107:extra')) } });
    expect(grande.statusCode).toBe(413);
    expect(ErrorRespuesta.parse(grande.json()).error).toBe('LOTE_DEMASIADO_GRANDE');
    almacen.simularCaida(true);
    const caido = await app.inject({ method: 'POST', url: '/v1/diario/lotes', payload: { ...lote, idLote: 'lote-00003' } });
    expect(caido.statusCode).toBe(503);
    expect(ErrorRespuesta.parse(caido.json()).error).toBe('NO_DISPONIBLE');
  });
});
