# Dashboards (T41)

Dashboards de Grafana como código, versionados y provisionados como archivos JSON
en el `otel-lgtm` de Compose y del clúster (T2 §8.5).

- `operacion-del-evento.json` — supervisor y soporte durante un evento: N1
  (admisiones aceptadas), N2 (disponibilidad del flujo de validación) y T1
  (latencia de validación, p95 y % ≤ 300 ms), más el desglose de decisiones
  visto desde el lector (C1).
- `sincronizacion-y-resiliencia.json` — pendientes y edad del outbox de C2
  (T2), lotes/registros de evidencia ingeridos por C4 y conflictos de
  integridad (N3), y errores técnicos o sin respuesta (T3).
- `provisioning-dashboards.yaml` — configuración del proveedor de archivos de
  Grafana; se monta en `/etc/grafana/provisioning/dashboards/` mientras los
  JSON se montan en `/otel-lgtm/dashboards` (ruta referenciada por el
  proveedor).

Las seis métricas obligatorias (N1–N3, T1–T3) están cubiertas entre ambos
tableros; el resto de agrupaciones de T2 §8.5 (SLO/capacidad/costo,
conciliación y cierre, adopción del piloto) queda fuera del alcance de T41.

## Cómo verlos en desarrollo

Con `npm run dev` levantado (incluye `otel-lgtm` de
`deploy/compose/docker-compose.dev.yml`) y el lector emulado enviando carga,
entra a Grafana en http://localhost:3000, carpeta **NEXO**. Los paneles se
refrescan cada 10 s.
