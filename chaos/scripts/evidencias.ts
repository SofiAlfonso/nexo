#!/usr/bin/env node
// Recolector de evidencias de F1–F4 (T56). Solo lectura sobre el clúster: consulta D1/D2 con los SQL de
// `chaos/sql/`, Prometheus y Tempo vía el proxy de Grafana, logs de C2/C4, alertas del receptor webhook
// y la configuración efectiva del Collector. Escribe todo en `chaos/evidence/<experimento>/`.
//
//   node chaos/scripts/evidencias.ts --experimento red-01-central-connection \
//     --desde 2026-09-26T04:30:00Z --hasta 2026-09-26T04:35:00Z --restaurado 2026-09-26T04:35:00Z \
//     [--inicio-carga ...] [--fin ...] [--corrida chaos/evidence/<uuid>.json] [--carga <log de load.mjs>]
//
// Requiere el port-forward de Grafana en GRAFANA_URL (por defecto http://127.0.0.1:3000, admin/admin).
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: a } = parseArgs({
  options: {
    experimento: { type: 'string' },
    desde: { type: 'string' },
    hasta: { type: 'string' },
    restaurado: { type: 'string' },
    'inicio-carga': { type: 'string' },
    fin: { type: 'string' },
    corrida: { type: 'string' },
    carga: { type: 'string' },
    evento: { type: 'string', default: 'EVT-2026-02' },
    paso: { type: 'string', default: '15' },
  },
});
if (!a.experimento || !a.desde || !a.hasta) {
  console.error('Uso: --experimento <id> --desde <ISO> --hasta <ISO> [--restaurado <ISO>] [--inicio-carga <ISO>] [--fin <ISO>]');
  process.exit(2);
}
const desde = new Date(a.desde);
const hasta = new Date(a.hasta);
const restaurado = new Date(a.restaurado ?? a.hasta);
const inicio = new Date(a['inicio-carga'] ?? desde.getTime() - 3 * 60_000);
const fin = new Date(a.fin ?? Date.now());
const salida = join(raiz, 'evidence', a.experimento);
const grafana = process.env.GRAFANA_URL ?? 'http://127.0.0.1:3000';
const auth = `Basic ${Buffer.from(process.env.GRAFANA_AUTH ?? 'admin:admin').toString('base64')}`;

function ejecutar(comando: string, args: string[], entrada?: string): Promise<string> {
  return new Promise((ok, falla) => {
    const hijo = spawn(comando, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    hijo.stdout.setEncoding('utf8').on('data', (c: string) => { out += c; });
    hijo.stderr.setEncoding('utf8').on('data', (c: string) => { err += c; });
    hijo.on('error', falla);
    hijo.on('close', (code) => (code === 0 ? ok(out) : falla(new Error(`${comando} ${args.join(' ')}: ${code} ${err}`))));
    hijo.stdin.end(entrada);
  });
}

async function psql(ns: string, pod: string, sql: string, vars: Record<string, string>): Promise<string[]> {
  const v = Object.entries(vars).flatMap(([k, val]) => ['-v', `${k}=${val}`]);
  const out = await ejecutar('kubectl', ['-n', ns, 'exec', '-i', pod, '--', 'sh', '-c',
    `psql -X -At -v ON_ERROR_STOP=1 ${v.map((x) => `'${x}'`).join(' ')} -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -`], sql);
  return out.split('\n').filter((l) => l.length > 0);
}

async function integridad() {
  const vars = { evento: a.evento!, desde: desde.toISOString(), hasta: hasta.toISOString(), restaurado: restaurado.toISOString() };
  const d1 = await psql('nexo-venue', 'nexo-d1-0', await readFile(join(raiz, 'sql', 'integridad-d1.sql'), 'utf8'), vars);
  const d2 = await psql('nexo-central', 'nexo-d2-0', await readFile(join(raiz, 'sql', 'integridad-d2.sql'), 'utf8'), { evento: a.evento! });
  const resumenD1 = JSON.parse(d1[0]!) as Record<string, unknown>;
  const resumenD2 = JSON.parse(d2[0]!) as Record<string, unknown>;
  const acusadas = new Set<string>();
  const pendientes = new Set<string>();
  for (const l of d1.slice(1)) {
    const [id, estado] = l.split('\t');
    (estado === 'acusada' ? acusadas : pendientes).add(id!);
  }
  const enD2 = new Set(d2.slice(1));
  const perdidas = [...acusadas].filter((id) => !enD2.has(id));
  const sinOrigen = [...enD2].filter((id) => !acusadas.has(id) && !pendientes.has(id));
  const drenado = resumenD1.drenado as { pendientesAlRestaurar: number; acusadasEn5Min: number };
  return {
    evento: a.evento,
    ventana: { desde: desde.toISOString(), hasta: hasta.toISOString(), restaurado: restaurado.toISOString() },
    d1: resumenD1,
    d2: resumenD2,
    cruce: {
      decisionesD1: acusadas.size + pendientes.size,
      acusadasD1: acusadas.size,
      pendientesD1: pendientes.size,
      decisionesD2: enD2.size,
      // Acusadas por C4 pero ausentes en D2: evidencia perdida (objetivo 0).
      perdidas: perdidas.length,
      // En D2 sin fila en D1: duplicado o evidencia sin origen local (objetivo 0).
      sinOrigenEnD1: sinOrigen.length,
      muestrasPerdidas: perdidas.slice(0, 10),
      muestrasSinOrigen: sinOrigen.slice(0, 10),
      drenadoEn5MinPct: drenado.pendientesAlRestaurar === 0 ? 100
        : Math.round((drenado.acusadasEn5Min / drenado.pendientesAlRestaurar) * 10_000) / 100,
    },
  };
}

async function grafanaGet(ruta: string): Promise<unknown> {
  const r = await fetch(`${grafana}${ruta}`, { headers: { authorization: auth } });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status}`);
  return r.json();
}

const CONSULTAS: Record<string, string> = {
  'N1-admisiones-por-min': 'sum(rate(nexo_c2_validaciones_total{decision="aceptado",admision="true"}[1m])) * 60',
  'N1-validaciones-por-decision': 'sum(rate(nexo_c2_validaciones_total[1m])) by (decision)',
  'N2-disponibilidad': '1 - (sum(rate(nexo_c2_validaciones_total{decision="sin-respuesta"}[1m])) or vector(0)) / sum(rate(nexo_c2_validaciones_total[1m]))',
  'N3-conflictos-decision': 'sum(increase(nexo_c4_lotes_evidencia_total{resultado="conflicto",tipo="decision"}[24h])) or vector(0)',
  'T1-p95-c2-ms': 'histogram_quantile(0.95, sum(rate(nexo_c2_validacion_duracion_ms_milliseconds_bucket[1m])) by (le))',
  'T1-p95-c1-ms': 'histogram_quantile(0.95, sum(rate(nexo_c1_validacion_duracion_ms_milliseconds_bucket[1m])) by (le))',
  'T1-pct-300ms-c2': 'sum(rate(nexo_c2_validacion_duracion_ms_milliseconds_bucket{le="300"}[1m])) / sum(rate(nexo_c2_validacion_duracion_ms_milliseconds_count[1m]))',
  'C1-resultados-por-decision': 'sum(rate(nexo_c1_resultados_total[1m])) by (decision)',
  'T2-outbox-pendientes': 'max(nexo_c2_outbox_pendientes)',
  'T2-outbox-edad-max-s': 'max(nexo_c2_outbox_edad_maxima_s)',
  'T2-c4-lotes-por-resultado': 'sum(rate(nexo_c4_lotes_evidencia_total[1m])) by (resultado, tipo)',
  'T2-c4-registros-por-min': 'sum(rate(nexo_c4_registros_evidencia_total[1m])) * 60',
  'T3-errores-c2': 'sum(rate(nexo_c2_errores_total[1m])) by (causa)',
  'C2-latidos-descartados': 'sum(increase(nexo_c2_e1_latidos_descartados_total[5m])) or vector(0)',
  'Collector-cola': 'max(otelcol_exporter_queue_size{k8s_pod_name=~"nexo-otel-collector-.*"}) by (exporter, data_type)',
  'Collector-capacidad': 'max(otelcol_exporter_queue_capacity{k8s_pod_name=~"nexo-otel-collector-.*"}) by (exporter, data_type)',
  'Collector-fallos-envio': 'sum(rate({__name__=~"otelcol_exporter_(send|enqueue)_failed_.+_total",k8s_pod_name=~"nexo-otel-collector-.*"}[1m])) or vector(0)',
};

async function metricas() {
  const s = Math.floor(inicio.getTime() / 1000);
  const e = Math.ceil(fin.getTime() / 1000);
  const r: Record<string, unknown> = {};
  for (const [nombre, q] of Object.entries(CONSULTAS)) {
    try {
      const datos = await grafanaGet(`/api/datasources/proxy/uid/prometheus/api/v1/query_range?query=${encodeURIComponent(q)}&start=${s}&end=${e}&step=${a.paso}`) as {
        data: { result: { metric: Record<string, string>; values: [number, string][] }[] };
      };
      r[nombre] = { consulta: q, series: datos.data.result.map((x) => ({ etiquetas: x.metric, valores: x.values.map(([t, v]) => [new Date(t * 1000).toISOString(), Number(v)]) })) };
    } catch (error) {
      r[nombre] = { consulta: q, error: String(error) };
    }
  }
  return r;
}

type SerieMetrica = { etiquetas: Record<string, string>; valores: [string, number][] };

// Mín./máx./media por fase (antes de la perturbación, durante, recuperación) para el análisis de T57.
function resumirMetricas(datos: Record<string, unknown>) {
  const fases: Record<string, [number, number]> = {
    antes: [inicio.getTime(), desde.getTime()],
    durante: [desde.getTime(), restaurado.getTime()],
    despues: [restaurado.getTime(), fin.getTime()],
  };
  const r: Record<string, unknown[]> = {};
  for (const [nombre, entrada] of Object.entries(datos)) {
    const series = (entrada as { series?: SerieMetrica[] }).series ?? [];
    r[nombre] = series.map((serie) => ({
      etiquetas: serie.etiquetas,
      ...Object.fromEntries(Object.entries(fases).map(([fase, [d, h]]) => {
        const v = serie.valores.filter(([t, x]) => Date.parse(t) >= d && Date.parse(t) <= h && Number.isFinite(x)).map(([, x]) => x);
        if (!v.length) return [fase, null];
        const redondear = (x: number) => Math.round(x * 100) / 100;
        return [fase, { min: redondear(Math.min(...v)), max: redondear(Math.max(...v)), media: redondear(v.reduce((s, x) => s + x, 0) / v.length), n: v.length }];
      })),
    }));
  }
  return r;
}

async function trazas() {
  const s = Math.floor(desde.getTime() / 1000) - 60;
  const e = Math.ceil(restaurado.getTime() / 1000) + 120;
  const r: Record<string, unknown> = {};
  for (const servicio of ['nexo-local-coordinator', 'nexo-central-core', 'nexo-reader-client']) {
    try {
      r[servicio] = await grafanaGet(`/api/datasources/proxy/uid/tempo/api/search?tags=${encodeURIComponent(`service.name=${servicio}`)}&start=${s}&end=${e}&limit=20`);
    } catch (error) {
      r[servicio] = { error: String(error) };
    }
  }
  return r;
}

async function logs(ns: string, objetivo: string): Promise<string> {
  try {
    const out = await ejecutar('kubectl', ['-n', ns, 'logs', objetivo, '--all-containers', `--since-time=${inicio.toISOString()}`, '--timestamps']);
    // Solo avisos y errores de pino (nivel ≥ 40) y líneas no JSON; el resto es volumen sin valor de evidencia.
    return out.split('\n').filter((l) => !/"level":(10|20|30),/.test(l) && l.trim()).join('\n');
  } catch (error) {
    return `# no disponible: ${String(error)}`;
  }
}

async function main() {
  await mkdir(join(salida, 'logs'), { recursive: true });
  const archivos: string[] = [];
  const escribir = async (nombre: string, contenido: string) => { await writeFile(join(salida, nombre), contenido); archivos.push(nombre); };

  await escribir('integridad.json', `${JSON.stringify(await integridad(), null, 2)}\n`);
  const datosMetricas = await metricas();
  await escribir('metricas.json', `${JSON.stringify(datosMetricas, null, 2)}\n`);
  await escribir('metricas-resumen.json', `${JSON.stringify(resumirMetricas(datosMetricas), null, 2)}\n`);
  await escribir('trazas.json', `${JSON.stringify(await trazas(), null, 2)}\n`);
  await escribir('logs/c2-avisos.log', await logs('nexo-venue', 'deploy/nexo-coordinator'));
  await escribir('logs/c4-avisos.log', await logs('nexo-central', 'deploy/nexo-central'));
  await escribir('logs/toxiproxy.log', await logs('nexo-venue', 'deploy/toxiproxy'));
  await escribir('alertas.log', await logs('nexo-observability', 'deploy/nexo-alert-webhook'));
  try {
    const reglas = await grafanaGet('/api/prometheus/grafana/api/v1/rules');
    await escribir('alertas-estado.json', `${JSON.stringify(reglas, null, 2)}\n`);
  } catch (error) {
    await escribir('alertas-estado.json', `${JSON.stringify({ error: String(error) })}\n`);
  }
  const pods = await Promise.all(['nexo-venue', 'nexo-central', 'nexo-observability'].map((ns) =>
    ejecutar('kubectl', ['-n', ns, 'get', 'pods,deploy,sts', '-o', 'wide']).catch((e: unknown) => String(e))));
  await escribir('cluster-estado.txt', pods.join('\n'));
  if (a.corrida) {
    await copyFile(resolve(a.corrida), join(salida, 'nexo-chaos-run.json'));
    archivos.push('nexo-chaos-run.json');
  }
  if (a.carga) {
    const texto = await readFile(resolve(a.carga), 'utf8');
    const inicioJson = texto.indexOf('{');
    try {
      const reporte = JSON.parse(texto.slice(inicioJson, texto.lastIndexOf('}') + 1)) as Record<string, unknown>;
      // El reporte completo trae códigos sintéticos de cada intento; en Git queda solo el resumen.
      delete reporte.registros;
      await escribir('carga-resumen.json', `${JSON.stringify(reporte, null, 2)}\n`);
    } catch {
      await escribir('carga-resumen.json', `${JSON.stringify({ error: 'reporte de carga no parseable' })}\n`);
    }
  }
  await escribir('manifiesto.json', `${JSON.stringify({
    experimento: a.experimento, generadoEn: new Date().toISOString(),
    ventana: { inicioCarga: inicio.toISOString(), desde: desde.toISOString(), hasta: hasta.toISOString(), restaurado: restaurado.toISOString(), fin: fin.toISOString() },
    archivos,
  }, null, 2)}\n`);
  console.log(`Evidencias en ${salida}: ${archivos.join(', ')}`);
}

await main();
