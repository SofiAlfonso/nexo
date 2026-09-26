# Evidencias de experimentos (T56)

Cada experimento F1–F4 tiene una carpeta con la misma estructura. La genera
[`chaos/scripts/evidencias.ts`](../scripts/evidencias.ts) cuando la carga ya
terminó (si corre durante la carga, la comparación D1/D2 compite con los
registros en vuelo). El análisis está en
[`docs/fault-experiments/`](../../docs/fault-experiments/README.md).

| Carpeta | Experimento | Registro de nexo-chaos |
|---|---|---|
| [`red-01-central-connection/`](red-01-central-connection/) | F1 RED-01, corrida válida | `64c7b936-…` |
| [`red-01-corrida1-gauges-congelados/`](red-01-corrida1-gauges-congelados/) | F1 RED-01, corrida 1 (reveló el bug de PR #31) | `96aab326-…` |
| [`ser-06-observability-outage/`](ser-06-observability-outage/) | F2 SER-06 | `dd9f9d11-…` |
| [`bd-01-local-persistence/`](bd-01-local-persistence/) | F3 BD-01 | `df36a9be-…` |
| [`rec-01-coordinator-cpu/`](rec-01-coordinator-cpu/) | F4 REC-01 | `f56b65df-…` |
| [`hallazgo-e1-lote-envenenado/`](hallazgo-e1-lote-envenenado/) | Hallazgo previo a F1 (PR #28) | — |

## Contenido de cada carpeta

| Archivo | Qué contiene |
|---|---|
| `manifiesto.json` | Ventanas en UTC (inicio de carga, perturbación, restauración, fin) y la lista de archivos. |
| `nexo-chaos-run.json` | Registro de la ejecución de `nexo-chaos run --confirm`: acciones, restauración y estado final. |
| `integridad.json` | Resultado de [`chaos/sql/integridad-d1.sql`](../sql/integridad-d1.sql) e [`integridad-d2.sql`](../sql/integridad-d2.sql): consumos duplicados, outbox pendiente, decisiones de D1 ausentes en D2 y viceversa, porcentaje drenado. |
| `metricas.json` / `metricas-resumen.json` | Series de Prometheus (N1–N3, T1–T3, cola del Collector) y su mínimo, máximo y media por fase (antes, durante, después). |
| `trazas.json` | Resumen de trazas de Tempo en la ventana. |
| `logs/` | Avisos y errores de C2 y C4, y el log de Toxiproxy. |
| `alertas.log` / `alertas-estado.json` | Notificaciones recibidas por el webhook y estado de las reglas de Grafana al recolectar. |
| `cluster-estado.txt` | Pods, réplicas y proxies tras la restauración. |
| `carga-resumen.json` | Informe del generador de carga, sin los registros individuales. |
| `capturas/` | Paneles de Grafana (`d-solo`, UTC) de la ventana del experimento. |
| `lector-por-fase.txt` | Latencia y resultados del lector emulado por fase, calculados desde el log de la carga (solo F2–F4). |

Archivos adicionales:

- F2: `collector-cola.jsonl`, la cola del Collector sondeada cada 15 s en `:8888` mientras `otel-lgtm` estaba caído. `antes-de-la-caida/` guarda la instantánea previa a la caída.
- F1 corrida 1: el JSON original `96aab326-….json`.

Los registros de `nexo-chaos` que la herramienta deja en la raíz de esta
carpeta se copian a su experimento como `nexo-chaos-run.json`. Los códigos de
boleta son sintéticos, y los informes de carga no incluyen registros
individuales.
