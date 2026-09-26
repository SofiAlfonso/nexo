# F1 RED-01 — enlace C2 -> C4

## Hipótesis

C2 conserva la autoridad local cuando pierde comunicación con C4: valida en D1, acumula outbox E1 y drena al restaurar sin pérdidas, duplicados ni degradación de latencia del lector. Mapea a T2 EXP 01, pero el Taller 3 recortó el alcance a C2 -> C4 por 5 min, no a centro + sincronización + telemetría por 15 min.

## Perturbación

- Método: `toxiproxy` deshabilitó el proxy `c2-to-c4`.
- Ventana UTC válida: 2026-09-26 04:44:30.528 -> 04:49:30.708.
- Run record: `64c7b936-e756-476d-abe7-c857ad09f167`.
- Duración: 300 s.

La primera corrida (`red-01-corrida1-gauges-congelados`, run `96aab326-f613-465a-8360-fef67c00a485`) se usa como hallazgo: los gauges T2 se congelaban con un lote E1 retenido; fue corregido en PR #31.

## Carga

Carga nominal programada 780 s desde ~04:42:22Z, 20 lectores y ~5,5 intentos/s. El archivo `carga-resumen.json` no contiene reporte parseable: el worker agotó boletas válidas (`Boletas válidas agotadas`; Palcos quedó sin libres), falló con `ENOENT reporte.json` y Kubernetes inició un retry que se eliminó.

## Métricas

| Métrica | Antes | Durante | Después |
|---|---:|---:|---:|
| N2 disponibilidad | 100 % | 100 % | 100 % |
| T1 p95 C2 | 30,3 ms media | 24,0 ms media | 23,9 ms media |
| T1 <=300 ms C2 | 100 % | 100 % | 100 % |
| T2 outbox pendientes | 0 max | 1246 max | 1385 max transitorio |
| T2 edad outbox | 0 s | 264,28 s max | 293,73 s max |
| C4 registros/min | 322,67 media | 49,74 media | 633,94 media |

## Recuperación

Al restaurar había 1410 pendientes. D1 marcó 1410/1410 como acusados dentro de 5 min; el último acuse fue a las 04:49:45.203Z, ~15 s después de la restauración. Cumple el criterio T2/Taller 3 de >=99,5 % drenado en 5 min.

## Integridad

- D1: 11332 intentos, 7525 aceptados, 3807 rechazados.
- Consumos: 7525.
- Duplicados: 0.
- Decisiones D1 sin outbox: 0.
- D2: 11332 decisiones, 7525 admisiones.
- Cruce D1/D2: 0 pérdidas, 0 `sinOrigenEnD1`, 100 % drenado.

Una recolección temprana durante carga mostró 6 `sinOrigenEnD1`; al repetir en reposo quedó en 0. Se interpreta como carrera de recolección, no pérdida.

## Alertas

A11 no disparó porque el umbral es `>300 s` y la perturbación duró exactamente 300 s; la edad máxima medida quedó por debajo o alrededor del límite (298,98 s en SQL; 293,73 s en métricas). A8 apareció como ruido de arranque/parada de carga.

## Resultado

**Aprobada.** Frente a los criterios de Taller 3 §5/T51: validación local mantenida, T1 sin degradación, drenaje 100 % en 15 s, 0 pérdidas y 0 duplicados. También confirma el arreglo PR #21: C2 sigue validando aunque C4 no responda.

## Aprendizaje

- F1 es el experimento más demostrativo de la autoridad local y del outbox transaccional.
- Los gauges T2 deben medirse desde la base real, no desde estado en memoria susceptible a lotes retenidos.
- El umbral A11 es coherente con cortes de más de 300 s; para cortes exactamente de 300 s no debe esperarse alerta crítica.
- La herramienta de carga necesita manejar agotamiento de boletas y retry del Job sin borrar el reporte.

## Evidencia

- [integridad.json](../../chaos/evidence/red-01-central-connection/integridad.json)
- [metricas-resumen.json](../../chaos/evidence/red-01-central-connection/metricas-resumen.json)
- [carga-resumen.json](../../chaos/evidence/red-01-central-connection/carga-resumen.json)
- [nexo-chaos-run.json](../../chaos/evidence/red-01-central-connection/nexo-chaos-run.json)
- [alertas-estado.json](../../chaos/evidence/red-01-central-connection/alertas-estado.json)
- [manifiesto.json](../../chaos/evidence/red-01-central-connection/manifiesto.json)
- Capturas: [t2-pendientes.png](../../chaos/evidence/red-01-central-connection/capturas/t2-pendientes.png), [t2-edad-outbox.png](../../chaos/evidence/red-01-central-connection/capturas/t2-edad-outbox.png), [n2-disponibilidad.png](../../chaos/evidence/red-01-central-connection/capturas/n2-disponibilidad.png), [t1-p95.png](../../chaos/evidence/red-01-central-connection/capturas/t1-p95.png)
- Hallazgo previo: [red-01-corrida1-gauges-congelados](../../chaos/evidence/red-01-corrida1-gauges-congelados/), [hallazgo-e1-lote-envenenado](../../chaos/evidence/hallazgo-e1-lote-envenenado/)

