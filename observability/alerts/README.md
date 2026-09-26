# Alertas (T42)

Reglas de alerta de Grafana (unified alerting) como código, provisionadas por
archivo junto con un punto de contacto de webhook local (T2 §8.6).

- `alertas-t42.yaml` — grupo `nexo-t42-alertas` con las seis alertas del
  alcance de T42: A1 (consumo duplicado / conflicto de integridad), A6
  (latencia ≤ 300 ms por debajo del 95 %), A8 (punto sin comunicación > 60 s),
  A11 (pendiente de outbox crítico), A13 (cola del Collector > 80 %) y A14
  (telemetría descartada o exportación fallida). Incluye el contact point
  `nexo-webhook-local` (tipo `webhook`) y una política que enruta las
  alertas de severidad `critical` hacia él.
- `webhook-receptor.mjs` — receptor HTTP local sin dependencias que registra
  en stdout cada notificación recibida; es el punto de contacto por defecto
  del laboratorio (no apto para producción).

## Notas de implementación

- A1 no tiene un contador aplicativo directo de "consumo duplicado
  confirmado" porque la unicidad la garantiza la restricción `UNIQUE` de D1
  (invariante #4): un duplicado real sería un fallo del propio mecanismo, no
  algo que el código de aplicación pueda observar de forma fiable en
  caliente. Como proxy más cercano disponible en instrumentación aplicativa
  se usa `nexo_c4_lotes_evidencia_total{resultado="conflicto",tipo="decision"}` (conflictos
  de idempotencia por `idOrigen` en E1). Solo cuentan los conflictos de
  registros `decision`: un latido o un estado en conflicto no es un fallo de
  integridad (C2 lo retira del lote y lo registra en `latido_descartado` de D1).
  La verificación SQL definitiva de
  boletas con más de un consumo válido es responsabilidad de T55
  (experimentos de integridad).
- A8 usa `nexo_c2_latido_edad_s`, una métrica de apoyo (no una de las seis
  N/T de T2 §3.2) instrumentada en `RegistroLatidos` de C2 para dar
  visibilidad de puntos sin latido reciente.
- A13 y A14 leen métricas internas del propio OpenTelemetry Collector
  (`otelcol_exporter_queue_size`, `otelcol_exporter_send_failed_*`); solo se
  disparan si el Collector expone su métrica interna de telemetría (owner:
  `observability/collector/`, S2-otel).

## Cómo probarlas en desarrollo

1. Levanta `npm run dev` (incluye `otel-lgtm`).
2. En otra terminal: `node observability/alerts/webhook-receptor.mjs` (usa el
   puerto por defecto 9099).
3. Define `NEXO_ALERT_WEBHOOK_URL=http://host.docker.internal:9099/alertas`
   antes de levantar `otel-lgtm` para que Grafana pueda alcanzar el receptor
   desde el contenedor.
4. Fuerza la condición de alguna alerta (p. ej. detén D1 para A6/T1, o el
   Collector para A13/A14) y observa la notificación en la consola del
   receptor.
