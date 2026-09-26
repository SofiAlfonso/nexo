import { describe, expect, it } from 'vitest';
import { RegistroDecision } from '../../../src/shared/contracts/index.ts';
import {
  ErrorConflictoIdempotencia, ErrorConsumoDuplicado, ErrorEntradaInvalida,
  ErrorSinConfianza, ValidarPrimerIngreso, huellaIntento,
} from '../../../src/shared/domain/index.ts';
import type { AlcanceAutenticado, ResolutorAlcance, SolicitudIngreso } from '../../../src/shared/domain/index.ts';
import { ReemplazarLector } from '../../../src/local-coordinator/application/reemplazo-lector.ts';
import type {
  CredencialRevocada, MotivoRevocacion, ReemplazoRegistrado, RepositorioAsignaciones,
  RevocadorCredenciales, SolicitudReemplazoLector, SolicitudRevocacionPendiente,
} from '../../../src/local-coordinator/application/puertos.ts';
import { AlcanceFijo, AutoridadFija, BASE, contexto, EVENTO, REFERENCIA, RelojFijo, TelemetriaEspia, UnidadesEnMemoria } from './dobles.ts';

function sistema() {
  const db = new UnidadesEnMemoria();
  const alcance = new AlcanceFijo();
  const autoridad = new AutoridadFija();
  const reloj = new RelojFijo();
  const telemetria = new TelemetriaEspia();
  const servicio = new ValidarPrimerIngreso({ unidades: db, alcance, autoridad, reloj, telemetria });
  const solicitud: SolicitudIngreso = {
    idOrigen: 'INT-00001', eventoId: EVENTO, lectorId: 'LEC-001', puntoId: 'P-01',
    codigo: 'COD-001', proposito: 'ingreso', zonaSolicitada: 'Norte', instanteLector: new Date(BASE),
  };
  return { db, alcance, autoridad, reloj, telemetria, servicio, solicitud };
}

describe('ValidarPrimerIngreso: unidad de trabajo, confianza e idempotencia', () => {
  it('PU-05-02 C2/mTLS reemplaza el lector, cierra la asignación anterior y solicita revocar su credencial', async () => {
    const { db, autoridad, reloj, solicitud } = sistema();
    const puntos = new AsignacionesMemoria();
    const revocador = new RevocadorEspia();
    const servicio = new ValidarPrimerIngreso({ unidades: db, alcance: puntos, autoridad, reloj });
    const caso = new ReemplazarLector({ asignaciones: puntos, revocador, reloj });
    const reemplazo: SolicitudReemplazoLector = {
      eventoId: EVENTO, puntoId: 'P-01', lectorAnterior: 'LEC-001', lectorNuevo: 'LEC-002', motivo: 'retired',
    };

    revocador.falla = new Error('CA no disponible');
    expect(await caso.ejecutar(reemplazo)).toMatchObject({
      repetido: false, revocacion: { estado: 'pendiente', error: 'CA no disponible' },
    });
    expect(puntos.lectores.get('LEC-001')).toEqual({ puntoId: 'P-01', habilitado: false, revocado: true });
    expect(puntos.lectores.get('LEC-002')).toEqual({ puntoId: 'P-01', habilitado: true, revocado: false });
    await expect(servicio.ejecutar(solicitud)).rejects.toBeInstanceOf(ErrorSinConfianza);
    expect(db.llamadas.abrir).toBe(0);

    revocador.falla = null;
    expect(await caso.revocarPendientes(EVENTO)).toEqual([{
      lectorId: 'LEC-001', estado: 'revocada', credencial: expect.objectContaining({ lectorId: 'LEC-001' }),
    }]);
    expect(revocador.llamadas).toEqual([['LEC-001', 'retired'], ['LEC-001', 'retired']]);
    expect(puntos.revocaciones.get(1)).toMatchObject({ lectorId: 'LEC-001', serialNumber: '0A1B' });
    expect(await caso.ejecutar(reemplazo)).toMatchObject({ repetido: true, revocacion: { estado: 'revocada' } });
    expect(await caso.revocarPendientes(EVENTO)).toEqual([]);
    await expect(caso.ejecutar({ ...reemplazo, lectorNuevo: 'LEC-003' })).rejects.toThrow(/ya fue reemplazado/);
    await expect(caso.ejecutar({ ...reemplazo, lectorAnterior: 'LEC-002', lectorNuevo: 'LEC-001' })).rejects.toThrow(/nunca se reutiliza/);

    expect(await servicio.ejecutar({ ...solicitud, lectorId: 'LEC-002' }))
      .toMatchObject({ decision: 'aceptado', admision: true });
    expect(db.consumos.size).toBe(1);
  });

  it('PU-03-01 aceptación confirma intento, consumo único, bitácora y outbox E1 antes de responder', async () => {
    const { db, servicio, solicitud, telemetria } = sistema();
    const r = await servicio.ejecutar(solicitud);
    expect(r).toMatchObject({ decision: 'aceptado', motivo: 'PERMISO_VIGENTE', admision: true, repetida: false, versionPermisos: 4 });
    expect(db.intentos.size).toBe(1);
    expect(db.consumos.size).toBe(1);
    expect([...db.consumos.values()][0]?.clave).toEqual({
      clienteId: 'CLI-001', eventoId: EVENTO, boleteriaId: 'BOL-001',
      referencia: REFERENCIA, proposito: 'PRIMER_INGRESO',
    });
    expect(db.bitacora).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
    expect(db.llamadas.confirmar).toBe(1);
    const registro = db.outbox[0]!.registro;
    expect(RegistroDecision.parse(registro)).toEqual(registro);
    expect(db.bitacora[0]).toMatchObject({ eventoId: EVENTO, tipo: 'decision', idOrigen: solicitud.idOrigen, contenido: registro });
    expect(telemetria.decisiones).toHaveLength(1);
  });
  it.each([
    ['PU-03-02', 'zona no permitida', { zonaSolicitada: null }, 'ZONA_NO_AUTORIZADA'],
    ['PU-03-03', 'anulación recibida', {}, 'BOLETA_ANULADA'],
    ['PU-03-04', 'uso ya registrado', {}, 'USO_YA_REGISTRADO'],
  ] as const)('%s rechazo por %s confirma evidencia sin nuevo consumo', async (id, _nombre, cambios, motivo) => {
    const { db, servicio, solicitud } = sistema();
    if (id === 'PU-03-03') db.datos.boleta!.anulacion = { anuladaEn: new Date(BASE), recibidaEn: new Date(BASE) };
    if (id === 'PU-03-04') db.registrarConsumoExterno('INT-ANTERIOR', new Date(Date.parse(BASE) - 3000));
    const consumosAntes = db.consumos.size;
    const r = await servicio.ejecutar({ ...solicitud, ...cambios });
    expect(r).toMatchObject({ decision: 'rechazado', motivo, admision: false });
    expect(db.consumos.size).toBe(consumosAntes);
    expect(db.intentos.size).toBe(1);
    expect(db.bitacora).toHaveLength(1);
    expect(db.outbox).toHaveLength(1);
    expect(RegistroDecision.safeParse(db.outbox[0]!.registro).success).toBe(true);
    if (id === 'PU-03-02') expect(db.outbox[0]!.registro).toMatchObject({ zonaSolicitada: 'NO_IDENTIFICADA' });
    expect(db.llamadas.confirmar).toBe(1);
  });
  it('PU-03-05 retransmisión igual recupera resultado original sin duplicar escrituras', async () => {
    const { db, servicio, solicitud, reloj } = sistema();
    const original = await servicio.ejecutar(solicitud);
    reloj.avanzar(90_000);
    const repetida = await servicio.ejecutar(solicitud);
    expect(repetida).toEqual({ ...original, repetida: true });
    expect(db.llamadas.cargarParaActualizar).toBe(1);
    expect(db.llamadas.confirmar).toBe(1);
    expect(db.llamadas.cancelar).toBe(1);
    expect([db.intentos.size, db.consumos.size, db.bitacora.length, db.outbox.length]).toEqual([1, 1, 1, 1]);
  });
  it('PB-03 entradas vacías o fecha inválida fallan antes de resolver alcance o abrir unidad', async () => {
    const { db, alcance, servicio, solicitud } = sistema();
    for (const cambios of [
      { idOrigen: '' }, { idOrigen: '  ' }, { idOrigen: null }, { eventoId: '' }, { lectorId: ' ' },
      { puntoId: '' }, { codigo: '' }, { instanteLector: new Date(Number.NaN) },
    ]) {
      await expect(servicio.ejecutar({ ...solicitud, ...cambios } as SolicitudIngreso)).rejects.toBeInstanceOf(ErrorEntradaInvalida);
    }
    expect(alcance.llamadas).toBe(0);
    expect(db.llamadas.abrir).toBe(0);
  });
  it('PB-04 misma idOrigen con otro código, lector o punto produce conflicto de integridad', async () => {
    const { db, alcance, servicio, solicitud } = sistema();
    await servicio.ejecutar(solicitud);
    for (const cambios of [{ codigo: 'OTRO' }, { lectorId: 'LEC-002' }, { puntoId: 'P-02' }]) {
      alcance.valor = { ...alcance.valor, puntoId: cambios.puntoId ?? 'P-01' };
      await expect(servicio.ejecutar({ ...solicitud, ...cambios })).rejects.toBeInstanceOf(ErrorConflictoIdempotencia);
    }
    expect(db.llamadas.confirmar).toBe(1);
    expect(db.outbox).toHaveLength(1);
    expect(huellaIntento(contexto().intento)).toBe(huellaIntento({ ...contexto().intento }));
    expect(huellaIntento(contexto().intento)).not.toBe(huellaIntento({ ...contexto().intento, codigo: 'OTRO' }));
  });
  it.each(['revocada', 'otro evento', 'otro punto'] as const)('PB-14 credencial %s no abre unidad ni carga boleta', async (caso) => {
    const { db, alcance, servicio, solicitud } = sistema();
    alcance.valor = {
      ...alcance.valor,
      revocado: caso === 'revocada',
      eventoId: caso === 'otro evento' ? 'EVT-2026-11' : EVENTO,
      puntoId: caso === 'otro punto' ? 'P-02' : 'P-01',
    };
    await expect(servicio.ejecutar(solicitud)).rejects.toBeInstanceOf(ErrorSinConfianza);
    expect(db.llamadas.abrir).toBe(0);
    expect(db.llamadas.cargarParaActualizar).toBe(0);
  });
  it('PB-11 motor sin autoridad no persiste decisión ni consumo', async () => {
    const { db, servicio, solicitud, autoridad } = sistema();
    autoridad.valor = { ...autoridad.valor, estado: 'sin-autoridad' };
    const r = await servicio.ejecutar(solicitud);
    expect(r).toMatchObject({ decision: 'sin-respuesta', motivo: 'SIN_COORDINADOR', admision: false });
    expect([db.intentos.size, db.consumos.size, db.outbox.length]).toEqual([0, 0, 0]);
    expect(db.llamadas.cancelar).toBe(1);
  });
  it('PB-11 lector que solicita contingencia sin política no abre ni confirma', async () => {
    const { db, servicio, solicitud } = sistema();
    const r = await servicio.ejecutar({ ...solicitud, modo: 'local-contingencia' });
    expect(r).toMatchObject({ decision: 'sin-respuesta', motivo: 'SIN_COORDINADOR', admision: false });
    expect([db.intentos.size, db.consumos.size, db.bitacora.length, db.outbox.length]).toEqual([0, 0, 0, 0]);
    expect(db.llamadas.confirmar).toBe(0);
  });
  it.each([
    ['PB-12', 'cargarParaActualizar'],
    ['PB-13', 'agregarOutbox'],
    ['PU-03-07', 'confirmar'],
    ['PU-05-04', 'registrarIntento'],
  ] as const)('%s falla de %s deja cero cambios confirmados y no autoriza', async (_id, metodo) => {
    const { db, servicio, solicitud, telemetria } = sistema();
    db.fallas[metodo] = new Error('almacenamiento indisponible');
    const r = await servicio.ejecutar(solicitud);
    expect(r).toMatchObject({ decision: 'sin-respuesta', motivo: 'SIN_COORDINADOR', admision: false });
    expect([db.intentos.size, db.consumos.size, db.bitacora.length, db.outbox.length]).toEqual([0, 0, 0, 0]);
    expect(db.llamadas.cancelar).toBe(1);
    expect(telemetria.faltas).toHaveLength(1);
  });
  it('PB-21 excepción de telemetría no altera aceptación durable ni respuesta', async () => {
    const { db, servicio, solicitud, telemetria } = sistema();
    telemetria.falla = true;
    expect(await servicio.ejecutar(solicitud)).toMatchObject({ decision: 'aceptado', admision: true });
    expect([db.intentos.size, db.consumos.size, db.bitacora.length, db.outbox.length]).toEqual([1, 1, 1, 1]);
  });
  it('PB-21 excepción de telemetría en sin-confirmación tampoco cambia la decisión', async () => {
    const { db, servicio, solicitud, telemetria } = sistema();
    telemetria.falla = true;
    db.fallas.cargarParaActualizar = new Error('permisos');
    expect(await servicio.ejecutar(solicitud)).toMatchObject({ decision: 'sin-respuesta', admision: false });
  });
  it('PU-03 carrera de consumo duplicado reintenta y rechaza sin dos admisiones', async () => {
    const { db, servicio, solicitud } = sistema();
    db.fallas.registrarConsumo = () => {
      delete db.fallas.registrarConsumo;
      db.registrarConsumoExterno();
      throw new ErrorConsumoDuplicado();
    };
    const r = await servicio.ejecutar(solicitud);
    expect(r).toMatchObject({ decision: 'rechazado', motivo: 'USO_CONCURRENTE', admision: false });
    expect([db.intentos.size, db.consumos.size, db.outbox.length]).toEqual([1, 1, 1]);
    expect(db.llamadas.cancelar).toBe(1);
  });
  it('PU-03 carrera de dos puntos en paralelo produce exactamente una aceptación', async () => {
    const { db, servicio, solicitud, alcance } = sistema();
    const servicioOtro = new ValidarPrimerIngreso({
      unidades: db,
      alcance: { resolver: async () => ({ lectorId: 'LEC-002', eventoId: EVENTO, puntoId: 'P-02', revocado: false }) },
      autoridad: new AutoridadFija(), reloj: new RelojFijo(),
    });
    db.datos.punto = { eventoId: EVENTO, puntoId: 'P-01', zonas: ['Norte', 'Sur'], habilitado: true };
    const otro = { ...solicitud, idOrigen: 'INT-00002', puntoId: 'P-02', lectorId: 'LEC-002' };
    // La carrera configura explícitamente ambas puertas para Norte; el fixture normal P-02 es Sur.
    db.puntoPorIntento = (i) => ({ ...db.datos.punto!, puntoId: i.puntoId });
    const [a, b] = await Promise.all([servicio.ejecutar(solicitud), servicioOtro.ejecutar(otro)]);
    expect(alcance.llamadas).toBe(1);
    expect([a.decision, b.decision].sort()).toEqual(['aceptado', 'rechazado']);
    expect([a.admision, b.admision].filter(Boolean)).toHaveLength(1);
    expect([db.intentos.size, db.consumos.size, db.outbox.length]).toEqual([2, 1, 2]);
    expect([...db.consumos.values()][0]!.clave).toMatchObject({ referencia: REFERENCIA, proposito: 'PRIMER_INGRESO' });
  });
  it('PU-05-02 tras cambiar la asignación, el lector anterior no valida y el nuevo sí', async () => {
    const { db, alcance, servicio, solicitud } = sistema();
    alcance.valor = { ...alcance.valor, lectorId: 'LEC-002', revocado: true };
    await expect(servicio.ejecutar(solicitud)).rejects.toBeInstanceOf(ErrorSinConfianza);
    expect(db.llamadas.abrir).toBe(0);
    alcance.valor = { lectorId: 'LEC-002', eventoId: EVENTO, puntoId: 'P-01', revocado: false };
    expect(await servicio.ejecutar({ ...solicitud, lectorId: 'LEC-002' }))
      .toMatchObject({ decision: 'aceptado', admision: true });
    expect(db.consumos.size).toBe(1);
  });
});

describe('ValidarPrimerIngreso: plazo de respuesta', () => {
  it('PU-03-08 pasado venceEn no confirma: sin consumo ni evidencia, responde sin confirmación', async () => {
    const { db, servicio, solicitud, reloj } = sistema();
    db.fallas.agregarOutbox = () => reloj.avanzar(600);
    const r = await servicio.ejecutar({ ...solicitud, venceEn: new Date(Date.parse(BASE) + 500) });
    expect(r).toMatchObject({ decision: 'sin-respuesta', admision: false });
    expect(db.llamadas.confirmar).toBe(0);
    expect(db.consumos.size).toBe(0);
    expect(db.intentos.size).toBe(0);
    expect(db.outbox).toHaveLength(0);
  });

  it('dentro del plazo confirma normalmente', async () => {
    const { db, servicio, solicitud } = sistema();
    const r = await servicio.ejecutar({ ...solicitud, venceEn: new Date(Date.parse(BASE) + 500) });
    expect(r.decision).toBe('aceptado');
    expect(db.llamadas.confirmar).toBe(1);
  });
});

class AsignacionesMemoria implements RepositorioAsignaciones, ResolutorAlcance {
  readonly lectores = new Map<string, { puntoId: string; habilitado: boolean; revocado: boolean }>([
    ['LEC-001', { puntoId: 'P-01', habilitado: true, revocado: false }],
  ]);
  readonly reemplazos: Array<SolicitudReemplazoLector & { id: number; en: Date }> = [];
  readonly revocaciones = new Map<number, CredencialRevocada>();

  async resolver(lectorId: string): Promise<AlcanceAutenticado> {
    const l = this.lectores.get(lectorId);
    if (!l) return { lectorId, eventoId: null, puntoId: null, revocado: false };
    return { lectorId, eventoId: EVENTO, puntoId: l.puntoId, revocado: l.revocado || !l.habilitado };
  }
  async reemplazar(s: SolicitudReemplazoLector, instante: Date): Promise<ReemplazoRegistrado> {
    const previo = this.reemplazos.find((r) => r.lectorAnterior === s.lectorAnterior);
    if (previo) {
      if (previo.lectorNuevo !== s.lectorNuevo || previo.puntoId !== s.puntoId) {
        throw new Error(`${s.lectorAnterior} ya fue reemplazado`);
      }
      return { reemplazoId: previo.id, solicitudRevocacionId: previo.id, reemplazadoEn: previo.en, repetido: true };
    }
    const anterior = this.lectores.get(s.lectorAnterior);
    if (!anterior || anterior.puntoId !== s.puntoId || anterior.revocado) throw new Error('sin asignación vigente');
    if (this.lectores.get(s.lectorNuevo)?.revocado) throw new Error('nunca se reutiliza una identidad');
    this.lectores.set(s.lectorNuevo, { puntoId: s.puntoId, habilitado: true, revocado: false });
    this.lectores.set(s.lectorAnterior, { ...anterior, habilitado: false, revocado: true });
    const id = this.reemplazos.push({ ...s, id: this.reemplazos.length + 1, en: instante });
    return { reemplazoId: id, solicitudRevocacionId: id, reemplazadoEn: instante, repetido: false };
  }
  async revocacionesPendientes(): Promise<SolicitudRevocacionPendiente[]> {
    return this.reemplazos.filter((r) => !this.revocaciones.has(r.id)).map((r) => ({
      id: r.id, eventoId: r.eventoId, lectorId: r.lectorAnterior, motivo: r.motivo, solicitadaEn: r.en,
    }));
  }
  async registrarRevocacion(id: number, credencial: CredencialRevocada): Promise<void> {
    if (!this.revocaciones.has(id)) this.revocaciones.set(id, credencial);
  }
}

class RevocadorEspia implements RevocadorCredenciales {
  falla: Error | null = null;
  readonly llamadas: Array<[string, MotivoRevocacion]> = [];
  async revocar(lectorId: string, motivo: MotivoRevocacion): Promise<CredencialRevocada> {
    this.llamadas.push([lectorId, motivo]);
    if (this.falla) throw this.falla;
    return { lectorId, serialNumber: '0A1B', fingerprint256: 'a'.repeat(64), revokedAt: new Date(BASE).toISOString() };
  }
}
