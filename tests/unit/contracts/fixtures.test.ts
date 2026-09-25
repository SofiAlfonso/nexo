import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import * as contratos from '../../../src/shared/contracts/index.ts';

// Cada fixture se llama `<Esquema>.<caso>.json` y se valida con el esquema exportado de ese nombre.
// Los de `invalid/` deben fallar.
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures');

function listar(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listar(p) : e.name.endsWith('.json') ? [p] : [];
  });
}

function esquemaDe(archivo: string): z.ZodType {
  const nombre = path.basename(archivo).split('.')[0] as string;
  const esquema = (contratos as Record<string, unknown>)[nombre];
  if (!esquema || typeof (esquema as z.ZodType).safeParse !== 'function') {
    throw new Error(`No existe el esquema ${nombre} para ${archivo}`);
  }
  return esquema as z.ZodType;
}

const archivos = listar(raiz);
const validos = archivos.filter((a) => !a.includes(`${path.sep}invalid${path.sep}`));
const invalidos = archivos.filter((a) => a.includes(`${path.sep}invalid${path.sep}`));
const leer = (a: string): unknown => JSON.parse(readFileSync(a, 'utf8'));
const rel = (a: string) => path.relative(raiz, a).replaceAll('\\', '/');

describe('fixtures de contratos', () => {
  it('hay fixtures válidos e inválidos', () => {
    expect(validos.length).toBeGreaterThan(20);
    expect(invalidos.length).toBeGreaterThan(0);
  });

  it.each(validos.map((a) => [rel(a), a]))('%s cumple su esquema', (_n, archivo) => {
    const r = esquemaDe(archivo).safeParse(leer(archivo));
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it.each(invalidos.map((a) => [rel(a), a]))('%s es rechazado', (_n, archivo) => {
    expect(esquemaDe(archivo).safeParse(leer(archivo)).success).toBe(false);
  });

  it('cada respuesta y cuerpo del catálogo tiene al menos un fixture', () => {
    const nombres = new Set(validos.map((a) => path.basename(a).split('.')[0]));
    const exportados = Object.entries(contratos);
    const faltan: string[] = [];
    for (const [ruta, def] of Object.entries(contratos.RUTAS)) {
      for (const clave of ['cuerpo', 'respuesta'] as const) {
        const esquema = (def as Record<string, unknown>)[clave];
        if (!esquema) continue;
        const nombre = exportados.find(([, v]) => v === esquema)?.[0];
        if (!nombre || !nombres.has(nombre)) faltan.push(`${ruta}.${clave} (${nombre ?? '?'})`);
      }
    }
    expect(faltan).toEqual([]);
  });
});

describe('reglas de los contratos', () => {
  const lote = leer(path.join(raiz, 'e1/LoteEvidencia.mixto.json')) as contratos.LoteEvidencia;

  it('E1 acepta hasta 100 registros y rechaza 101', () => {
    const registros = Array.from({ length: 101 }, (_, i) => ({
      ...lote.registros[0],
      idOrigen: `LX-2210-0149:${String(i).padStart(9, '0')}`,
    }));
    expect(contratos.LoteEvidencia.safeParse({ ...lote, registros: registros.slice(0, 100) }).success).toBe(true);
    expect(contratos.LoteEvidencia.safeParse({ ...lote, registros }).success).toBe(false);
    expect(contratos.MAX_REGISTROS_LOTE).toBe(100);
  });

  it('V1 usa "ingreso" como propósito por defecto', () => {
    const { proposito: _p, ...sin } = leer(path.join(raiz, 'v1/SolicitudValidacion.ingreso.json')) as Record<string, unknown>;
    expect(contratos.SolicitudValidacion.parse(sin).proposito).toBe('ingreso');
  });

  it('P2 convierte desdeVersion de la query a número', () => {
    expect(contratos.ConsultaPermisos.parse({ eventoId: 'EVT-2026-02', desdeVersion: '0' }).desdeVersion).toBe(0);
    expect(contratos.ConsultaPermisos.safeParse({ eventoId: 'EVT-2026-02', desdeVersion: '-1' }).success).toBe(false);
  });

  it('motivos, roles y tipos de incidente coinciden con el prototipo', () => {
    expect(Object.keys(contratos.MOTIVO_TEXTO)).toHaveLength(11);
    expect(contratos.Motivo.options).toEqual(Object.keys(contratos.MOTIVO_TEXTO));
    expect(Object.values(contratos.ROL_TEXTO)).toEqual([
      'Supervisor del operador',
      'Líder técnico',
      'Logística de puerta',
      'Responsable de cierre',
      'Líder comercial y financiero',
    ]);
    expect(contratos.EstadoPunto.options).toEqual(['en-linea', 'sin-comunicacion', 'averiado', 'en-pausa', 'sin-abrir']);
    expect(contratos.TipoIncidente.options).toHaveLength(7);
  });

  it('las rutas del catálogo son únicas', () => {
    const claves = Object.values(contratos.RUTAS).map((r) => `${r.metodo} ${r.ruta}`);
    expect(new Set(claves).size).toBe(claves.length);
  });
});
