# F4 REC-01 — límite de CPU de C2

`experiment.yaml` reduce temporalmente el límite de CPU del Deployment
`nexo-coordinator`, en el contenedor del mismo nombre. Medir degradación de
latencia sin alterar la integridad de consumos; restaurar el límite de CPU
leído del Deployment antes de inyectar, incluso si no estaba definido.
Ejecutado en T54; hipótesis, umbrales y análisis en
[`docs/fault-experiments/f4-rec-01.md`](../../../docs/fault-experiments/f4-rec-01.md).
`durationSeconds` se cambió de 120 a 300 para que A6 (`for: 2m`) pudiera
disparar.
