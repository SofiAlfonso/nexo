# Hallazgos de F1-F4

Hallazgos de producto, plataforma y herramientas descubiertos durante T51-T54.

| ID | Hallazgo | Impacto | Estado |
|---|---|---|---|
| H1 | Un lote E1 envenenado podía bloquear el latido. | El panel podía perder estado del recinto por un lote inválido retenido. | Corregido en PR #28. Evidencia: [hallazgo-e1-lote-envenenado](../../chaos/evidence/hallazgo-e1-lote-envenenado/). |
| H2 | Los gauges T2 (`nexo_c2_outbox_pendientes`, edad) se congelaban cuando un lote E1 quedaba retenido. | F1 podía parecer saludable aunque el outbox creciera. | Corregido en PR #31. Evidencia: [red-01-corrida1-gauges-congelados](../../chaos/evidence/red-01-corrida1-gauges-congelados/). |
| H3 | A13/A14 observaban el Collector interno de LGTM y A14 usaba nombres de métricas incorrectos. | Las alertas de cola/exportación no representaban `nexo-otel-collector`. | Corregido en PR #34; T57 conserva el límite de diseño. |
| H4 | No existe alerta externa para caída total del backend de observabilidad. | En F2 el motor de alertas murió con `otel-lgtm`; no podía alertar la pérdida de visibilidad. | Requiere dead-man's switch externo; recorte documentado como pendiente. |
| H5 | D1 caído es invisible para N2/T3 de C2 y para readiness. | F3 produjo 666 timeouts del lector, pero C2 siguió Ready y N2 quedó 100 % aparente. | Añadir readiness dependiente de D1 o alerta por `sin-respuesta` del lector. |
| H6 | Reconexión a D1 tardó ~21 s tras restaurar. | Amplía la ventana de `sin-respuesta` después de que D1 vuelve. | Ajustar pool/retry de conexión y medir de nuevo. |
| H7 | REC-01 a 100m fue demasiado leve para A6. | F4 no valida la alerta; solo muestra cold start y degradación breve. | Probar variante pico o stress controlado; `stress-ng` no está en la imagen actual. |
| H8 | La carga agota la bolsa de boletas válidas por zona y el Job reintenta. | En F1 no hubo `reporte.json`; el retry podía iniciar una segunda carga si no se elimina el Job. | Mejorar `load.mjs`: fallo con reporte parcial, control de backoff y prechequeo de boletas por zona. |
| H9 | Contaminación del Docker compartido durante F1 repetida y F2. | Posible influencia en el burst de timeouts de F2; latencias globales no justificaron repetir. | Registrar en amenazas a la validez y aislar mejor futuras corridas. |

Conclusión transversal: los invariantes de seguridad se sostuvieron (C2 autoridad local, D1 durable, outbox transaccional, 0 duplicados/pérdidas), pero la observabilidad debe cubrir fallos donde el propio backend o la dependencia D1 desaparecen.

