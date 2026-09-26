import type { Pool } from 'pg';
import type { Rol } from '../../../../shared/contracts/common.ts';
import type { Diferencia } from '../../../../shared/contracts/o2.ts';
import type { NuevaDiferencia, DatosCondicionesCierre } from '../domain/index.ts';
import type {
  ConciliacionRepositorio,
  DeteccionRepositorio,
  DiferenciasRepositorio,
  EstadoConciliacionAlmacen,
  EstadoConciliacionGuardado,
} from '../application/index.ts';

interface FilaConciliacion {
  estado: EstadoConciliacionAlmacen;
  preliminar_en: Date | null;
  definitivo_en: Date | null;
}

interface FilaDiferencia {
  id: string;
  tipo: string;
  titulo: string;
  origen: string;
  descripcion: string;
  casos: number;
  referencia: string | null;
  intento_id: string | null;
  opciones: { id: string; texto: string; nota?: string }[];
  estado: string;
  detectada_en: Date;
  resolucion: string | null;
  resuelta_por: Rol | null;
  resuelta_en: Date | null;
}

function segundosDelDia(fecha: Date): number {
  return fecha.getUTCHours() * 3600 + fecha.getUTCMinutes() * 60 + fecha.getUTCSeconds();
}

/** `m3_conciliacion.diferencias.estado` usa `pendiente|resuelta` (001_initial.sql); el contrato O2 usa `abierta|resuelta`. */
function estadoDiferenciaContrato(estado: string): Diferencia['estado'] {
  return estado === 'pendiente' ? 'abierta' : 'resuelta';
}

function aDiferencia(fila: FilaDiferencia): Diferencia {
  return {
    id: fila.id,
    tipo: fila.tipo as Diferencia['tipo'],
    titulo: fila.titulo,
    origen: fila.origen,
    detalle: fila.descripcion,
    casos: fila.casos,
    referencia: fila.referencia,
    intentoId: fila.intento_id,
    opciones: fila.opciones,
    estado: estadoDiferenciaContrato(fila.estado),
    detectadaEnS: segundosDelDia(fila.detectada_en),
    resolucion: fila.resolucion,
    resueltaPor: fila.resuelta_por,
    resueltaEnS: fila.resuelta_en ? segundosDelDia(fila.resuelta_en) : null,
  };
}

/** `m3_conciliacion.conciliaciones`: estado de cierre por evento. */
export class ConciliacionRepositorioPg implements ConciliacionRepositorio {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async obtenerEventoActualId(): Promise<string | null> {
    // D2 no tiene indicador "actual": primero el cerrado más reciente (pendiente de cierre),
    // luego el abierto, luego el preparado de ID más alto (mismo criterio que `configuration-permissions`).
    const { rows } = await this.pool.query<{ id: string }>(`
      SELECT id FROM m1_config_permisos.eventos
      WHERE estado IN ('cerrado', 'abierto', 'preparacion')
      ORDER BY CASE estado WHEN 'cerrado' THEN 0 WHEN 'abierto' THEN 1 ELSE 2 END, id DESC
      LIMIT 1
    `);
    return rows[0]?.id ?? null;
  }

  async obtenerEstado(eventoId: string): Promise<EstadoConciliacionGuardado> {
    const { rows } = await this.pool.query<FilaConciliacion>(
      `INSERT INTO m3_conciliacion.conciliaciones (evento_id) VALUES ($1)
       ON CONFLICT (evento_id) DO UPDATE SET evento_id = EXCLUDED.evento_id
       RETURNING estado, preliminar_en, definitivo_en`,
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) throw new Error(`No se pudo obtener/crear la conciliación del evento ${eventoId}`);
    return { estado: fila.estado, preliminarEn: fila.preliminar_en, definitivoEn: fila.definitivo_en };
  }

  async marcarEnCurso(eventoId: string): Promise<void> {
    await this.pool.query(
      `UPDATE m3_conciliacion.conciliaciones SET estado = 'en-curso', actualizado_en = now()
       WHERE evento_id = $1 AND estado = 'sin-iniciar'`,
      [eventoId],
    );
  }

  async marcarPreliminar(eventoId: string, usuario: string, momento: Date): Promise<void> {
    await this.pool.query(
      `UPDATE m3_conciliacion.conciliaciones
       SET estado = 'preliminar', preliminar_en = $2,
           preliminar_por = (SELECT id FROM auth.operadores WHERE usuario = $3), actualizado_en = now()
       WHERE evento_id = $1`,
      [eventoId, momento, usuario],
    );
  }

  async marcarDefinitivo(eventoId: string, usuario: string, momento: Date): Promise<void> {
    await this.pool.query(
      `UPDATE m3_conciliacion.conciliaciones
       SET estado = 'conciliado', definitivo_en = $2,
           definitivo_por = (SELECT id FROM auth.operadores WHERE usuario = $3), actualizado_en = now()
       WHERE evento_id = $1`,
      [eventoId, momento, usuario],
    );
  }
}

/** `m3_conciliacion.diferencias`/`resoluciones`: diferencias abiertas por evento y su resolución. */
export class DiferenciasRepositorioPg implements DiferenciasRepositorio {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async listar(eventoId: string): Promise<Diferencia[]> {
    const { rows } = await this.pool.query<FilaDiferencia>(
      `SELECT id, tipo, titulo, origen, descripcion, casos, referencia, intento_id, opciones,
              estado, detectada_en, resolucion, resuelta_por, resuelta_en
       FROM m3_conciliacion.diferencias WHERE evento_id = $1 ORDER BY detectada_en`,
      [eventoId],
    );
    return rows.map(aDiferencia);
  }

  async existeAbiertaPorReferencia(eventoId: string, referencia: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ existe: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM m3_conciliacion.diferencias
         WHERE evento_id = $1 AND referencia = $2 AND tipo = 'anulacion' AND estado = 'pendiente'
       ) AS existe`,
      [eventoId, referencia],
    );
    return rows[0]?.existe ?? false;
  }

  async existeAbiertaDiario(eventoId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ existe: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM m3_conciliacion.diferencias WHERE evento_id = $1 AND tipo = 'diario' AND estado = 'pendiente'
       ) AS existe`,
      [eventoId],
    );
    return rows[0]?.existe ?? false;
  }

  async crear(eventoId: string, diferencia: NuevaDiferencia): Promise<Diferencia> {
    const { rows } = await this.pool.query<FilaDiferencia>(
      `INSERT INTO m3_conciliacion.diferencias
        (id, evento_id, tipo, titulo, origen, descripcion, casos, referencia, intento_id, opciones, detectada_en)
       VALUES ('DIF-' || lpad(nextval('m3_conciliacion.diferencias_id_seq')::text, 3, '0'),
               $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, to_timestamp($10))
       RETURNING id, tipo, titulo, origen, descripcion, casos, referencia, intento_id, opciones,
                 estado, detectada_en, resolucion, resuelta_por, resuelta_en`,
      [
        eventoId, diferencia.tipo, diferencia.titulo, diferencia.origen, diferencia.detalle, diferencia.casos,
        diferencia.referencia, diferencia.intentoId, JSON.stringify(diferencia.opciones), diferencia.detectadaEnS,
      ],
    );
    return aDiferencia(rows[0]!);
  }

  async obtener(eventoId: string, diferenciaId: string): Promise<Diferencia | null> {
    const { rows } = await this.pool.query<FilaDiferencia>(
      `SELECT id, tipo, titulo, origen, descripcion, casos, referencia, intento_id, opciones,
              estado, detectada_en, resolucion, resuelta_por, resuelta_en
       FROM m3_conciliacion.diferencias WHERE evento_id = $1 AND id = $2`,
      [eventoId, diferenciaId],
    );
    return rows[0] ? aDiferencia(rows[0]) : null;
  }

  async resolver(
    eventoId: string,
    diferenciaId: string,
    opcionId: string,
    operador: { usuario: string; rol: Rol },
    momento: Date,
  ): Promise<Diferencia> {
    const { rows } = await this.pool.query<FilaDiferencia>(
      `UPDATE m3_conciliacion.diferencias
       SET estado = 'resuelta', resolucion = $3, resuelta_por = $4, resuelta_en = $5
       WHERE evento_id = $1 AND id = $2
       RETURNING id, tipo, titulo, origen, descripcion, casos, referencia, intento_id, opciones,
                 estado, detectada_en, resolucion, resuelta_por, resuelta_en`,
      [eventoId, diferenciaId, opcionId, operador.rol, momento],
    );
    await this.pool.query(
      `INSERT INTO m3_conciliacion.resoluciones (evento_id, diferencia_id, opcion, operador_id)
       VALUES ($1, $2, $3, (SELECT id FROM auth.operadores WHERE usuario = $4))`,
      [eventoId, diferenciaId, opcionId, operador.usuario],
    );
    return aDiferencia(rows[0]!);
  }
}

/**
 * Condiciones de cierre (prototipo §9) leídas directamente de los esquemas de otros módulos
 * (patrón ya usado por `o2-repositorio.ts`): D2 solo observa, no reinterpreta el consumo.
 */
export class DeteccionRepositorioPg implements DeteccionRepositorio {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async obtenerCondicionesCierre(eventoId: string): Promise<DatosCondicionesCierre> {
    const { rows } = await this.pool.query<{
      ventana_cerrada: boolean;
      diarios_sincronizados: boolean;
      buzon_vacio: boolean;
      cambios_al_dia: boolean;
      preliminar_entregado: boolean;
      diferencias_resueltas: boolean;
    }>(
      `SELECT
         (e.estado = 'cerrado') AS ventana_cerrada,
         COALESCE((SELECT bool_and(p.pendientes_diario = 0) FROM m2_evidencia.puntos_estado p WHERE p.evento_id = e.id), true)
           AS diarios_sincronizados,
         COALESCE((SELECT ee.outbox_pendientes = 0 AND ee.enlace_en_linea FROM m2_evidencia.eventos_estado ee WHERE ee.evento_id = e.id), false)
           AS buzon_vacio,
         (e.version_permisos >= COALESCE((SELECT max(cp.version) FROM m1_config_permisos.cambios_permisos cp WHERE cp.evento_id = e.id), 0))
           AS cambios_al_dia,
         (c.estado IN ('preliminar', 'conciliado')) AS preliminar_entregado,
         NOT EXISTS(SELECT 1 FROM m3_conciliacion.diferencias d WHERE d.evento_id = e.id AND d.estado = 'pendiente') AS diferencias_resueltas
       FROM m1_config_permisos.eventos e
       LEFT JOIN m3_conciliacion.conciliaciones c ON c.evento_id = e.id
       WHERE e.id = $1`,
      [eventoId],
    );
    const fila = rows[0];
    if (!fila) throw new Error(`No existe el evento ${eventoId}`);
    return {
      ventanaCerrada: fila.ventana_cerrada,
      diariosSincronizados: fila.diarios_sincronizados,
      buzonVacio: fila.buzon_vacio,
      cambiosAlDia: fila.cambios_al_dia,
      preliminarEntregado: fila.preliminar_entregado,
      diferenciasResueltas: fila.diferencias_resueltas,
    };
  }

  async anulacionesConAdmisionPrevia(eventoId: string): Promise<{ referencia: string; intentoId: string }[]> {
    const { rows } = await this.pool.query<{ referencia: string; id_origen: string }>(
      `SELECT b.referencia, d.id_origen
       FROM m1_config_permisos.boletas b
       JOIN m2_evidencia.decisiones d
         ON d.evento_id = b.evento_id AND d.referencia = b.referencia AND d.admision
       WHERE b.evento_id = $1 AND b.anulacion_recibida_en IS NOT NULL
         AND d.instante_decision < b.anulacion_recibida_en`,
      [eventoId],
    );
    return rows.map((fila) => ({ referencia: fila.referencia, intentoId: fila.id_origen }));
  }

  async intentosSinDecisionConfirmada(eventoId: string): Promise<number> {
    const { rows } = await this.pool.query<{ pendientes: string }>(
      `SELECT COALESCE(sum(pendientes_diario), 0) AS pendientes
       FROM m2_evidencia.puntos_estado WHERE evento_id = $1`,
      [eventoId],
    );
    return Number(rows[0]?.pendientes ?? 0);
  }

  async marcarBoletaExcluida(eventoId: string, referencia: string, excluida: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE m1_config_permisos.boletas SET excluida = $3 WHERE evento_id = $1 AND referencia = $2`,
      [eventoId, referencia, excluida],
    );
  }
}
