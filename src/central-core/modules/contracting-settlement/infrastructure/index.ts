import type { Pool } from 'pg';
import type { DatosLiquidacion, LiquidacionRepositorio, ResumenLiquidacion } from '../application/index.ts';

interface FilaContrato {
  contrato_id: string;
  admisiones_estimadas: number;
}

interface FilaConteos {
  admisiones: string;
  excluidas: string;
}

interface FilaLiquidacion {
  admisiones: number;
  excluidas: number;
  facturables: number;
  total: string;
  anticipo: string;
  saldo: string;
  devolucion: string;
  costos: string;
  contribucion: string;
  margen: string;
  saldo_cobrado: boolean;
}

/**
 * `m4_liquidacion.*`: el contrato del evento (`contratos`), las admisiones y exclusiones
 * facturables (`m2_evidencia.decisiones`, `m1_config_permisos.boletas`) y la liquidación calculada.
 * D2 solo observa decisiones ya tomadas por C2; no autoriza ni recalcula el consumo.
 */
export class LiquidacionRepositorioPg implements LiquidacionRepositorio {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  private async obtenerContrato(eventoId: string): Promise<FilaContrato | null> {
    const { rows } = await this.pool.query<FilaContrato>(
      `SELECT c.id AS contrato_id, e.admisiones_estimadas
       FROM m4_liquidacion.contrato_eventos ce
       JOIN m4_liquidacion.contratos c ON c.id = ce.contrato_id
       JOIN m1_config_permisos.eventos e ON e.id = ce.evento_id
       WHERE ce.evento_id = $1`,
      [eventoId],
    );
    return rows[0] ?? null;
  }

  async obtenerDatos(eventoId: string): Promise<DatosLiquidacion | null> {
    const contrato = await this.obtenerContrato(eventoId);
    if (!contrato) return null;
    const { rows: conteos } = await this.pool.query<FilaConteos>(
      `SELECT
         count(*) FILTER (WHERE d.admision) AS admisiones,
         count(*) FILTER (WHERE d.admision AND b.excluida) AS excluidas
       FROM m2_evidencia.decisiones d
       LEFT JOIN m1_config_permisos.boletas b ON b.evento_id = d.evento_id AND b.referencia = d.referencia
       WHERE d.evento_id = $1`,
      [eventoId],
    );
    const { rows: incidentes } = await this.pool.query<{ existe: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM m2_evidencia.incidentes WHERE evento_id = $1 AND tipo = 'COORDINADOR') AS existe`,
      [eventoId],
    );
    return {
      admisiones: Number(conteos[0]?.admisiones ?? 0),
      excluidas: Number(conteos[0]?.excluidas ?? 0),
      admisionesEstimadas: contrato.admisiones_estimadas,
      huboFallaCoordinador: incidentes[0]?.existe ?? false,
    };
  }

  async guardar(eventoId: string, resumen: ResumenLiquidacion): Promise<void> {
    const contrato = await this.obtenerContrato(eventoId);
    if (!contrato) throw new Error(`No hay contrato asociado al evento ${eventoId}`);
    await this.pool.query(
      `INSERT INTO m4_liquidacion.liquidaciones
        (evento_id, contrato_id, admisiones, excluidas, facturables, subtotal, total,
         anticipo, saldo, devolucion, costos, contribucion, margen, saldo_cobrado, calculada_en)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,now())
       ON CONFLICT (evento_id) DO UPDATE SET
         contrato_id = EXCLUDED.contrato_id, admisiones = EXCLUDED.admisiones,
         excluidas = EXCLUDED.excluidas, facturables = EXCLUDED.facturables,
         subtotal = EXCLUDED.subtotal, total = EXCLUDED.total, anticipo = EXCLUDED.anticipo,
         saldo = EXCLUDED.saldo, devolucion = EXCLUDED.devolucion, costos = EXCLUDED.costos,
         contribucion = EXCLUDED.contribucion, margen = EXCLUDED.margen,
         saldo_cobrado = EXCLUDED.saldo_cobrado, calculada_en = now()`,
      [
        eventoId, contrato.contrato_id, resumen.admisiones, resumen.excluidas, resumen.facturables,
        resumen.importe, resumen.anticipo, resumen.saldo, resumen.devolucion, resumen.costos,
        resumen.contribucion, resumen.margen, resumen.saldoCobrado,
      ],
    );
  }

  async obtenerGuardada(eventoId: string): Promise<ResumenLiquidacion | null> {
    const { rows } = await this.pool.query<FilaLiquidacion>(
      `SELECT admisiones, excluidas, facturables, total, anticipo, saldo, devolucion, costos,
              contribucion, margen, saldo_cobrado
       FROM m4_liquidacion.liquidaciones WHERE evento_id = $1`,
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) return null;
    return {
      moneda: 'USD',
      admisiones: fila.admisiones,
      excluidas: fila.excluidas,
      facturables: fila.facturables,
      importe: fila.total,
      anticipo: fila.anticipo,
      saldo: fila.saldo,
      devolucion: fila.devolucion,
      costos: fila.costos,
      contribucion: fila.contribucion,
      margen: fila.margen,
      saldoCobrado: fila.saldo_cobrado,
    };
  }

  async marcarCobrado(eventoId: string, cobroVenceEn: Date): Promise<void> {
    await this.pool.query(
      `UPDATE m4_liquidacion.liquidaciones
       SET saldo_cobrado = true, cobrado_en = now(), cerrada_en = now(), cobro_vence_en = $2
       WHERE evento_id = $1`,
      [eventoId, cobroVenceEn],
    );
  }
}
