import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AcuseLoteEvidencia, LoteEvidencia, RegistroDecision, RegistroEvidencia, RegistroEstadoCoordinador } from '../../../../shared/contracts/e1.ts';
import { Incidente, type AccionIncidente } from '../../../../shared/contracts/o2.ts';
import { ConflictoEvidencia } from '../application/index.ts';
import type {
  AutorAccion, IncidenteRepositorio, LoteEvidenciaRepositorio, ProcesarAceptados, ProyeccionIntentosDiarioRepositorio,
  ProyeccionPuntosRepositorio, Resultado, ResultadoAccionIncidente,
} from '../application/index.ts';
import { segundosDelDia, type IntentoDiarioPendiente, type NuevoIncidente } from '../domain/index.ts';

/** Orden de escalación (Escalar sube un nivel; T2 §4 "Escalar al líder técnico"). */
const SIGUIENTE_PRIORIDAD: Record<string, string> = { baja: 'media', media: 'alta', alta: 'critica', critica: 'critica' };

type Conexion = Pool | PoolClient;

function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    return `{${Object.entries(valor).sort(([a], [b]) => a.localeCompare(b))
      .map(([clave, contenido]) => `${JSON.stringify(clave)}:${canonico(contenido)}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

function hash(valor: unknown): string {
  return createHash('sha256').update(canonico(valor)).digest('hex');
}

function ocurridoEn(registro: RegistroEvidencia): string {
  if (registro.tipo === 'decision') return registro.instanteDecision;
  if (registro.tipo === 'estado-coordinador') return registro.instante;
  return registro.instanteLector;
}

export class RepositorioPuntosPg implements ProyeccionPuntosRepositorio {
  private readonly db: Conexion;
  constructor(db: Conexion) { this.db = db; }

  async actualizarLatidoPunto(
    eventoId: string, puntoId: string, instanteLector: string, pendientesDiario: number, diarioTotal: number,
    lectorId: string,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO m2_evidencia.puntos_estado
        (evento_id, punto_id, lector_id, estado, ultima_comunicacion, pendientes_diario, diario_total)
       VALUES ($1,$2,$3,'en-linea',$4,$5,$6)
       ON CONFLICT (evento_id, punto_id) DO UPDATE SET lector_id = EXCLUDED.lector_id,
         estado = 'en-linea', ultima_comunicacion = EXCLUDED.ultima_comunicacion,
         pendientes_diario = EXCLUDED.pendientes_diario, diario_total = EXCLUDED.diario_total, actualizado_en = now()
       WHERE m2_evidencia.puntos_estado.ultima_comunicacion IS NULL
          OR m2_evidencia.puntos_estado.ultima_comunicacion <= EXCLUDED.ultima_comunicacion`,
      [eventoId, puntoId, lectorId, instanteLector, pendientesDiario, diarioTotal],
    );
  }

  async listarPuntosConLatidoVencido(umbralMs: number): Promise<Array<{
    eventoId: string; puntoId: string; ultimaComunicacionInstante: Date;
  }>> {
    const { rows } = await this.db.query<{
      evento_id: string; punto_id: string; ultima_comunicacion: Date;
    }>(
      `SELECT evento_id, punto_id, ultima_comunicacion FROM m2_evidencia.puntos_estado
       WHERE estado IN ('en-linea', 'sin-comunicacion') AND ultima_comunicacion IS NOT NULL
         AND ultima_comunicacion < now() - ($1::double precision * interval '1 millisecond')`,
      [umbralMs],
    );
    return rows.map((row) => ({
      eventoId: row.evento_id, puntoId: row.punto_id, ultimaComunicacionInstante: row.ultima_comunicacion,
    }));
  }

  async marcarSinComunicacion(eventoId: string, puntoId: string): Promise<void> {
    await this.db.query(
      `UPDATE m2_evidencia.puntos_estado SET estado = 'sin-comunicacion', actualizado_en = now()
       WHERE evento_id = $1 AND punto_id = $2 AND estado IN ('en-linea', 'sin-comunicacion')
         AND ultima_comunicacion < now() - interval '60 seconds'`,
      [eventoId, puntoId],
    );
  }
}

export class RepositorioIntentosDiarioPg implements ProyeccionIntentosDiarioRepositorio {
  private readonly db: Conexion;
  constructor(db: Conexion) { this.db = db; }

  async registrarPendiente(intento: IntentoDiarioPendiente): Promise<void> {
    await this.db.query(
      `INSERT INTO m2_evidencia.intentos_diario
        (evidencia_id, evento_id, id_origen, referencia, zona_solicitada, proposito, punto_id, lector_id,
         motivo_local, instante_lector, recibido_en_coordinador, estado)
       SELECT e.id, e.evento_id, e.id_origen, $3, $4, $5, $6, $7, $8, $9, $10, $11
       FROM m2_evidencia.evidencias e
       WHERE e.evento_id = $1 AND e.tipo = 'intento-diario' AND e.id_origen = $2
       ON CONFLICT (evento_id, id_origen) DO NOTHING`,
      [intento.eventoId, intento.idOrigen, intento.referencia, intento.zonaSolicitada, intento.proposito,
        intento.puntoId, intento.lectorId, intento.motivoLocal, intento.instanteLector,
        intento.recibidoEnCoordinador, intento.estado],
    );
  }
}

interface FilaIncidente extends Record<string, unknown> {
  id: string;
  recibida_en: Date;
  actuada_en: Date | null;
  resuelta_en: Date | null;
  recuperada_en: Date | null;
  reloj_desde: Date | null;
  entradas: Array<{ creada_en: string; autor: string; tipo: string; texto: string }>;
}

function leerIncidente(fila: FilaIncidente): Incidente {
  const segundos = (instante: Date | null) => instante === null ? null : segundosDelDia(instante);
  return Incidente.parse({
    id: fila.id, tipo: fila.tipo, clasificacion: fila.clasificacion, prioridad: fila.prioridad,
    puntoId: fila.punto_id, componente: fila.componente, zona: fila.zona_id, titulo: fila.titulo,
    descripcion: fila.descripcion, responsable: fila.responsable, estado: fila.estado,
    recibidaEnS: segundosDelDia(fila.recibida_en), actuadaEnS: segundos(fila.actuada_en),
    resueltaEnS: segundos(fila.resuelta_en), recuperadaEnS: segundos(fila.recuperada_en),
    metaRecuperacionS: fila.meta_recuperacion_s === null ? null : Number(fila.meta_recuperacion_s),
    relojDesdeS: segundos(fila.reloj_desde) ?? segundosDelDia(fila.recibida_en),
    destacado: fila.destacado, checklist: fila.checklist,
    bitacora: fila.entradas.map((entrada) => ({
      t: segundosDelDia(new Date(entrada.creada_en)), autor: entrada.autor, tipo: entrada.tipo, texto: entrada.texto,
    })),
  });
}

const CONSULTA_INCIDENTES = `
  SELECT i.*, COALESCE((
    SELECT jsonb_agg(jsonb_build_object('creada_en', b.creada_en, 'autor', b.autor,
      'tipo', b.tipo, 'texto', b.texto) ORDER BY b.creada_en, b.id)
    FROM m2_evidencia.bitacora b WHERE b.incidente_id = i.id
  ), '[]'::jsonb) AS entradas
  FROM m2_evidencia.incidentes i`;

export class RepositorioIncidentesPg implements IncidenteRepositorio {
  private readonly db: Conexion;
  constructor(db: Conexion) { this.db = db; }

  async crearSiNoExisteActivo(eventoId: string, incidente: NuevoIncidente, detectadoEn: Date = new Date()): Promise<Incidente> {
    const ejecutar = async (client: PoolClient): Promise<Incidente> => {
      // Serializa aperturas y secuencias INC-#### incluso cuando no existe todavía fila que bloquear.
      await client.query('SELECT pg_advisory_xact_lock($1)', [20260925]);
      const existente = await client.query<FilaIncidente>(
        `${CONSULTA_INCIDENTES} WHERE i.evento_id = $1 AND i.tipo = 'SIN_COMUNICACION'
         AND i.punto_id = $2 AND i.estado IN ('nuevo', 'en-curso') LIMIT 1`,
        [eventoId, incidente.puntoId],
      );
      if (existente.rows[0]) return leerIncidente(existente.rows[0]);
      const { rows: secuencia } = await client.query<{ siguiente: number }>(
        `SELECT COALESCE(MAX(substring(id FROM '^INC-([0-9]+)$')::integer), 0) + 1 AS siguiente
         FROM m2_evidencia.incidentes`,
      );
      const id = `INC-${String(secuencia[0]!.siguiente).padStart(4, '0')}`;
      await client.query(
        `INSERT INTO m2_evidencia.incidentes
          (id, evento_id, tipo, clasificacion, prioridad, punto_id, componente, zona_id,
           titulo, descripcion, responsable, estado, recibida_en, reloj_desde, destacado, checklist)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [id, eventoId, incidente.tipo, incidente.clasificacion, incidente.prioridad, incidente.puntoId,
          incidente.componente, incidente.zona, incidente.titulo, incidente.descripcion,
          incidente.responsable, incidente.estado, detectadoEn, detectadoEn,
          incidente.destacado, JSON.stringify(incidente.checklist)],
      );
      for (const entrada of incidente.bitacora) {
        await client.query(
          `INSERT INTO m2_evidencia.bitacora (evento_id, incidente_id, autor, tipo, texto, creada_en)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [eventoId, id, entrada.autor, entrada.tipo, entrada.texto, detectadoEn],
        );
      }
      const { rows } = await client.query<FilaIncidente>(`${CONSULTA_INCIDENTES} WHERE i.id = $1`, [id]);
      return leerIncidente(rows[0]!);
    };
    if ('release' in this.db) return ejecutar(this.db);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const creado = await ejecutar(client);
      await client.query('COMMIT');
      return creado;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolverActivoPorPunto(eventoId: string, puntoId: string, instante: Date): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE m2_evidencia.incidentes i SET estado = 'resuelto',
         resuelta_en = $3, recuperada_en = $3
       WHERE i.evento_id = $1 AND i.tipo = 'SIN_COMUNICACION' AND i.punto_id = $2
         AND i.estado IN ('nuevo', 'en-curso')
         AND EXISTS (SELECT 1 FROM m2_evidencia.puntos_estado p
           WHERE p.evento_id = $1 AND p.punto_id = $2 AND p.estado = 'en-linea')
       RETURNING i.id`,
      [eventoId, puntoId, instante],
    );
    for (const row of rows) {
      await this.db.query(
        `INSERT INTO m2_evidencia.bitacora (evento_id, incidente_id, autor, tipo, texto, creada_en)
         VALUES ($1,$2,'sistema','estado','Vuelve la comunicación',$3)`,
        [eventoId, row.id, instante],
      );
    }
  }

  async listar(): Promise<Incidente[]> {
    const { rows } = await this.db.query<FilaIncidente>(`${CONSULTA_INCIDENTES} ORDER BY i.recibida_en DESC, i.id DESC`);
    return rows.map(leerIncidente);
  }

  async obtener(id: string): Promise<Incidente | null> {
    const { rows } = await this.db.query<FilaIncidente>(`${CONSULTA_INCIDENTES} WHERE i.id = $1`, [id]);
    return rows[0] ? leerIncidente(rows[0]) : null;
  }

  /**
   * Aplica una acción de operador (T31, KR1.3): actualiza el incidente y agrega la entrada de
   * bitácora correspondiente en la misma transacción. `tomar` fija `actuada_en` una sola vez
   * (regla 6, bitácora de solo adición: nunca se corrige el reloj de reacción).
   */
  async aplicarAccion(id: string, accion: AccionIncidente, autor: AutorAccion): Promise<ResultadoAccionIncidente> {
    const ejecutar = async (client: PoolClient): Promise<ResultadoAccionIncidente> => {
      const { rows } = await client.query<{ evento_id: string; prioridad: string; destacado: boolean; checklist: Array<{ texto: string; hecho: boolean }> }>(
        'SELECT evento_id, prioridad, destacado, checklist FROM m2_evidencia.incidentes WHERE id = $1 FOR UPDATE',
        [id],
      );
      const fila = rows[0];
      if (!fila) return { tipo: 'no-encontrada' };
      const eventoId = fila.evento_id;

      let entrada: { tipo: 'accion' | 'nota' | 'estado'; texto: string } | null = null;
      switch (accion.accion) {
        case 'tomar':
          await client.query(
            `UPDATE m2_evidencia.incidentes SET
               estado = CASE WHEN estado = 'nuevo' THEN 'en-curso' ELSE estado END,
               actuada_en = COALESCE(actuada_en, now())
             WHERE id = $1`,
            [id],
          );
          entrada = { tipo: 'accion', texto: 'Incidente tomado.' };
          break;
        case 'nota':
          entrada = { tipo: 'nota', texto: accion.texto };
          break;
        case 'escalar': {
          const siguiente = SIGUIENTE_PRIORIDAD[fila.prioridad] ?? fila.prioridad;
          await client.query(
            `UPDATE m2_evidencia.incidentes SET prioridad = $2, actuada_en = COALESCE(actuada_en, now()) WHERE id = $1`,
            [id, siguiente],
          );
          entrada = { tipo: 'estado', texto: 'Escalado a ' + siguiente + '.' + (accion.nota ? ' ' + accion.nota : '') };
          break;
        }
        case 'descartar':
          await client.query(
            `UPDATE m2_evidencia.incidentes SET estado = 'descartado', resuelta_en = COALESCE(resuelta_en, now())
             WHERE id = $1`,
            [id],
          );
          entrada = { tipo: 'estado', texto: 'Descartado.' + (accion.nota ? ' ' + accion.nota : '') };
          break;
        case 'resolver':
          await client.query(
            `UPDATE m2_evidencia.incidentes SET estado = 'resuelto', resuelta_en = COALESCE(resuelta_en, now())
             WHERE id = $1`,
            [id],
          );
          entrada = { tipo: 'estado', texto: 'Resuelto.' + (accion.nota ? ' ' + accion.nota : '') };
          break;
        case 'actualizar': {
          const cambios: string[] = [];
          const notas: string[] = [];
          if (accion.clasificacion) { cambios.push('clasificacion'); notas.push('clasificación ' + accion.clasificacion); }
          if (accion.prioridad) { cambios.push('prioridad'); notas.push('prioridad ' + accion.prioridad); }
          if (accion.responsable) { cambios.push('responsable'); notas.push('responsable ' + accion.responsable); }
          if (cambios.length) {
            const asignaciones = cambios.map((columna, i) => `${columna} = $${i + 2}`).join(', ');
            const valores = cambios.map((columna) => {
              if (columna === 'clasificacion') return accion.clasificacion;
              if (columna === 'prioridad') return accion.prioridad;
              return accion.responsable;
            });
            await client.query(`UPDATE m2_evidencia.incidentes SET ${asignaciones} WHERE id = $1`, [id, ...valores]);
            entrada = { tipo: 'estado', texto: 'Actualizado: ' + notas.join(', ') + '.' };
          }
          break;
        }
        case 'destacar': {
          const nuevo = accion.valor !== undefined ? accion.valor : !fila.destacado;
          await client.query('UPDATE m2_evidencia.incidentes SET destacado = $2 WHERE id = $1', [id, nuevo]);
          break;
        }
        case 'checklist':
          await client.query(
            `UPDATE m2_evidencia.incidentes SET checklist = jsonb_set(
               checklist, ARRAY[$2::text, 'hecho'],
               to_jsonb(NOT COALESCE((checklist -> $2::int ->> 'hecho')::boolean, false))
             ) WHERE id = $1 AND jsonb_array_length(checklist) > $2::int`,
            [id, accion.indice],
          );
          break;
      }

      if (entrada) {
        await client.query(
          `INSERT INTO m2_evidencia.bitacora (evento_id, incidente_id, operador_id, autor, tipo, texto)
           VALUES ($1,$2,(SELECT id FROM auth.operadores WHERE usuario = $3),$4,$5,$6)`,
          [eventoId, id, autor.usuario, autor.rol, entrada.tipo, entrada.texto],
        );
      }

      const { rows: actualizado } = await client.query<FilaIncidente>(`${CONSULTA_INCIDENTES} WHERE i.id = $1`, [id]);
      return { tipo: 'ok', incidente: leerIncidente(actualizado[0]!) };
    };
    if ('release' in this.db) return ejecutar(this.db);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const resultado = await ejecutar(client);
      await client.query('COMMIT');
      return resultado;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function guardarDecision(client: PoolClient, eventoId: string, evidenciaId: string, r: RegistroDecision): Promise<void> {
  // D2 exige propósito no nulo: el caso de código desconocido conserva el null original en evidencias.
  await client.query(
    `INSERT INTO m2_evidencia.decisiones
      (evidencia_id, evento_id, id_origen, referencia, zona_id, punto_id, lector_id, instante_decision,
       decision, motivo, proposito, admision, concurrente, anulacion_en_transito, latencia_ms,
       via, version_permisos, version_politicas, antiguedad_permisos_s)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL,$15,$16,$17,$18)`,
    [evidenciaId, eventoId, r.idOrigen, r.codigo, r.zona, r.puntoId, r.lectorId,
      r.instanteDecision, r.decision, r.motivo, r.proposito ?? 'ingreso',
      r.admision, r.concurrente, r.anulacionEnTransito, r.evidencia.via,
      r.evidencia.versionPermisos, r.evidencia.versionPoliticas,
      Math.floor(r.evidencia.antiguedadPermisosS)],
  );
}

async function guardarEstadoCoordinador(client: PoolClient, eventoId: string, r: RegistroEstadoCoordinador): Promise<void> {
  await client.query(
    `INSERT INTO m2_evidencia.eventos_estado
      (evento_id, coordinador_estado, coordinador_desde, coordinador_id, enlace_en_linea,
       outbox_pendientes, outbox_edad_max_s, ultimo_lote_recibido, version_permisos, version_politicas)
     VALUES ($1,$2,$3,$4,true,$5,$6,now(),$7,$8)
     ON CONFLICT (evento_id) DO UPDATE SET
       coordinador_estado = EXCLUDED.coordinador_estado, coordinador_desde = EXCLUDED.coordinador_desde,
       coordinador_id = EXCLUDED.coordinador_id, enlace_en_linea = true,
       outbox_pendientes = EXCLUDED.outbox_pendientes, outbox_edad_max_s = EXCLUDED.outbox_edad_max_s,
       ultimo_lote_recibido = now(), version_permisos = EXCLUDED.version_permisos,
       version_politicas = EXCLUDED.version_politicas, actualizado_en = now()
     WHERE m2_evidencia.eventos_estado.coordinador_desde IS NULL
        OR m2_evidencia.eventos_estado.coordinador_desde <= EXCLUDED.coordinador_desde`,
    [eventoId, r.estado, r.instante, r.coordinadorId, r.outboxPendientes,
      Math.floor(r.outboxEdadMaxS), r.versionPermisos, r.versionPoliticas],
  );
}

export class RepositorioLotesPg implements LoteEvidenciaRepositorio {
  private readonly pool: Pool;
  constructor(pool: Pool) { this.pool = pool; }

  async yaProcesado(idLote: string, lote: LoteEvidencia): Promise<AcuseLoteEvidencia | null> {
    const { rows } = await this.pool.query<{
      evento_id: string; contenido_hash: string; acuse: AcuseLoteEvidencia;
    }>('SELECT evento_id, contenido_hash, acuse FROM m2_evidencia.lotes WHERE id_lote = $1', [idLote]);
    const anterior = rows[0];
    if (!anterior) return null;
    if (anterior.evento_id !== lote.eventoId || anterior.contenido_hash !== hash(lote)) {
      throw new ConflictoEvidencia(`El lote ${idLote} ya existe con contenido diferente`);
    }
    return anterior.acuse;
  }

  async guardarLoteYRegistros(lote: LoteEvidencia, resultados: Resultado[], procesarAceptados?: ProcesarAceptados): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const reservado = await client.query(
        `INSERT INTO m2_evidencia.lotes
          (id_lote, recinto_id, evento_id, coordinador_id, emitido_en, contenido_hash)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id_lote) DO NOTHING`,
        [lote.idLote, lote.recintoId, lote.eventoId, lote.coordinadorId, lote.emitidoEn, hash(lote)],
      );
      if (!reservado.rowCount) {
        const existente = await client.query<{ evento_id: string; contenido_hash: string }>(
          'SELECT evento_id, contenido_hash FROM m2_evidencia.lotes WHERE id_lote = $1', [lote.idLote],
        );
        if (existente.rows[0]?.evento_id !== lote.eventoId || existente.rows[0]?.contenido_hash !== hash(lote)) {
          throw new ConflictoEvidencia(`El lote ${lote.idLote} ya existe con contenido diferente`);
        }
        await client.query('COMMIT');
        return;
      }
      const aceptados: RegistroEvidencia[] = [];
      for (const [indice, registro] of lote.registros.entries()) {
        const contenidoHash = hash(registro);
        const guardado = await client.query<{ id: string }>(
          `INSERT INTO m2_evidencia.evidencias
            (id_lote, evento_id, tipo, id_origen, contenido_hash, contenido, ocurrido_en)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
           ON CONFLICT (evento_id, tipo, id_origen) DO NOTHING RETURNING id`,
          [lote.idLote, lote.eventoId, registro.tipo, registro.idOrigen,
            contenidoHash, JSON.stringify(registro), ocurridoEn(registro)],
        );
        if (guardado.rows[0]) {
          aceptados.push(registro);
          if (registro.tipo === 'decision') await guardarDecision(client, lote.eventoId, guardado.rows[0].id, registro);
          if (registro.tipo === 'estado-coordinador') await guardarEstadoCoordinador(client, lote.eventoId, registro);
        } else {
          const existente = await client.query<{ contenido_hash: string }>(
            `SELECT contenido_hash FROM m2_evidencia.evidencias
             WHERE evento_id = $1 AND tipo = $2 AND id_origen = $3`,
            [lote.eventoId, registro.tipo, registro.idOrigen],
          );
          if (existente.rows[0]?.contenido_hash !== contenidoHash) {
            throw new ConflictoEvidencia(`La evidencia ${registro.tipo}/${registro.idOrigen} ya existe con contenido diferente`);
          }
          resultados[indice]!.estado = 'duplicado';
        }
      }
      await procesarAceptados?.(
        aceptados, new RepositorioPuntosPg(client), new RepositorioIncidentesPg(client),
        new RepositorioIntentosDiarioPg(client),
      );
      const acuse: AcuseLoteEvidencia = {
        idLote: lote.idLote, recibidoEn: new Date().toISOString(),
        aceptados: aceptados.length, duplicados: resultados.length - aceptados.length,
        repetido: false, resultados,
      };
      await client.query(
        'UPDATE m2_evidencia.lotes SET acuse = $2::jsonb WHERE id_lote = $1',
        [lote.idLote, JSON.stringify(acuse)],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
