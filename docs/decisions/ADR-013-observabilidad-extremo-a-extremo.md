# ADR-013: Observabilidad de extremo a extremo separada de la auditoría

- **Estado**: Pendiente de PoC (actualizado)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

La experiencia en puerta incluye lector, coordinador, sincronización y panel, no solo el tiempo del servidor.
Una caída de la telemetría no debe impedir decisiones ni alterar evidencia de negocio.
El taller 2 planteó OpenTelemetry con Collector y Grafana Cloud Free; el laboratorio necesita además funcionar sin internet ni token externo.

## Decisión

Instrumentar C1, C2, C4 y C5 con OpenTelemetry y contexto de traza W3C; medir latencia de extremo a extremo con reloj monotónico en C1 y denominador completo, incluidos errores y solicitudes sin respuesta.
Exportar de forma asíncrona a un Collector con cola persistente `file_storage` en PVC y `retry_on_failure`, cuyo destino principal de laboratorio es `grafana/otel-lgtm` en `nexo-observability`.
Grafana Cloud Free será opcional solo si existe el Secret; las decisiones y la auditoría permanecen en D1/D2, nunca en el backend de telemetría.

## Alternativas consideradas

- Solo logs al cierre: no muestran latencia ni degradación en vivo.
- Solo métricas de servidor: excluyen el lector y las solicitudes sin respuesta.
- Muestreo indiscriminado: puede ocultar eventos necesarios para el denominador completo.
- Grafana Cloud como único backend de PoC: exige conectividad y credenciales para la demostración local.

## Consecuencias

La cola necesita almacenamiento persistente, reintentos y seguimiento de ocupación y drenaje, sin competir con V1.
No se usa la boleta como etiqueta métrica; la pérdida de visibilidad se alerta sin bloquear accesos.
El backend local es variante del laboratorio y no sustituye una decisión posterior sobre operación productiva.

## Criterio para aceptar

Correlacionar trazas C1–C2–C4–C5 y verificar N1 admisiones/ingreso, N2 disponibilidad, N3 duplicados/pérdida, T1 latencia, T2 pendientes y T3 errores/sin respuesta con solicitudes contadas independientemente.
Cortar la exportación 15 minutos: la validación y auditoría continúan, la cola persiste y drena tras restaurar el backend.

## Aplicación en el taller 3

- Configurar SDK en C1, C2, C4 y C5; Collector en `observability/collector/` con `file_storage` sobre PVC y backend local `otel-lgtm` (G04, G05).
- En F2 SER-06 cortar la exportación, no detener la decisión; Grafana Cloud Free queda condicionado al Secret (G06).
- Usar N1–N3 y T1–T3 según G03; conservar el contador del lector ante pérdida de telemetría.
- 26-09-2026: F2 SER-06 ejecutado, **aprobada con degradación prevista**: 15 min sin `otel-lgtm` con la validación y la auditoría intactas, y la cola del Collector (hasta 185/10000) drenada al restaurar ([f2-ser-06.md](../fault-experiments/f2-ser-06.md)). El estado no cambia: falta la correlación de trazas C1–C2–C4–C5 y un vigilante externo a `otel-lgtm` ([matriz §3](../coherencia/matriz.md), recortes a y j).
