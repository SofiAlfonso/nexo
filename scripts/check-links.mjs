#!/usr/bin/env node
// Verifica enlaces relativos de Markdown (archivo y ancla) sin dependencias.
// Uso: node scripts/check-links.mjs [--code-paths] <archivo.md|carpeta>...
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const codePaths = args.includes('--code-paths');
const objetivos = args.filter((a) => !a.startsWith('--'));
if (objetivos.length === 0) objetivos.push('docs/informe');

const raiz = resolve(import.meta.dirname, '..');
const PREFIJOS_REPO = ['src/', 'tests/', 'docs/', 'deploy/', 'observability/', 'chaos/', 'config/', 'scripts/', '.github/'];

function archivosMd(ruta) {
  const abs = resolve(ruta);
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { recursive: true })
    .map((r) => join(abs, r))
    .filter((f) => extname(f) === '.md' && statSync(f).isFile());
}

function sinCodigo(texto) {
  return texto.replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '));
}

function slug(titulo) {
  return titulo
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

const cacheAnclas = new Map();
function anclas(archivo) {
  if (!cacheAnclas.has(archivo)) {
    const vistos = new Map();
    const set = new Set();
    for (const linea of sinCodigo(readFileSync(archivo, 'utf8')).split('\n')) {
      const m = /^#{1,6}\s+(.*)$/.exec(linea);
      if (!m) continue;
      const base = slug(m[1]);
      const n = vistos.get(base) ?? 0;
      set.add(n ? `${base}-${n}` : base);
      vistos.set(base, n + 1);
    }
    cacheAnclas.set(archivo, set);
  }
  return cacheAnclas.get(archivo);
}

const errores = [];
let revisados = 0;
for (const objetivo of objetivos) {
  for (const archivo of archivosMd(objetivo)) {
    const texto = sinCodigo(readFileSync(archivo, 'utf8'));
    const lineas = texto.split('\n');
    lineas.forEach((linea, i) => {
      const donde = `${relative(raiz, archivo)}:${i + 1}`;
      for (const m of linea.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        const destino = m[1];
        if (/^[a-z][a-z0-9+.-]*:/i.test(destino)) continue;
        revisados++;
        const [ruta, ancla] = destino.split('#');
        const abs = ruta ? resolve(dirname(archivo), decodeURI(ruta)) : archivo;
        if (!existsSync(abs)) {
          errores.push(`${donde}: no existe ${destino}`);
          continue;
        }
        if (ancla && extname(abs) === '.md' && !anclas(abs).has(decodeURIComponent(ancla).toLowerCase())) {
          errores.push(`${donde}: ancla inexistente ${destino}`);
        }
      }
      if (!codePaths) return;
      for (const m of linea.matchAll(/`([^`\s]+)`/g)) {
        const ruta = m[1].replace(/[.,;:]$/, '');
        if (!PREFIJOS_REPO.some((p) => ruta.startsWith(p)) || /[{}<>*]/.test(ruta)) continue;
        revisados++;
        if (!existsSync(join(raiz, ruta))) errores.push(`${donde}: ruta citada inexistente ${ruta}`);
      }
    });
  }
}

for (const e of errores) console.error(e);
console.log(`${revisados} referencias revisadas, ${errores.length} rotas.`);
process.exit(errores.length ? 1 : 0);
