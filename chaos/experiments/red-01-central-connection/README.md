# F1 RED-01 — enlace C2 → C4

`experiment.yaml` deshabilita el proxy `c2-to-c4` de Toxiproxy en
`nexo-venue`. C2 conserva la autoridad, el outbox acumula pendientes y
debe drenarse al recuperar el enlace. Hipótesis y umbrales en
`docs/context/taller3.md` §3.1. Ejecutado en T51; análisis en
[`docs/fault-experiments/f1-red-01.md`](../../../docs/fault-experiments/f1-red-01.md).
