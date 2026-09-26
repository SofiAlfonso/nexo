# F4 REC-01 — límite de CPU de C2

## Hipótesis

Reducir CPU del coordinador debe degradar T1 de forma observable y disparar A6 si el porcentaje de validaciones <=300 ms cae por debajo de 95 % durante 2 min, sin alterar integridad. No tiene fila directa en T2 §11.3; complementa los criterios de estado estable, aborto e integridad con un fallo de recursos.

## Perturbación

- Método: `cpuLimit` en `deployment/nexo-coordinator`, contenedor `nexo-coordinator`.
- Límite aplicado: 100m; el límite anterior era 500m. No se puede bajar de 100m porque coincide con el request.
- Ventana UTC: 2026-09-26 05:51:28.064 -> 05:56:28.303.
- Run record: `f56b65df-08cb-46d6-ad76-fc3a6e4dc55a`.
- Duración: 300 s.

`experiment.yaml` se cambió de 120 a 300 s para que A6 (`for: 2m`) tuviera oportunidad real de disparar.

## Carga

Carga nominal 720 s. El archivo de evidencia registra inicio 05:49:34.374Z y fin 06:01:34.339Z; la bitácora operacional la describió como iniciada alrededor de 05:49:31Z. Se despacharon 3960 intentos a 5,5/s.

## Métricas

| Métrica | Antes | Durante | Después |
|---|---:|---:|---:|
| Lector p95 | 29,4 ms | 65,1 ms | 31,5 ms |
| Lector <=300 ms | 100 % | 99,06 % | 99,90 % |
| Timeouts lector | 0 | 29 | 6 |
| T1 p95 C2 | 22,24 ms media | 95,25 ms media; max 404,5 ms | 22,39 ms media |
| T1 p95 C1 | 24,29 ms media | 137,28 ms media; max 675,69 ms | 24,46 ms media |
| T1 <=300 ms C2 | 100 % | 99 % media; min 92 % | 100 % |
| N2 | 100 % | 99 % media; min 91 % | 100 % |

La degradación fuerte ocurrió principalmente durante el rollout/cold start bajo 100m: p95 C2 ~386-404 ms y p95 C1 ~636-673 ms por ~1 min. Luego C2 operó cerca de 30-45 ms.

## Recuperación

`nexo-chaos` restauró el límite a 500m y el Deployment quedó recuperado. No hubo backlog relevante de outbox: 2 pendientes al restaurar, acusados en menos de 1 s.

## Integridad

- D1: 14177 intentos, 10740 aceptados, 3437 rechazados.
- Consumos: 10740.
- D2: 14177 decisiones, 10740 admisiones.
- Duplicados: 0.
- Pérdidas D1/D2: 0.
- Drenado E1: 100 %.

## Alertas

A6 no disparó: la caída bajo 95 % duró ~1 min y la regla exige 2 min. A8 apareció como ruido de arranque/parada de carga, no como efecto del límite CPU.

## Resultado

**No concluyente.** La integridad se mantuvo y hubo degradación observable, pero el fallo aprobado fue demasiado leve para validar el criterio de alerta A6. El límite mínimo práctico (100m) y el consumo nominal de C2 (~31m) dejan poco margen; la parte más visible fue el cold start inducido por el patch del Deployment, no una saturación sostenida.

## Aprendizaje

- Para probar A6 se requiere una variante más fuerte: perfil de carga pico o stress controlado dentro de la imagen. `stress-ng` no estaba disponible.
- Cambiar el límite de CPU provoca rollout; hay que separar degradación por cold start de throttling sostenido.
- El diseño preservó integridad bajo presión de recursos.

## Evidencia

- [integridad.json](../../chaos/evidence/rec-01-coordinator-cpu/integridad.json)
- [metricas-resumen.json](../../chaos/evidence/rec-01-coordinator-cpu/metricas-resumen.json)
- [lector-por-fase.txt](../../chaos/evidence/rec-01-coordinator-cpu/lector-por-fase.txt)
- [carga-resumen.json](../../chaos/evidence/rec-01-coordinator-cpu/carga-resumen.json)
- [nexo-chaos-run.json](../../chaos/evidence/rec-01-coordinator-cpu/nexo-chaos-run.json)
- [alertas-estado.json](../../chaos/evidence/rec-01-coordinator-cpu/alertas-estado.json)
- [manifiesto.json](../../chaos/evidence/rec-01-coordinator-cpu/manifiesto.json)
- Capturas: [n2-disponibilidad.png](../../chaos/evidence/rec-01-coordinator-cpu/capturas/n2-disponibilidad.png), [t1-p95.png](../../chaos/evidence/rec-01-coordinator-cpu/capturas/t1-p95.png), [t1-pct-300ms.png](../../chaos/evidence/rec-01-coordinator-cpu/capturas/t1-pct-300ms.png), [t3-errores.png](../../chaos/evidence/rec-01-coordinator-cpu/capturas/t3-errores.png)

