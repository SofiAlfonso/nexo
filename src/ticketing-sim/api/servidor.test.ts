import { afterEach, describe, expect, it } from 'vitest';
import { ErrorRespuesta, IndiceVersiones, VersionBoleteria } from '@nexo/shared/contracts';
import type { FastifyInstance } from 'fastify';
import { Boleteria } from '../domain/boleteria.ts';
import { crearServidor } from './servidor.ts';

const abiertas: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(abiertas.splice(0).map((app) => app.close())); });

function preparar(adminToken?: string, alCambiar?: () => void | Promise<void>) {
  const boleteria = new Boleteria({
    emisiones: [{ referencia: 'TA-1', localidad: 'NORTE' }, { referencia: 'TA-2', localidad: 'SUR' }],
    anuladasIniciales: ['TA-2'],
  });
  const app = crearServidor({ boleteria, adminToken, alCambiar });
  abiertas.push(app);
  return { app, boleteria };
}

describe('servidor de boletería', () => {
  it('sirve índice, versiones P1 y salud con esquemas válidos', async () => {
    const { app } = preparar();
    const indice = await app.inject('/versiones');
    expect(indice.statusCode).toBe(200);
    expect(IndiceVersiones.parse(indice.json()).ultimaVersion).toBe(1);
    const version = await app.inject('/versiones/1');
    expect(version.statusCode).toBe(200);
    expect(VersionBoleteria.parse(version.json()).cambios[0]?.operacion).toBe('anulacion');
    expect((await app.inject('/salud')).json()).toEqual({ estado: 'ok', ultimaVersion: 1 });
  });

  it('rechaza números inválidos y versiones ausentes', async () => {
    const { app } = preparar();
    for (const n of ['-1', '1.2', 'texto', '9007199254740992']) {
      const respuesta = await app.inject(`/versiones/${n}`);
      expect(respuesta.statusCode).toBe(400);
      expect(ErrorRespuesta.parse(respuesta.json()).error).toBe('SOLICITUD_INVALIDA');
    }
    const ausente = await app.inject('/versiones/2');
    expect(ausente.statusCode).toBe(404);
    expect(ErrorRespuesta.parse(ausente.json()).error).toBe('NO_ENCONTRADO');
  });

  it('protege los comandos y publica mutaciones, notificando el guardado', async () => {
    let cambios = 0;
    const { app, boleteria } = preparar('secreto-de-prueba', () => { cambios++; });
    const publicar = (url: string, payload: object, token = 'secreto-de-prueba') => app.inject({
      method: 'POST', url, headers: { 'x-admin-token': token }, payload,
    });
    const sinToken = await app.inject({ method: 'POST', url: '/admin/anulaciones', payload: { referencia: 'TA-1' } });
    expect(sinToken.statusCode).toBe(401);
    expect(ErrorRespuesta.parse(sinToken.json()).error).toBe('NO_AUTENTICADO');
    expect((await publicar('/admin/anulaciones', { referencia: 'TA-1' }, 'incorrecto')).statusCode).toBe(401);
    expect((await publicar('/admin/anulaciones', {})).statusCode).toBe(400);
    expect((await publicar('/admin/emisiones', { referencia: 'TA-3', localidad: 'INVALIDA' })).statusCode).toBe(400);
    expect((await publicar('/admin/anulaciones', { referencia: 'TA-X' })).statusCode).toBe(404);
    expect((await publicar('/admin/cambios-localidad', { referencia: 'TA-X', localidad: 'SUR' })).statusCode).toBe(404);
    expect((await publicar('/admin/anulaciones', { referencia: 'TA-2' })).statusCode).toBe(409);
    expect((await publicar('/admin/emisiones', { referencia: 'TA-2', localidad: 'NORTE' })).statusCode).toBe(409);
    expect((await publicar('/admin/cambios-localidad', { referencia: 'TA-2', localidad: 'SUR' })).statusCode).toBe(409);
    expect((await publicar('/admin/emisiones', { referencia: 'TA-3', localidad: 'PALCOS' })).json()).toEqual({
      version: 2, referencia: 'TA-3',
    });
    expect((await publicar('/admin/cambios-localidad', { referencia: 'TA-3', localidad: 'SUR' })).statusCode).toBe(201);
    expect((await publicar('/admin/anulaciones', { referencia: 'TA-3' })).statusCode).toBe(201);
    expect((await publicar('/admin/anulaciones', { referencia: 'TA-3' })).statusCode).toBe(409);
    expect(cambios).toBe(3);
    expect(boleteria.indice().ultimaVersion).toBe(4);
  });

  it('permite comandos sin token configurado', async () => {
    const { app } = preparar();
    expect((await app.inject({ method: 'POST', url: '/admin/anulaciones', payload: { referencia: 'TA-1' } })).statusCode).toBe(201);
  });
});
