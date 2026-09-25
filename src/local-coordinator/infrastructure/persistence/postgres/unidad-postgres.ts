import type { PoolClient } from 'pg';
import type {
  DatosIngreso,
  ConsumoIngreso,
  EntradaBitacora,
  IntentoDeValidacion,
  IntentoRegistrado,
  RegistroOutbox,
  ResultadoValidacion,
  UnidadValidacion,
} from '@nexo/shared/domain';
import { ErrorConsumoDuplicado, ErrorIntentoDuplicado } from '@nexo/shared/domain';

/** Código SQLSTATE de violación de unicidad. */
const UNIQUE_VIOLATION = '23505';

interface ErrorPg {
  code?: string;
  constraint?: string;
}

export function esErrorPg(e: unknown): e is ErrorPg {
  return typeof e === 'object' && e !== null && 'code' in e;
}

type ResultadoSerializado = Omit<ResultadoValidacion, 'instanteDecision'> & { instanteDecision: string };

export function serializarResultado(r: ResultadoValidacion): ResultadoSerializado {
  return { ...r, instanteDecision: r.instanteDecision.toISOString(), repetida: false };
}

export function deserializarResultado(s: ResultadoSerializado): ResultadoValidacion {
  return { ...s, instanteDecision: new Date(s.instanteDecision), repetida: false };
}

/**
 * Unidad T1 sobre D1: una transacción en un solo cliente del pool.
 * La boleta se bloquea con `SELECT … FOR UPDATE`; el UNIQUE de `consumo` es la garantía definitiva.
 */
export class UnidadValidacionPostgres implements UnidadValidacion {
  private readonly cliente: PoolClient;
  private terminada = false;
  private bitacoraId: { idOrigen: string; id: string } | null = null;

  constructor(cliente: PoolClient) {
    this.cliente = cliente;
  }

  static async abrir(cliente: PoolClient, opciones: { lockTimeoutMs: number; statementTimeoutMs: number }): Promise<UnidadValidacionPostgres> {
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SET LOCAL lock_timeout = ${Math.trunc(opciones.lockTimeoutMs)}`);
      await cliente.query(`SET LOCAL statement_timeout = ${Math.trunc(opciones.statementTimeoutMs)}`);
    } catch (e) {
      cliente.release(e instanceof Error ? e : true);
      throw e;
    }
    return new UnidadValidacionPostgres(cliente);
  }

  async buscarIntento(_eventoId: string, idOrigen: string): Promise<IntentoRegistrado | null> {
    // `id_origen` es PK global: un mismo id en otro evento tiene otra huella y es conflicto.
    const r = await this.cliente.query<{ huella: string; respuesta: ResultadoSerializado | null }>(
      'SELECT huella, respuesta FROM intento WHERE id_origen = $1',
      [idOrigen],
    );
    const fila = r.rows[0];
    if (!fila || !fila.respuesta) return null;
    return { huella: fila.huella, resultado: deserializarResultado(fila.respuesta) };
  }

  async cargarParaActualizar(intento: IntentoDeValidacion): Promise<DatosIngreso> {
    const ev = await this.cliente.query<{
      evento_id: string;
      cliente_id: string;
      boleteria_id: string;
      estado: 'preparacion' | 'abierto' | 'cerrado';
      apertura_en: Date;
      cierre_en: Date;
      version_permisos: string;
      version_politicas: string;
      reingreso_permitido: boolean;
      permisos_recibidos_en: Date | null;
    }>('SELECT * FROM evento WHERE evento_id = $1', [intento.eventoId]);
    const e = ev.rows[0];
    const versiones = {
      versionPermisos: e ? Number(e.version_permisos) : 0,
      versionPoliticas: e ? Number(e.version_politicas) : 0,
      permisosRecibidosEn: e?.permisos_recibidos_en ?? null,
    };
    if (!e) return { evento: null, punto: null, boleta: null, versiones };

    const pt = await this.cliente.query<{ punto_id: string; zonas: string[]; habilitado: boolean }>(
      'SELECT punto_id, zonas, habilitado FROM punto WHERE evento_id = $1 AND punto_id = $2',
      [intento.eventoId, intento.puntoId],
    );
    const bo = await this.cliente.query<{
      cliente_id: string;
      boleteria_id: string;
      referencia: string;
      zona: string;
      anulada_en: Date | null;
      anulacion_recibida_en: Date | null;
    }>(
      `SELECT cliente_id, boleteria_id, referencia, zona, anulada_en, anulacion_recibida_en
         FROM boleta WHERE evento_id = $1 AND codigo = $2 FOR UPDATE`,
      [intento.eventoId, intento.codigo],
    );
    const b = bo.rows[0];
    let consumo: { idOrigen: string; puntoId: string; consumidoEn: Date } | null = null;
    if (b) {
      const co = await this.cliente.query<{ id_origen: string; punto_id: string | null; consumido_en: Date }>(
        `SELECT id_origen, punto_id, consumido_en FROM consumo
          WHERE cliente_id = $1 AND evento_id = $2 AND boleteria_id = $3 AND referencia = $4 AND proposito = 'PRIMER_INGRESO'`,
        [b.cliente_id, intento.eventoId, b.boleteria_id, b.referencia],
      );
      const c = co.rows[0];
      if (c) consumo = { idOrigen: c.id_origen, puntoId: c.punto_id ?? '', consumidoEn: c.consumido_en };
    }
    const p = pt.rows[0];
    return {
      evento: {
        eventoId: e.evento_id,
        clienteId: e.cliente_id,
        boleteriaId: e.boleteria_id,
        estado: e.estado,
        ventana: { aperturaEn: e.apertura_en, cierreEn: e.cierre_en },
        politicas: { version: Number(e.version_politicas), reingresoPermitido: e.reingreso_permitido, contingenciaLocal: false },
      },
      punto: p ? { eventoId: e.evento_id, puntoId: p.punto_id, zonas: p.zonas, habilitado: p.habilitado } : null,
      boleta: b
        ? {
            eventoId: intento.eventoId,
            referencia: b.referencia,
            zona: b.zona,
            anulacion: b.anulada_en ? { anuladaEn: b.anulada_en, recibidaEn: b.anulacion_recibida_en } : null,
            consumo,
          }
        : null,
      versiones,
    };
  }

  async registrarIntento(intento: IntentoDeValidacion, huella: string, resultado: ResultadoValidacion): Promise<void> {
    try {
      await this.cliente.query(
        `INSERT INTO intento (id_origen, huella, evento_id, lector_id, punto_id, codigo, proposito, zona_solicitada,
                              instante_lector, decision, motivo, respuesta, decidido_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          intento.idOrigen,
          huella,
          intento.eventoId,
          intento.lectorId,
          intento.puntoId,
          intento.codigo,
          intento.proposito,
          intento.zonaSolicitada ?? '',
          intento.instanteLector,
          resultado.decision,
          resultado.motivo,
          JSON.stringify(serializarResultado(resultado)),
          resultado.instanteDecision,
        ],
      );
    } catch (e) {
      if (esErrorPg(e) && e.code === UNIQUE_VIOLATION) throw new ErrorIntentoDuplicado();
      throw e;
    }
  }

  async registrarConsumo(consumo: ConsumoIngreso): Promise<void> {
    const k = consumo.clave;
    try {
      await this.cliente.query(
        `INSERT INTO consumo (cliente_id, evento_id, boleteria_id, referencia, proposito, id_origen, consumido_en, punto_id, lector_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [k.clienteId, k.eventoId, k.boleteriaId, k.referencia, k.proposito, consumo.idOrigen, consumo.consumidoEn, consumo.puntoId, consumo.lectorId],
      );
    } catch (e) {
      if (esErrorPg(e) && e.code === UNIQUE_VIOLATION) throw new ErrorConsumoDuplicado();
      throw e;
    }
  }

  async agregarBitacora(entrada: EntradaBitacora): Promise<void> {
    const r = await this.cliente.query<{ id: string }>(
      `INSERT INTO bitacora (evento_id, tipo, id_origen, contenido, registrado_en) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [entrada.eventoId, entrada.tipo, entrada.idOrigen, JSON.stringify(entrada.contenido), entrada.registradoEn],
    );
    this.bitacoraId = { idOrigen: entrada.idOrigen, id: r.rows[0]!.id };
  }

  async agregarOutbox(registro: RegistroOutbox): Promise<void> {
    const bitacoraId = this.bitacoraId?.idOrigen === registro.registro.idOrigen ? this.bitacoraId.id : null;
    await this.cliente.query(
      `INSERT INTO outbox (bitacora_id, evento_id, tipo, id_origen, registro) VALUES ($1,$2,$3,$4,$5)`,
      [bitacoraId, registro.eventoId, registro.registro.tipo, registro.registro.idOrigen, JSON.stringify(registro.registro)],
    );
  }

  async confirmar(): Promise<void> {
    if (this.terminada) throw new Error('La unidad ya terminó');
    try {
      const r = await this.cliente.query('COMMIT');
      // En una transacción abortada PostgreSQL responde ROLLBACK a COMMIT sin error.
      if (r.command !== 'COMMIT') throw new Error('D1 no confirmó la transacción');
      this.terminada = true;
      this.cliente.release();
    } catch (e) {
      this.terminada = true;
      this.cliente.release(e instanceof Error ? e : true);
      throw e;
    }
  }

  async cancelar(): Promise<void> {
    if (this.terminada) return;
    this.terminada = true;
    try {
      await this.cliente.query('ROLLBACK');
      this.cliente.release();
    } catch (e) {
      this.cliente.release(e instanceof Error ? e : true);
    }
  }
}
