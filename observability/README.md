# Observabilidad

**Responsabilidad**: alojar la configuración de observabilidad de NEXO:
Collector de OpenTelemetry, dashboards y alertas versionados, el contrato
de telemetría y la telemetría sintética usada para pruebas.

**Qué no debe implementarse aquí**: dashboards ni alertas funcionales
todavía, ni datos reales de producción. Tampoco se deben incluir referencias
completas de boleto, QR, datos personales, secretos, `trace_id` ni
`span_id` como etiquetas métricas.

**Componente relacionado**: transversal, con OpenTelemetry instrumentando
C1–C5 y el Collector desplegado dentro de Minikube; exportación vía OTLP
hacia Grafana Cloud (métricas, logs y trazas, con W3C Trace Context y cola
persistente en el Collector).

**Decisiones pendientes**: definición final del contrato de telemetría,
catálogo de dashboards/alertas y umbrales concretos.

## Subcarpetas

- `collector/` — configuración del OpenTelemetry Collector.
- `dashboards/` — dashboards versionados.
- `alerts/` — reglas de alerta versionadas.
- `telemetry-contract/` — contrato de telemetría (nombres, tipos, etiquetas
  permitidas).
- `synthetic-telemetry/` — generadores/fixtures de telemetría sintética
  para pruebas.

## Objetivo de latencia vigente

Al menos el 95 % de las solicitudes de validación deben resolverse en un
máximo de 300 ms. Las solicitudes tardías, los errores y las solicitudes
sin respuesta permanecen en el denominador de este objetivo.

## Métricas de negocio principales (previstas)

1. Disponibilidad del flujo de validación.
2. Consumos duplicados (objetivo: cero).
3. Completitud y pérdida de evidencia.

## Métricas técnicas principales (previstas)

1. Latencia de validación.
2. Cantidad y edad de registros pendientes de sincronización.
3. Errores técnicos y solicitudes sin respuesta.
