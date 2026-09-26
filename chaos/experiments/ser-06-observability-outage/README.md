# F2 SER-06 — exportación del Collector

`experiment.yaml` escala el destino local `nexo-otel-lgtm` a cero. Esta es
la variante aprobada del escenario: en lugar de bloquear la exportación con
NetworkPolicy, se deja al Collector funcionando con su cola persistente;
la cola debe retener y drenar al restaurar el número original de réplicas.
Ejecutado en T52; hipótesis, umbrales y análisis en
[`docs/fault-experiments/f2-ser-06.md`](../../../docs/fault-experiments/f2-ser-06.md).
