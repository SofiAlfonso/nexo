# F2 SER-06 — exportación del Collector

`experiment.yaml` escala el destino local `nexo-otel-lgtm` a cero. Esta es
la variante aprobada de §3.1: en lugar de bloquear la exportación con
NetworkPolicy, se deja al Collector funcionando con su cola persistente;
la cola debe retener y drenar al restaurar el número original de réplicas.
Hipótesis y umbrales en `docs/context/taller3.md` §3.1. Preparado para ola 3;
no ejecutar todavía.
