# Observabilidad

**Responsabilidad**: alojar la configuración de observabilidad de NEXO:
Collector de OpenTelemetry, dashboards y alertas versionados, el contrato
de telemetría y la telemetría sintética usada para pruebas.

**Qué no debe implementarse aquí**: datos reales de producción. Tampoco se
deben incluir referencias completas de boleto, QR, datos personales,
secretos, `trace_id` ni `span_id` como etiquetas métricas.

**Componente relacionado**: transversal, con OpenTelemetry instrumentando
C1–C5 y el Collector desplegado dentro de Minikube; exportación vía OTLP
hacia Grafana Cloud (métricas, logs y trazas, con W3C Trace Context y cola
persistente en el Collector).

**Decisiones pendientes**: catálogo definitivo de dashboards/alertas más
allá del alcance de T41/T42 (SLO/capacidad/costo, conciliación y cierre,
adopción del piloto — T2 §8.5) y umbrales finos de las alertas A2–A5,
A7, A9, A10, A12, A15–A20 (fuera del alcance de T42).

## Subcarpetas

- `collector/` — configuración del OpenTelemetry Collector.
- `dashboards/` — dashboards versionados (T41: operación del evento;
  sincronización y resiliencia), provisionados en `otel-lgtm` de Compose y
  del clúster.
- `alerts/` — reglas de alerta versionadas (T42: A1, A6, A8, A11, A13, A14)
  y el receptor local del punto de contacto webhook.
- `telemetry-contract/` — contrato de telemetría (nombres, tipos, etiquetas
  permitidas).
- `synthetic-telemetry/` — generadores/fixtures de telemetría sintética
  para pruebas.

## Objetivo de latencia vigente

Al menos el 95 % de las solicitudes de validación deben resolverse en un
máximo de 300 ms. Las solicitudes tardías, los errores y las solicitudes
sin respuesta permanecen en el denominador de este objetivo.

## Las seis métricas de T2 §3.2 (N1–N3, T1–T3)

Implementadas en C1/C2/C4 (T40) y visibles en los dashboards de T41; ver
`docs/observability/` para la justificación completa de cada una (decisión
que soporta, KR/CA, SLO y ADR).

### De negocio

1. **N1** — Admisiones registradas e ingreso facturable.
2. **N2** — Disponibilidad del flujo de validación.
3. **N3** — Integridad (consumos duplicados y evidencia perdida entre D1 y D2).

### Técnicas

1. **T1** — Latencia de validación.
2. **T2** — Cantidad y edad de registros pendientes de sincronización (outbox).
3. **T3** — Errores técnicos y solicitudes sin respuesta.
