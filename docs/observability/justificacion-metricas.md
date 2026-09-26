# Justificación de las seis métricas (T41/T43, T2 §3.2)

Tabla lista para el informe: por cada una de las seis métricas obligatorias
(3 de negocio, 3 técnicas — `docs/context/taller3.md` §3.2), qué decisión
sostiene, qué KR/CA respalda, cuál es su SLO y en qué ADR se ancla. Su
implementación (spans, métricas OTel y logs) es T40; los dashboards que las
muestran en vivo son T41 (`observability/dashboards/`); las alertas
derivadas son T42 (`observability/alerts/`).

| ID | Métrica | Nombre(s) OTel | Decisión que soporta | KR / CA | SLO | ADR |
|---|---|---|---|---|---|---|
| N1 | Admisiones registradas e ingreso facturable | `nexo_c2_validaciones_total{decision="aceptado",admision="true"}` (C2); `nexo_c4_lotes_evidencia_total{resultado}` y `nexo_c4_registros_evidencia_total` (C4) | Primer consumo válido por boleta como base del modelo de tarifa por asistencia (I(N) = 500 + 0,40 N); es el evento de negocio que factura el piloto. | Taller 1 §5.1, KR5.1, RN-04, RN-09 | Informativa; conciliada al cierre (sin umbral de alerta directo; el cierre preliminar/definitivo la usa como fuente). | ADR-003 (consumo atómico de único ingreso), ADR-011 (sincronización recuperable de la evidencia que la respalda) |
| N2 | Disponibilidad del flujo de validación | `nexo_c2_validaciones_total{decision}` (denominador completo, incluido `sin-respuesta`); vista extremo a extremo en `nexo_c1_resultados_total{decision}` | C2 es la única autoridad de validación (invariante 1); si el flujo no decide, el recinto pierde su función esencial aunque D1/D2 sigan sanos. | T2 §8.2, CA2 | ≥ 99,9 % (decisiones definitivas / solicitudes del lector) | ADR-002 (validación síncrona en el coordinador local) |
| N3 | Integridad | `nexo_c4_lotes_evidencia_total{resultado="conflicto"}` (proxy aplicativo de conflictos de idempotencia en E1; ver limitación abajo) | Invariantes 4 y 6 (consumo único garantizado por `UNIQUE` en D1; bitácora solo adición): ninguna boleta puede consumirse dos veces ni perderse evidencia entre D1 y D2 sin que quede visible. | ADR-003, ADR-004, ADR-011; alerta A1 | 0 y 0 (consumos duplicados; evidencia perdida) | ADR-003 (consumo atómico único ingreso), ADR-004 (bitácora solo adición), ADR-011 (sincronización recuperable) |
| T1 | Latencia de validación | `nexo_c2_validacion_duracion_ms` (C2, con commit incluido); `nexo_c1_validacion_duracion_ms` (C1, extremo a extremo) | La validación síncrona en el coordinador local (invariante 2: el lector no decide) solo es viable si responde rápido; es el atributo de calidad central de la arquitectura de referencia. | T2 §8.2, CA2, ADR-002 | ≥ 95 % de respuestas en ≤ 300 ms (denominador incluye tardías y sin respuesta); p95 ≤ 500 ms | ADR-002 (validación síncrona en el coordinador local) |
| T2 | Pendientes de sincronización | `nexo_c2_outbox_pendientes` (gauge); `nexo_c2_outbox_edad_maxima_s` (gauge) | El outbox transaccional (invariante 7) es lo que permite que C2 valide sin depender de C4; su drenaje observable es la prueba de que la recuperación tras un corte funciona. | KR2.1, ADR-011; alertas A10 y A11 | ≥ 99,5 % de pendientes drenados en 5 min tras recuperar conectividad | ADR-011 (sincronización recuperable) |
| T3 | Errores técnicos y solicitudes sin respuesta | `nexo_c2_errores_total{causa}` | Distingue rechazos legítimos (resultado de negocio) de fallas técnicas (timeouts, persistencia, "sin confirmación"); sin esta separación, N2 y T1 se contaminan con ruido técnico. | T2 §8.2, PU-03-07, PB-12 | Informativa; alerta si consume el presupuesto de error de N2 (≥ 0,1 %) | ADR-002 (validación síncrona en el coordinador local) |

## Limitación conocida de N3

No existe un contador aplicativo directo de "boleta con más de un consumo
válido": la unicidad la garantiza la restricción `UNIQUE` de D1 (invariante
4), de modo que un duplicado real sería un fallo del propio mecanismo de
persistencia, no algo que el código de aplicación observe de forma
confiable en caliente (si ocurriera, el segundo intento habría fallado con
`ErrorConsumoDuplicado` y se habría rechazado, no confirmado). El proxy más
cercano disponible en instrumentación aplicativa es
`nexo_c4_lotes_evidencia_total{resultado="conflicto"}` (mismo `idOrigen` con
contenido distinto en E1, PB-04). La verificación SQL definitiva —conteo
periódico de boletas con más de un consumo y de evidencia perdida entre D1
y D2— es responsabilidad de T55 (experimentos de integridad); esta
desviación se documenta también en `observability/alerts/README.md`
(alerta A1).

## Métricas de apoyo (no cuentan entre las seis)

- `nexo_c2_latido_edad_s` (gauge por `puntoId`, C2): edad del último
  heartbeat H1, apoyo de KR1.2 y de la alerta A8 ("sin comunicación" > 60 s,
  T2 §8.6).
- Métricas internas del Collector (`otelcol_exporter_queue_size`,
  `otelcol_exporter_send_failed_*`): apoyo de las alertas A13/A14 (T2 §8.4),
  no atribuibles a un componente de negocio de NEXO.
