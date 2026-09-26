# Experimentos de fallos F1-F4

Esta carpeta documenta el análisis T57 de los experimentos ejecutados en el laboratorio Minikube de NEXO. El objetivo no es demostrar que el sistema sea infalible, sino verificar invariantes de seguridad, degradación esperada y capacidad de recuperación con evidencia reproducible.

## Método

Cada corrida siguió el mismo ciclo:

1. `nexo-chaos validate` y `nexo-chaos plan` sobre `chaos/experiments/<exp>/experiment.yaml`.
2. Carga nominal con lectores emulados mediante `deploy/scripts/load.mjs`: ~5,5 intentos/s, ~3,5 válidos/s, 20 lectores.
3. `nexo-chaos run <yaml> --confirm`, con una sola perturbación activa.
4. Restauración automática/manual con `nexo-chaos restore` y registro `nexo-chaos-run.json`.
5. Recolección con `chaos/scripts/evidencias.ts`: métricas, logs, alertas, capturas, estado del clúster y cruces de integridad.
6. Consultas SQL de integridad: `chaos/sql/integridad-d1.sql` y `chaos/sql/integridad-d2.sql`.

Los conteos de D1/D2 en `integridad.json` son acumulados del evento desde el último `reset.mjs`: entre F1 y F2 se reinició el laboratorio, y F2, F3 y F4 comparten evento, así que sus totales crecen de una corrida a otra. Lo que se evalúa es que duplicados, pérdidas y pendientes sigan en cero.

La escala de resultado es la de T2 §11.3: **aprobada**, **aprobada con degradación prevista**, **fallida**, **abortada por seguridad** o **no concluyente**.

## Entorno

- Kubernetes local en Minikube, un nodo, manifiestos Kustomize.
- Namespaces: `nexo-venue`, `nexo-central`, `nexo-external`, `nexo-observability`, `nexo-chaos`.
- D1 y D2: PostgreSQL 16 en StatefulSets separados.
- Observabilidad: OpenTelemetry Collector con cola `file_storage` hacia `grafana/otel-lgtm` local.
- F1 usa Toxiproxy en el enlace C2 -> C4.
- Datos sintéticos; un evento de laboratorio.

## Resumen

| Experimento | Mapeo T2 §11.3 | Resultado | Cifras clave | Análisis |
|---|---|---|---|---|
| F1 RED-01 | EXP 01, recortado a C2 -> C4 por 5 min según Taller 3 | Aprobada | N2 100 %; T1 C2 p95 ~24 ms; 1410 pendientes al restaurar; 100 % drenado en 15 s; 0 pérdidas/duplicados | [f1-red-01.md](f1-red-01.md) |
| F2 SER-06 | EXP 06, salida de observabilidad | Aprobada con degradación prevista | Validación e integridad intactas; cola 185 batches/señal (<2 % de 10000) y drenaje ~45 s; ~1 min de telemetría no visible; alerta no aplicable porque Grafana cayó con LGTM | [f2-ser-06.md](f2-ser-06.md) |
| F3 BD-01 | EXP 05, variante D1 indisponible, no llenado de disco | Aprobada con degradación prevista | 0 aceptaciones sin D1 durable; 666 timeouts del lector; reconexión ~21 s; 0 pérdidas/duplicados | [f3-bd-01.md](f3-bd-01.md) |
| F4 REC-01 | Sin fila directa en T2; valida degradación T1/A6 bajo restricción de recursos | No concluyente | 100m fue leve salvo cold start; durante p95 lector 65 ms y 99,06 % <=300 ms; 29 timeouts en ventana; A6 no disparó; 0 pérdidas/duplicados | [f4-rec-01.md](f4-rec-01.md) |

## Amenazas comunes a la validez

- Otro `docker compose` compartido (`nexo-dev`) corrió de ~04:34 a ~05:34Z y solapó F1 repetida y F2. Las latencias no fueron anómalas; se conserva como contaminación, no como invalidación.
- A8 (`punto sin comunicación >60 s`) se dispara al iniciar/detener carga: ruido conocido, no atribuible a los fallos.
- La prueba es de nodo único; no cubre particiones entre autoridades ni promoción de réplica.
- La carga consume una bolsa finita de boletas válidas por zona. En F1 el agotamiento provocó fallo del Job y ausencia de reporte de carga.
- Las alertas viven en `otel-lgtm`; cuando se apaga ese backend no hay motor externo que alerte pérdida de visibilidad.
- Las métricas derivadas de C2 no observan solicitudes que nunca llegan a decisión cuando D1 está caído; el lector es evidencia independiente necesaria.

## Enlaces

- Hallazgos transversales: [hallazgos.md](hallazgos.md)
- Definiciones ejecutables: [../../chaos/experiments](../../chaos/experiments)
- Evidencia cruda: [../../chaos/evidence](../../chaos/evidence)
- CLI y procedimiento: [../../chaos/README.md](../../chaos/README.md)

