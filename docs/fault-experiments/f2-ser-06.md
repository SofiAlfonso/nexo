# F2 SER-06 — salida de observabilidad

## Hipótesis

La caída del backend de observabilidad no bloquea validaciones ni auditoría. El Collector conserva telemetría en cola persistente y la drena al restaurar. Mapea a T2 EXP 06.

## Perturbación

- Método aprobado: escalar `deployment/nexo-otel-lgtm` a 0; el Collector permanece activo con cola `file_storage`.
- Ventana UTC: 2026-09-26 05:12:11.240 -> 05:27:11.518.
- Run record: `dd9f9d11-f4dd-493c-9c40-a7981f8ab529`.
- Duración: 900 s.

## Carga

Carga nominal 1380 s. El archivo de evidencia registra inicio 05:08:45.610Z y fin 05:31:45.562Z; la bitácora operacional la describió como iniciada alrededor de 05:08:42Z. Se usó `--libres-por-zona 1500` para evitar agotamiento.

## Métricas

| Métrica | Antes | Durante | Después |
|---|---:|---:|---:|
| Lector p95 | 35,2 ms | 35,2 ms | 39,0 ms |
| Lector <=300 ms | 99,90 % | 99,81 % | 99,45 % |
| Timeouts lector | 0 | 11 | 4 |
| N2 C2 | s/d en resumen | 100 % | 100 % |
| T1 p95 C2 | s/d en resumen | 27,89 ms media | 26,78 ms media |
| Outbox pendiente | s/d | 0 | 0 |
| Cola Collector | 0 | hasta 185 batches | 0 a ~68 s de restaurar |

La cola fue medida por una sonda al puerto `:8888` del Collector cada 15 s. `sent_*` quedó congelado durante la caída y volvió a crecer tras la restauración.

## Recuperación

La cola alcanzó 185 batches de métricas y 184 de trazas; con capacidad configurada de 10000 batches es <2 %. El máximo se midió a las 05:27:33Z, 22 s después de restaurar, mientras LGTM arrancaba; drenó a 0 a las 05:28:19Z, ~46 s después del máximo y ~68 s después de restaurar. Prometheus recuperó datos de 05:13-05:27 por replay de la cola; quedó ~1 min no visible (05:12-05:13), probablemente enviado mientras LGTM terminaba.

## Integridad

- Carga: 7590 intentos, 15 timeouts del cliente.
- D1: 7591 decisiones (incluye 1 semilla), 5742 aceptados, 1849 rechazados.
- D2: 7591 decisiones, 5742 admisiones.
- Duplicados: 0.
- Pérdidas D1/D2: 0.
- Drenado E1: 100 %.

## Alertas

No podía disparar una alerta de observabilidad porque Grafana, Prometheus y el motor de alertas estaban dentro de `nexo-otel-lgtm`, que fue apagado. Además, el hallazgo posterior mostró que A13/A14 leían series `otelcol_*` del Collector interno de LGTM y A14 usaba nombres incorrectos. PR #34 corrigió el scraping del Collector propio; la pérdida del backend requiere un dead-man's switch externo.

## Resultado

**Aprobada con degradación prevista.** Validación, integridad y cola cumplen T2 EXP 06 y Taller 3 §5/T52. El criterio de alerta no se cumple por límite de diseño del laboratorio: no hay motor externo cuando LGTM está abajo. La pérdida de ~1 min de visibilidad es degradación de observabilidad, no de decisión ni auditoría.

## Aprendizaje

- La observabilidad no participa en la decisión ni en la auditoría; D1/D2 conservaron evidencia.
- La cola persistente funcionó, pero el backend de alertas debe ser externo al componente que se quiere vigilar.
- A13 no puede disparar con 185/10000 batches y A14 no dispara con reintento infinito si no hay descarte.
- El burst de 15 timeouts podría estar influido por la contaminación del Docker compartido; no se repitió porque T1 global no fue anómala.

## Evidencia

- [integridad.json](../../chaos/evidence/ser-06-observability-outage/integridad.json)
- [metricas-resumen.json](../../chaos/evidence/ser-06-observability-outage/metricas-resumen.json)
- [lector-por-fase.txt](../../chaos/evidence/ser-06-observability-outage/lector-por-fase.txt)
- [collector-cola.jsonl](../../chaos/evidence/ser-06-observability-outage/collector-cola.jsonl)
- [carga-resumen.json](../../chaos/evidence/ser-06-observability-outage/carga-resumen.json)
- [nexo-chaos-run.json](../../chaos/evidence/ser-06-observability-outage/nexo-chaos-run.json)
- [alertas-estado.json](../../chaos/evidence/ser-06-observability-outage/alertas-estado.json)
- [manifiesto.json](../../chaos/evidence/ser-06-observability-outage/manifiesto.json)
- Snapshot previo: [antes-de-la-caida](../../chaos/evidence/ser-06-observability-outage/antes-de-la-caida/)
- Capturas: [n2-disponibilidad.png](../../chaos/evidence/ser-06-observability-outage/capturas/n2-disponibilidad.png), [t1-p95.png](../../chaos/evidence/ser-06-observability-outage/capturas/t1-p95.png), [t1-pct-300ms.png](../../chaos/evidence/ser-06-observability-outage/capturas/t1-pct-300ms.png), [t3-errores.png](../../chaos/evidence/ser-06-observability-outage/capturas/t3-errores.png)

