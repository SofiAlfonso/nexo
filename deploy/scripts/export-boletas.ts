import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from 'pg';
import { createD1Pool } from '../../src/local-coordinator/infrastructure/db/index.ts';

type Boleta = {
  codigo: string;
  zona: string;
  estado: 'vigente' | 'anulada';
  usada: boolean;
};

type Lector = {
  lectorId: string;
  puntoId: string;
  eventoId: string;
  zonas: string[];
};

export async function exportBoletas(pool: Pool, destination: string): Promise<void> {
  const events = await pool.query<{ evento_id: string }>(`
    SELECT evento_id FROM evento
    WHERE estado = 'abierto' AND now() BETWEEN apertura_en AND cierre_en
  `);
  if (events.rowCount !== 1) {
    throw new Error(`Expected one active event in D1, found ${events.rowCount}`);
  }
  const eventoId = events.rows[0]!.evento_id;
  const tickets = await pool.query<Boleta>(`
    SELECT b.codigo, b.zona,
      CASE WHEN b.anulada_en IS NULL THEN 'vigente' ELSE 'anulada' END AS estado,
      c.id_origen IS NOT NULL AS usada
    FROM boleta b
    LEFT JOIN consumo c ON c.cliente_id = b.cliente_id AND c.evento_id = b.evento_id
      AND c.boleteria_id = b.boleteria_id AND c.referencia = b.referencia
      AND c.proposito = 'PRIMER_INGRESO'
    WHERE b.evento_id = $1
    ORDER BY b.codigo
  `, [eventoId]);
  const readers = await pool.query<Lector>(`
    SELECT l.lector_id AS "lectorId", l.punto_id AS "puntoId",
      l.evento_id AS "eventoId", p.zonas
    FROM lector l JOIN punto p ON p.evento_id = l.evento_id AND p.punto_id = l.punto_id
    WHERE l.evento_id = $1 AND l.habilitado AND NOT l.revocado AND p.habilitado
    ORDER BY l.punto_id, l.lector_id
  `, [eventoId]);
  if (!tickets.rowCount || !readers.rowCount) {
    throw new Error(`Active event ${eventoId} has no tickets or enabled readers`);
  }

  const boletas = tickets.rows;
  const ejemplos = [
    { caso: 'valida', codigo: 'TA-8800-0000', puntoId: 'P-01', zonaSolicitada: 'Norte', decision: 'aceptado' },
    { caso: 'anulada', codigo: 'TA-8800-0001', puntoId: 'P-01', zonaSolicitada: 'Norte', decision: 'rechazado' },
    { caso: 'usada', codigo: 'TA-8800-0002', puntoId: 'P-01', zonaSolicitada: 'Norte', decision: 'rechazado' },
    { caso: 'otra-zona', codigo: 'TA-8804-0980', puntoId: 'P-01', zonaSolicitada: 'Norte', decision: 'rechazado' },
    { caso: 'desconocida', codigo: 'TA-DESCONOCIDA', puntoId: 'P-01', zonaSolicitada: 'Norte', decision: 'rechazado' },
    { caso: 'copia-concurrente', codigo: 'TA-8800-0003', puntos: ['P-01', 'P-02'], zonaSolicitada: 'Norte',
      aceptacionesMaximas: 1 },
  ];
  const expected = new Map(boletas.map((boleta) => [boleta.codigo, boleta]));
  for (const { caso, codigo } of ejemplos) {
    if (caso === 'desconocida') {
      if (expected.has(codigo)) throw new Error(`Unknown-code fixture ${codigo} exists in D1`);
    } else if (!expected.has(codigo)) {
      throw new Error(`Missing ${caso} fixture ${codigo} in D1`);
    }
  }
  if (expected.get('TA-8800-0000')?.estado !== 'vigente' || expected.get('TA-8800-0000')?.usada ||
      expected.get('TA-8800-0001')?.estado !== 'anulada' ||
      expected.get('TA-8800-0002')?.usada !== true ||
      expected.get('TA-8804-0980')?.zona !== 'Sur') {
    throw new Error('D1 ticket fixtures do not match the expected reader cases');
  }

  await writeFile(resolve(destination), JSON.stringify({
    eventos: [{ eventoId, boletas }],
    lectores: readers.rows,
    casos: ejemplos,
  }, null, 2) + '\n', { flag: 'w' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Usage: node --import tsx deploy/scripts/export-boletas.ts <output.json>');
  const pool = createD1Pool();
  try {
    await exportBoletas(pool, destination);
  } finally {
    await pool.end();
  }
}
