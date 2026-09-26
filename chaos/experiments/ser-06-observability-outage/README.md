# F2 SER-06 — exportación del Collector

`experiment.yaml` aplica durante 15 minutos una NetworkPolicy aditiva que
deniega todo el tráfico saliente del Collector, sin bloquear el entrante.
Esto afecta todo su egress, no solo la exportación hacia `nexo-otel-lgtm`.
El laboratorio no tiene políticas previas para esos pods.
La cola persistente del Collector debe retener la telemetría y drenarla al
retirar la política. Hipótesis y umbrales en `docs/context/taller3.md` §3.1.
Preparado para ola 3; no ejecutar todavía.
