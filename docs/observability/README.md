# Documentación de observabilidad

**Responsabilidad**: documentar el diseño de observabilidad de NEXO —
convenciones de telemetría, catálogo de métricas de negocio y técnicas,
objetivos de latencia y criterios de las etiquetas permitidas.

**Qué no debe implementarse aquí**: configuración ejecutable del Collector,
dashboards ni alertas (ver [observability/](../../observability/README.md)).
Solo documentación y explicación de decisiones.

**Componente relacionado**: transversal, con énfasis en C2 (coordinador
local) y C4 (núcleo central), que son las fuentes principales de telemetría
de negocio.

**Decisiones pendientes**: catálogo definitivo de métricas por módulo,
convención final de nombres y versión del contrato de telemetría.

## Contenido

- [`justificacion-metricas.md`](justificacion-metricas.md) — tabla de las
  seis métricas obligatorias de T2 §3.2 (N1–N3, T1–T3): nombre OTel,
  decisión que soportan, KR/CA, SLO y ADR (T41/T43).
