import type pg from 'pg';
import type { CambioPermiso, PaquetePermisos } from '@nexo/shared/contracts';

export interface ResultadoInstalacion {
  resultado: 'instalado' | 'sin-cambios' | 'repetido' | 'hueco' | 'retroceso';
  versionAnterior: number;
  versionInstalada: number;
  cambiosAplicados: number;
  anulaciones: number;
}

type Alcance = { recibidoEn: Date; clienteId: string; boleteriaId: string; recintoId: string };

// Cada sentencia modifica referencias distintas. Al repetirse una referencia, empieza otro
// lote: PostgreSQL no permite afectar dos veces la misma fila en un único INSERT ON CONFLICT.
async function aplicarCambios(cliente: pg.PoolClient, eventoId: string, cambios: CambioPermiso[], recibidoEn: Date) {
  let cambiosAplicados = 0;
  let anulaciones = 0;
  const ordenados = [...cambios].sort((a, b) => a.version - b.version);
  for (let indice = 0; indice < ordenados.length;) {
    const tipo = ordenados[indice]!.tipo;
    const lote: CambioPermiso[] = [];
    const referencias = new Set<string>();
    while (indice < ordenados.length && ordenados[indice]!.tipo === tipo && lote.length < 4_000
      && !referencias.has(ordenados[indice]!.referencia)) {
      const cambio = ordenados[indice]!;
      lote.push(cambio);
      referencias.add(cambio.referencia);
      indice++;
    }
    const refs = lote.map(c => c.referencia);
    const versiones = lote.map(c => c.version);
    let cantidad = 0;
    if (tipo === 'alta') {
      const zonas = lote.map(c => c.tipo === 'alta' ? c.zona : '');
      const r = await cliente.query(
        `INSERT INTO boleta (evento_id, referencia, codigo, zona, version)
         SELECT $1, referencia, referencia, zona, version
           FROM unnest($2::text[], $3::text[], $4::bigint[]) AS datos(referencia, zona, version)
         ON CONFLICT (evento_id, referencia) DO UPDATE
           SET zona = EXCLUDED.zona, version = EXCLUDED.version
           WHERE boleta.version < EXCLUDED.version`,
        [eventoId, refs, zonas, versiones],
      );
      cantidad = r.rowCount ?? 0;
    } else if (tipo === 'anulacion') {
      const instantes = lote.map(c => c.tipo === 'anulacion' ? c.anuladaEn : '');
      const r = await cliente.query(
        `UPDATE boleta b SET anulada_en = datos.anulada_en, anulacion_recibida_en = $5, version = datos.version
           FROM unnest($2::text[], $3::timestamptz[], $4::bigint[]) AS datos(referencia, anulada_en, version)
          WHERE b.evento_id = $1 AND b.referencia = datos.referencia AND b.anulada_en IS NULL`,
        [eventoId, refs, instantes, versiones, recibidoEn],
      );
      cantidad = r.rowCount ?? 0;
      anulaciones += cantidad;
    } else {
      const zonas = lote.map(c => c.tipo === 'cambio-zona' ? c.zona : '');
      const r = await cliente.query(
        `UPDATE boleta b SET zona = datos.zona, version = datos.version
           FROM unnest($2::text[], $3::text[], $4::bigint[]) AS datos(referencia, zona, version)
          WHERE b.evento_id = $1 AND b.referencia = datos.referencia AND b.version < datos.version`,
        [eventoId, refs, zonas, versiones],
      );
      cantidad = r.rowCount ?? 0;
    }
    cambiosAplicados += cantidad;
  }
  return { cambiosAplicados, anulaciones };
}

export async function instalarPaquete(pool: pg.Pool, paquete: PaquetePermisos, alcance: Alcance): Promise<ResultadoInstalacion> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // Serializa también el primer paquete, cuando aún no existe una fila de evento que bloquear.
    await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [paquete.eventoId]);
    const evento = await cliente.query<{ version_permisos: string }>(
      'SELECT version_permisos FROM evento WHERE evento_id = $1 FOR UPDATE', [paquete.eventoId],
    );
    const instalada = Number(evento.rows[0]?.version_permisos ?? 0);
    const resultado = (estado: ResultadoInstalacion['resultado'], versionInstalada = instalada,
      cambiosAplicados = 0, anulaciones = 0): ResultadoInstalacion => ({
      resultado: estado, versionAnterior: instalada, versionInstalada, cambiosAplicados, anulaciones,
    });
    if (paquete.hastaVersion < instalada) {
      await cliente.query('ROLLBACK');
      return resultado('retroceso');
    }
    if (paquete.desdeVersion !== instalada) {
      const repetida = paquete.hastaVersion === instalada && (await cliente.query(
        `SELECT 1 FROM permiso_version WHERE evento_id = $1 AND version = $2
           AND paquete->'firma'->>'valor' = $3`,
        [paquete.eventoId, instalada, paquete.firma.valor],
      )).rowCount === 1;
      await cliente.query('ROLLBACK');
      return resultado(repetida ? 'repetido' : 'hueco');
    }
    if (!evento.rowCount) {
      await cliente.query(
        `INSERT INTO evento (evento_id, cliente_id, boleteria_id, recinto_id, estado,
                             apertura_en, cierre_en, version_permisos, version_politicas)
         VALUES ($1, $2, $3, $4, 'abierto', $5, $6, 0, 0)`,
        [paquete.eventoId, alcance.clienteId, alcance.boleteriaId, alcance.recintoId,
          paquete.ventana.aperturaEn, paquete.ventana.cierreEn],
      );
    }
    await cliente.query(
      `UPDATE evento SET version_permisos = $2, version_politicas = $3,
        reingreso_permitido = $4, apertura_en = $5, cierre_en = $6, permisos_recibidos_en = $7
       WHERE evento_id = $1`,
      [paquete.eventoId, paquete.hastaVersion, paquete.politicas.version, paquete.politicas.reingresoPermitido,
        paquete.ventana.aperturaEn, paquete.ventana.cierreEn, alcance.recibidoEn],
    );
    if (paquete.hastaVersion > instalada) {
      await cliente.query(
        `INSERT INTO permiso_version (evento_id, version, desde_version, tipo, paquete, emitido_en,
                                      vigente_hasta, apertura_en, cierre_en, version_politicas)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [paquete.eventoId, paquete.hastaVersion, paquete.desdeVersion, paquete.tipo, JSON.stringify(paquete),
          paquete.emitidoEn, paquete.vigenteHasta, paquete.ventana.aperturaEn, paquete.ventana.cierreEn, paquete.politicas.version],
      );
    }
    for (const punto of paquete.puntos) {
      await cliente.query(
        `INSERT INTO punto (evento_id, punto_id, zonas) VALUES ($1,$2,$3)
         ON CONFLICT (evento_id, punto_id) DO UPDATE SET zonas = EXCLUDED.zonas
         WHERE punto.zonas IS DISTINCT FROM EXCLUDED.zonas`,
        [paquete.eventoId, punto.puntoId, punto.zonas],
      );
    }
    const { cambiosAplicados, anulaciones } = await aplicarCambios(cliente, paquete.eventoId, paquete.cambios, alcance.recibidoEn);
    await cliente.query('COMMIT');
    return resultado(paquete.hastaVersion > instalada ? 'instalado' : 'sin-cambios',
      paquete.hastaVersion, cambiosAplicados, anulaciones);
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cliente.release();
  }
}
