import Fastify from 'fastify';
import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { LoteEvidencia, type AcuseLoteEvidencia, type RegistroEvidencia } from '../../../../src/shared/contracts/e1.ts';
import type { Incidente } from '../../../../src/shared/contracts/o2.ts';
import {
  ConflictoEvidencia, ServicioIngestaEvidencia, ServicioVigilanciaLatidos,
  type IncidenteRepositorio, type LoteEvidenciaRepositorio, type ProcesarAceptados,
  type ProyeccionPuntosRepositorio, type Resultado,
} from '../../../../src/central-core/modules/evidence-ingestion/application/index.ts';
import { incidenteSinComunicacion, sinComunicacion, type NuevoIncidente } from '../../../../src/central-core/modules/evidence-ingestion/domain/index.ts';
import { registrarRutasEvidencia, registrarRutasIncidentes } from '../../../../src/central-core/modules/evidence-ingestion/api/index.ts';
import { RepositorioLotesPg } from '../../../../src/central-core/modules/evidence-ingestion/infrastructure/index.ts';

class IncidentesMemoria implements IncidenteRepositorio {
  readonly activos = new Map<string, Incidente>();

  async crearSiNoExisteActivo(eventoId: string, incidente: NuevoIncidente): Promise<Incidente> {
    const clave = `${eventoId}/${incidente.puntoId}`;
    const anterior = this.activos.get(clave);
    if (anterior) return anterior;
    const creado = { ...incidente, id: `INC-${String(this.activos.size + 1).padStart(4, '0')}` };
    this.activos.set(clave, creado);
    return creado;
  }
  async resolverActivoPorPunto(eventoId: string, puntoId: string, instante: Date): Promise<void> {
    const clave = `${eventoId}/${puntoId}`;
    const incidente = this.activos.get(clave);
    if (incidente) {
      incidente.estado = 'resuelto';
      incidente.bitacora.push({ t: instante.getHours() * 3600, autor: 'sistema', tipo: 'estado', texto: 'Vuelve la comunicación' });
      this.activos.delete(clave);
    }
  }
  async listar(): Promise<Incidente[]> { return [...this.activos.values()]; }
  async obtener(id: string): Promise<Incidente | null> {
    return [...this.activos.values()].find((incidente) => incidente.id === id) ?? null;
  }
}

class PuntosMemoria implements ProyeccionPuntosRepositorio {
  latidos = 0;
  vencidos: Array<{ eventoId: string; puntoId: string; ultimaComunicacionInstante: Date }> = [];
  async actualizarLatidoPunto(): Promise<void> { this.latidos++; }
  async listarPuntosConLatidoVencido(): Promise<typeof this.vencidos> { return this.vencidos; }
  async marcarSinComunicacion(): Promise<void> {}
}

class LotesMemoria implements LoteEvidenciaRepositorio {
  readonly lotes = new Map<string, AcuseLoteEvidencia>();
  readonly hashes = new Map<string, string>();
  readonly registros = new Map<string, string>();
  readonly puntos: PuntosMemoria;
  readonly incidentes: IncidentesMemoria;
  constructor(puntos: PuntosMemoria, incidentes: IncidentesMemoria) {
    this.puntos = puntos;
    this.incidentes = incidentes;
  }
  async yaProcesado(idLote: string, lote: LoteEvidencia): Promise<AcuseLoteEvidencia | null> {
    const anterior = this.lotes.get(idLote);
    if (anterior && this.hashes.get(idLote) !== JSON.stringify(lote)) throw new ConflictoEvidencia('Lote diferente');
    return anterior ?? null;
  }
  async guardarLoteYRegistros(lote: LoteEvidencia, resultados: Resultado[], procesarAceptados?: ProcesarAceptados): Promise<void> {
    if (this.lotes.has(lote.idLote)) return;
    const aceptados = lote.registros.filter((registro, indice) => {
      const clave = `${lote.eventoId}/${registro.tipo}/${registro.idOrigen}`;
      const anterior = this.registros.get(clave);
      if (anterior && anterior !== JSON.stringify(registro)) throw new ConflictoEvidencia('Registro diferente');
      if (anterior) {
        resultados[indice]!.estado = 'duplicado';
        return false;
      }
      this.registros.set(clave, JSON.stringify(registro));
      return true;
    });
    await procesarAceptados?.(aceptados, this.puntos, this.incidentes);
    this.lotes.set(lote.idLote, {
      idLote: lote.idLote, recibidoEn: new Date().toISOString(), repetido: false,
      aceptados: aceptados.length, duplicados: resultados.length - aceptados.length, resultados,
    });
    this.hashes.set(lote.idLote, JSON.stringify(lote));
  }
}

const base = LoteEvidencia.parse({
  idLote: 'COORD-A:lote:001', recintoId: 'REC-01', eventoId: 'EVT-2026-02',
  coordinadorId: 'COORD-A', emitidoEn: '2026-09-25T12:00:00Z',
  registros: [{
    tipo: 'latido-punto', idOrigen: 'COORD-A:latido:001', lectorId: 'LX-01',
    puntoId: 'P-01', estadoLector: 'operativo', instanteLector: '2026-09-25T12:00:00Z',
    pendientesDiario: 0, diarioTotal: 1,
  }],
});

describe('M2 evidencia y vigilancia', () => {
  it('repite el acuse original sin proyectar el latido otra vez', async () => {
    const puntos = new PuntosMemoria();
    const servicio = new ServicioIngestaEvidencia(new LotesMemoria(puntos, new IncidentesMemoria()));
    const primero = await servicio.procesarLote(base);
    expect(await servicio.procesarLote(base)).toEqual({ ...primero, repetido: true });
    expect(puntos.latidos).toBe(1);
  });

  it('deduplica un registro recibido en otro lote', async () => {
    const puntos = new PuntosMemoria();
    const servicio = new ServicioIngestaEvidencia(new LotesMemoria(puntos, new IncidentesMemoria()));
    await servicio.procesarLote(base);
    const segundo = await servicio.procesarLote({ ...base, idLote: 'COORD-A:lote:002' });
    expect(segundo).toMatchObject({ aceptados: 0, duplicados: 1, resultados: [{ estado: 'duplicado' }] });
    expect(puntos.latidos).toBe(1);
  });

  it('rechaza un mismo idLote con contenido distinto y expone conflicto HTTP', async () => {
    const servidor = Fastify();
    registrarRutasEvidencia(
      servidor, new ServicioIngestaEvidencia(new LotesMemoria(new PuntosMemoria(), new IncidentesMemoria())),
    );
    try {
      expect((await servidor.inject({ method: 'POST', url: '/v1/lotes-evidencia', payload: base })).statusCode).toBe(200);
      const respuesta = await servidor.inject({
        method: 'POST', url: '/v1/lotes-evidencia',
        payload: { ...base, registros: [{ ...base.registros[0], pendientesDiario: 1 }] },
      });
      expect(respuesta.statusCode).toBe(409);
      expect(respuesta.json()).toMatchObject({ error: 'CONFLICTO_IDEMPOTENCIA' });
    } finally {
      await servidor.close();
    }
  });

  it('rechaza el mismo evento/tipo/idOrigen con contenido distinto entre lotes', async () => {
    const servicio = new ServicioIngestaEvidencia(new LotesMemoria(new PuntosMemoria(), new IncidentesMemoria()));
    await servicio.procesarLote(base);
    await expect(servicio.procesarLote({
      ...base, idLote: 'COORD-A:lote:003',
      registros: [{ ...base.registros[0]!, diarioTotal: 2 } as RegistroEvidencia],
    })).rejects.toBeInstanceOf(ConflictoEvidencia);
  });

  it('resuelve al volver el latido sin perder la entrada inicial de bitácora', async () => {
    const incidentes = new IncidentesMemoria();
    const activo = await incidentes.crearSiNoExisteActivo(base.eventoId, incidenteSinComunicacion('P-01', new Date()));
    const servicio = new ServicioIngestaEvidencia(new LotesMemoria(new PuntosMemoria(), incidentes));
    await servicio.procesarLote(base);
    expect(activo.estado).toBe('resuelto');
    expect(activo.bitacora.map((entrada) => entrada.texto)).toEqual([
      'Detectado por vigilancia de latidos (>60s)', 'Vuelve la comunicación',
    ]);
  });

  it('vence solo después de más de 60 segundos', () => {
    const ultimo = new Date('2026-09-25T12:00:00Z');
    expect(sinComunicacion(ultimo, new Date('2026-09-25T12:01:00Z'))).toBe(false);
    expect(sinComunicacion(ultimo, new Date('2026-09-25T12:01:00.001Z'))).toBe(true);
  });

  it('mantiene un solo incidente activo en revisiones repetidas', async () => {
    const puntos = new PuntosMemoria();
    puntos.vencidos = [{ eventoId: base.eventoId, puntoId: 'P-01', ultimaComunicacionInstante: new Date('2026-09-25T12:00:00Z') }];
    const incidentes = new IncidentesMemoria();
    const vigilancia = new ServicioVigilanciaLatidos(puntos, incidentes, () => new Date('2026-09-25T12:01:01Z'));
    const primero = await vigilancia.revisarPuntosSinComunicacion();
    const segundo = await vigilancia.revisarPuntosSinComunicacion();
    expect(segundo).toEqual(primero);
    expect(incidentes.activos.size).toBe(1);
    expect(primero[0]?.checklist).toHaveLength(3);
  });

  it('expone E1 y O2 con validación y 404', async () => {
    const servidor = Fastify();
    const incidentes = new IncidentesMemoria();
    registrarRutasEvidencia(servidor, new ServicioIngestaEvidencia(new LotesMemoria(new PuntosMemoria(), incidentes)));
    registrarRutasIncidentes(servidor, incidentes);
    try {
      expect((await servidor.inject({ method: 'POST', url: '/v1/lotes-evidencia', payload: {} })).statusCode).toBe(400);
      const acuse = await servidor.inject({ method: 'POST', url: '/v1/lotes-evidencia', payload: base });
      expect(acuse.statusCode).toBe(200);
      expect(acuse.json()).toMatchObject({ aceptados: 1, repetido: false });
      expect((await servidor.inject({ method: 'GET', url: '/api/incidentes' })).json()).toEqual([]);
      expect((await servidor.inject({ method: 'GET', url: '/api/incidentes/INC-0001' })).statusCode).toBe(404);
    } finally {
      await servidor.close();
    }
  });

  it('guarda el lote, su evidencia y el estado del punto en una transacción D2', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO m2_evidencia.evidencias')) return { rows: [{ id: '1' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const release = vi.fn();
    const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
    const resultados: Resultado[] = [{ tipo: 'latido-punto', idOrigen: base.registros[0]!.idOrigen, estado: 'aceptado' }];
    await new RepositorioLotesPg(pool).guardarLoteYRegistros(base, resultados, async (aceptados, puntos) => {
      expect(aceptados).toHaveLength(1);
      const latido = aceptados[0]!;
      if (latido.tipo === 'latido-punto') {
        await puntos.actualizarLatidoPunto(base.eventoId, latido.puntoId, latido.instanteLector,
          latido.pendientesDiario, latido.diarioTotal, latido.lectorId);
      }
    });
    const sentencias = query.mock.calls.map(([sql]) => sql);
    expect(sentencias).toEqual(expect.arrayContaining([
      expect.stringContaining('INSERT INTO m2_evidencia.lotes'),
      expect.stringContaining('INSERT INTO m2_evidencia.evidencias'),
      expect.stringContaining('INSERT INTO m2_evidencia.puntos_estado'),
      expect.stringContaining('UPDATE m2_evidencia.lotes SET acuse'),
    ]));
    expect(sentencias[0]).toBe('BEGIN');
    expect(sentencias.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('revierte la transacción D2 si un idOrigen repetido tiene contenido distinto', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO m2_evidencia.evidencias')) return { rows: [], rowCount: 0 };
      if (sql.includes('SELECT contenido_hash FROM m2_evidencia.evidencias')) {
        return { rows: [{ contenido_hash: 'otro-contenido' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
    await expect(new RepositorioLotesPg(pool).guardarLoteYRegistros(
      base, [{ tipo: 'latido-punto', idOrigen: base.registros[0]!.idOrigen, estado: 'aceptado' }],
    )).rejects.toBeInstanceOf(ConflictoEvidencia);
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
});
