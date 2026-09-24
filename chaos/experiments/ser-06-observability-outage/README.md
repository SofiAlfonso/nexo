# SER-06 — Interrupción del Collector / exportación a Grafana Cloud

**Responsabilidad**: reservar el espacio para el experimento SER-06, que
interrumpirá el OpenTelemetry Collector o su exportación hacia Grafana
Cloud, para observar el comportamiento de la cola persistente y la pérdida
de telemetría.

**Qué no debe implementarse aquí todavía**: la interrupción en sí ni
scripts de ejecución. Solo la carpeta y este README.

**Componente relacionado**: stack de observabilidad (Collector dentro de
Minikube y exportación OTLP hacia Grafana Cloud).

**Decisiones pendientes**: mecanismo de interrupción (detener el Collector
vs. bloquear la exportación), duración del experimento y criterios de
éxito/rollback sobre la cola persistente.
