import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cargarBoletas, cargarPerfil, ejecutarCarga, ejecutarPares, formatearResumen,
  type PerfilCarga, type PresentacionCarga,
} from '../../src/reader-client/load/index.ts';

const archivo = (nombre: string) => fileURLToPath(new URL(nombre, import.meta.url));
const seed = () => cargarBoletas(archivo('seed.example.json'));
const perfil = (mezcla: PerfilCarga['mezcla'], tps = 10, duracionSegundos = 0.2): PerfilCarga => ({
  nombre: 'prueba-corta',
  eventos: ['EVT-TEST'],
  lectores: 2,
  ciclos: 1,
  fases: [{ tps, duracionSegundos }],
  mezcla,
  zonas: ['Norte', 'Sur'],
  semilla: 123,
  timeoutMs: 50,
});
const solo = (caso: keyof PerfilCarga['mezcla']): PerfilCarga['mezcla'] => ({
  valid: 0, used: 0, cancelled: 0, 'wrong-zone': 0, unknown: 0, [caso]: 1,
});

describe('perfiles y exportación', () => {
  it('lee perfiles declarativos y la exportación desde archivos', async () => {
    const [nominal, pico, stress, exportacion] = await Promise.all([
      cargarPerfil(archivo('nominal.json')), cargarPerfil(archivo('pico.json')),
      cargarPerfil(archivo('stress.json')), seed(),
    ]);
    expect(nominal.fases).toEqual([
      { duracionSegundos: 840, tps: 4.714285714285714 },
      { duracionSegundos: 60, tps: 16.5 },
    ]);
    expect(nominal.ciclos).toBe(4);
    expect(pico.fases[0]?.tps).toBe(49.5);
    expect(stress.fases.map((f) => f.tps)).toEqual([49.5, 61.88, 74.25, 99]);
    expect(exportacion.eventos[0]?.boletas).toHaveLength(5);
  });

  it('mantiene el ritmo por reloj en una fase de 200 ms', async () => {
    const reporte = await ejecutarCarga({
      perfil: perfil(solo('unknown'), 40, 0.2),
      exportacion: await seed(),
      present: async () => ({ decision: 'rechazado' }),
    });
    expect(reporte.intentos).toBe(8);
    expect(reporte.duracionRealMs).toBeGreaterThanOrEqual(190);
    expect(reporte.tpsDespachado).toBeGreaterThan(25);
    expect(reporte.registros.map((r) => r.programadoMs)).toEqual([0, 25, 50, 75, 100, 125, 150, 175]);
    expect(reporte.registros[7]!.inicioMs).toBeGreaterThanOrEqual(165);
    expect(reporte.discrepancias).toBe(0);
    expect(reporte.eventos[0]?.aceptacionesEsperadas).toBe(0);
  });

  it('reporta falsos rechazos y contrasta cada intento con su expectativa', async () => {
    const vistos: PresentacionCarga[] = [];
    const reporte = await ejecutarCarga({
      perfil: perfil(solo('valid')),
      exportacion: await seed(),
      present: async (intento) => {
        vistos.push(intento);
        return {
          decision: vistos.length === 1 ? 'rechazado' : 'aceptado',
          solicitud: { idOrigen: `LECTOR-${vistos.length}` },
        };
      },
    });
    expect(new Set(vistos.map((v) => v.codigo)).size).toBe(2);
    expect(vistos.every((v) => v.expected === 'aceptado')).toBe(true);
    expect(reporte.falsosRechazos).toBe(1);
    expect(reporte.discrepancias).toBe(1);
    expect(reporte.registros.map((r) => r.idOrigen)).toEqual(['LECTOR-1', 'LECTOR-2']);
    expect(reporte.eventos[0]).toMatchObject({ aceptacionesEsperadas: 2, aceptacionesObtenidas: 1 });
    expect(JSON.parse(JSON.stringify(reporte)).registros).toHaveLength(2);
    expect(formatearResumen(reporte)).toContain('falsos rechazos=1');
  });

  it.each(['used', 'cancelled', 'wrong-zone', 'unknown'] as const)(
    'obtiene %s de la semilla y espera rechazo', async (caso) => {
      const exportacion = await seed();
      const reporte = await ejecutarCarga({
        perfil: perfil(solo(caso)),
        exportacion,
        present: async () => ({ decision: 'rechazado' }),
      });
      expect(reporte.registros.every((r) => r.caso === caso && r.expected === 'rechazado')).toBe(true);
      if (caso === 'unknown') {
        expect(exportacion.eventos[0]?.boletas.some((b) => b.codigo === reporte.registros[0]?.codigo)).toBe(false);
      } else {
        expect(exportacion.eventos[0]?.boletas.some((b) => b.codigo === reporte.registros[0]?.codigo)).toBe(true);
      }
      if (caso === 'wrong-zone') {
        expect(reporte.registros[0]?.zonaSolicitada).not.toBe('Norte');
      }
    },
  );

  it('contabiliza timeout y error como sin respuesta sin autorización implícita', async () => {
    let contador = 0;
    const reporte = await ejecutarCarga({
      perfil: perfil(solo('unknown')),
      exportacion: await seed(),
      present: async () => {
        if (++contador === 1) return new Promise<never>(() => {});
        throw new Error('sin enlace');
      },
    });
    expect(reporte.timeouts).toBe(2);
    expect(reporte.discrepancias).toBe(2);
    expect(reporte.registros.map((r) => r.obtained)).toEqual(['sin-respuesta', 'sin-respuesta']);
    expect(reporte.registros.every((r) => r.idOrigen === undefined)).toBe(true);
    expect(reporte.registros[1]?.error).toBe('sin enlace');
  });

  it('lanza pares simultáneos con distintos idOrigen y exige una sola aceptación', async () => {
    const vistos: PresentacionCarga[] = [];
    const reporte = await ejecutarPares({
      perfil: perfil(solo('valid')),
      exportacion: await seed(),
      pares: 2,
      present: async (intento) => {
        vistos.push(intento);
        return {
          decision: intento.lectorIndex === 0 ? 'aceptado' : 'rechazado',
          idOrigen: `LECTOR-${vistos.length}`,
        };
      },
    });
    expect(vistos).toHaveLength(4);
    expect(new Set(vistos.map((v) => v.idCarga)).size).toBe(4);
    expect(new Set(reporte.registros.map((r) => r.idOrigen)).size).toBe(4);
    expect(vistos[0]?.codigo).toBe(vistos[1]?.codigo);
    expect(vistos[0]?.codigo).not.toBe(vistos[2]?.codigo);
    expect(reporte.eventos[0]).toMatchObject({ aceptacionesEsperadas: 2, aceptacionesObtenidas: 2 });
    expect(reporte.discrepancias).toBe(0);
    expect(reporte.paresIncorrectos).toBe(0);
    expect(reporte.registros[2]?.programadoMs).toBe(200);
    expect(reporte.registros[0]!.inicioMs - reporte.registros[1]!.inicioMs).toBeLessThan(10);
  });

  it('señala un par con dos aceptaciones como fallo', async () => {
    const reporte = await ejecutarPares({
      perfil: perfil(solo('valid')),
      exportacion: await seed(),
      pares: 1,
      present: async () => ({ decision: 'aceptado' }),
    });
    expect(reporte.discrepancias).toBe(2);
    expect(reporte.paresIncorrectos).toBe(1);
    expect(reporte.eventos[0]).toMatchObject({ aceptacionesEsperadas: 1, aceptacionesObtenidas: 2 });
  });

  it('cuenta una falsa denegación cuando las dos solicitudes del par se rechazan', async () => {
    const reporte = await ejecutarPares({
      perfil: perfil(solo('valid')), exportacion: await seed(), pares: 1,
      present: async () => ({ decision: 'rechazado' }),
    });
    expect(reporte.falsosRechazos).toBe(1);
    expect(reporte.eventos[0]?.falsosRechazos).toBe(1);
    expect(reporte.paresIncorrectos).toBe(1);
  });

  it('no reutiliza correlaciones al repetir el perfil y nunca inventa idOrigen', async () => {
    const opciones = {
      perfil: perfil(solo('unknown')),
      exportacion: await seed(),
      present: async () => ({ decision: 'rechazado' as const }),
    };
    const [primero, segundo] = await Promise.all([ejecutarCarga(opciones), ejecutarCarga(opciones)]);
    expect(primero.registros[0]?.idCarga).not.toBe(segundo.registros[0]?.idCarga);
    expect(primero.registros.every((r) => r.idOrigen === undefined)).toBe(true);
  });

  it('contabiliza sin-respuesta del lector como timeout aunque resuelva antes del plazo', async () => {
    const reporte = await ejecutarCarga({
      perfil: perfil(solo('unknown')), exportacion: await seed(),
      present: async () => ({ decision: 'sin-respuesta', idOrigen: 'ID-REAL' }),
    });
    expect(reporte.timeouts).toBe(2);
    expect(reporte.registros.every((r) => r.timeout && r.idOrigen === 'ID-REAL')).toBe(true);
  });

  it('aborta una fase larga, espera la petición en vuelo y devuelve datos parciales', async () => {
    const controlador = new AbortController();
    let termino = false;
    const inicio = performance.now();
    const reporte = await ejecutarCarga({
      perfil: perfil(solo('unknown'), 10, 5), exportacion: await seed(),
      signal: controlador.signal,
      present: async () => {
        controlador.abort();
        await new Promise((resolve) => setTimeout(resolve, 20));
        termino = true;
        return { decision: 'rechazado' };
      },
    });
    expect(termino).toBe(true);
    expect(reporte.intentos).toBe(1);
    expect(reporte.duracionProgramadaMs).toBeLessThan(500);
    expect(performance.now() - inicio).toBeLessThan(1000);
  });

  it('aborta el modo pares sin iniciar más pares y espera los que están en vuelo', async () => {
    const controlador = new AbortController();
    const reporte = await ejecutarPares({
      perfil: perfil(solo('valid'), 10, 5), exportacion: await seed(), pares: 3,
      signal: controlador.signal,
      present: async (intento) => {
        controlador.abort();
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { decision: intento.lectorIndex === 0 ? 'aceptado' : 'rechazado' };
      },
    });
    expect(reporte.paresEvaluados).toBe(1);
    expect(reporte.intentos).toBe(2);
    expect(reporte.duracionProgramadaMs).toBeLessThan(500);
  });
});
