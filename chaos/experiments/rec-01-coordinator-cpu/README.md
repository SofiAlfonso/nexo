# F4 REC-01 — límite de CPU de C2

`experiment.yaml` reduce temporalmente el límite de CPU del Deployment
`nexo-coordinator`, en el contenedor del mismo nombre. Medir degradación de
latencia sin alterar la integridad de consumos; restaurar el límite de CPU
leído del Deployment antes de inyectar, incluso si no estaba definido.
Hipótesis y umbrales
en `docs/context/taller3.md` §3.1. Preparado para ola 3; no ejecutar todavía.
