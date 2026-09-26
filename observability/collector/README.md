# Colector OpenTelemetry de NEXO

Este despliegue recibe trazas, métricas y logs por OTLP gRPC (:4317) y
OTLP HTTP (:4318). El flujo local es **aplicaciones → nexo-otel-collector →
nexo-otel-lgtm (Grafana, Tempo, Prometheus y Loki)**; opcionalmente el colector
también exporta a Grafana Cloud. El exportador `debug` conserva una salida
básica para diagnóstico.

El colector usa una cola de envío con `file_storage` sobre el PVC
`nexo-otel-collector-storage` (1 Gi, ReadWriteOnce). Así, la cola sobrevive
reinicios del pod y respalda el corte de exportación **SER-06** cuando el
destino no está disponible; no sustituye el almacenamiento duradero del
backend. El despliegue tiene una sola réplica y estrategia `Recreate` para
evitar dos pods compartiendo la misma cola. `retry_on_failure.max_elapsed_time`
es `0` (sin límite): con la cola persistida en `file_storage` sobre la PVC, un
backend caído (p. ej. el escenario de caos F2, Collector aislado de
`otel-lgtm`) no debe hacer que el exportador descarte lotes por agotar un
límite de tiempo de reintento; solo se pierde telemetría si se llena la cola
(`queue_size: 10000`) o el propio PVC. No es una garantía de entrega
indefinida, pero sí cubre outages de varias decenas de minutos con el volumen
de datos esperado en desarrollo. El volumen `/data` de otel-lgtm es
`emptyDir`: sus datos se pierden cuando se reemplaza el pod. Ambos son
componentes de desarrollo/demo, no una instalación productiva.

## Instalación local

Desde la raíz del repositorio, con Minikube y Helm disponibles:

```sh
kubectl apply -f deploy/kubernetes/namespaces/
kubectl apply -f deploy/kubernetes/observability/
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update
helm upgrade --install nexo-otel-collector open-telemetry/opentelemetry-collector -n nexo-observability -f observability/collector/values-local.yaml
kubectl -n nexo-observability rollout status deployment/nexo-otel-lgtm
kubectl -n nexo-observability rollout status deployment/nexo-otel-collector
```

El PVC debe estar creado antes de instalar el chart; Minikube utiliza su
StorageClass predeterminada.

Para abrir Grafana: `kubectl -n nexo-observability port-forward svc/nexo-otel-lgtm 3000:3000`
y visitar <http://localhost:3000>. Para emitir datos sintéticos de las tres
señales y revisar sus resultados en Grafana:

```sh
kubectl apply -f observability/synthetic-telemetry/
kubectl -n nexo-observability get pods
kubectl -n nexo-observability logs deployment/nexo-otel-collector
```

## Exportación opcional a Grafana Cloud

Solo activar este perfil cuando exista el Secret. Crear las credenciales con
valores propios (no introducir valores reales en el repositorio):

```sh
kubectl -n nexo-observability create secret generic nexo-grafana-cloud --from-literal=GRAFANA_CLOUD_OTLP_ENDPOINT='<URL_OTLP_HTTP_DE_LA_INSTANCIA>' --from-literal=GRAFANA_CLOUD_INSTANCE_ID='<ID_DE_INSTANCIA>' --from-literal=GRAFANA_CLOUD_OTLP_TOKEN='<TOKEN_DE_ACCESO>'
helm upgrade --install nexo-otel-collector open-telemetry/opentelemetry-collector -n nexo-observability -f observability/collector/values-local.yaml -f observability/collector/values-grafana-cloud.yaml
```

El endpoint debe ser la URL base OTLP/HTTP con HTTPS, sin `/v1/traces` ni
`/v1/metrics`. El ID y el token se inyectan desde el Secret para autenticación
Basic mediante `basicauth/grafana-cloud`. El perfil opcional añade su propio
exportador y cola persistente sin desactivar la exportación local. Helm fusiona
mapas, pero **reemplaza listas**: por eso este perfil declara de nuevo los
exportadores completos de las tres pipelines y todas las extensiones. Para
volver al perfil local, ejecutar el primer `helm upgrade --install` sin el
segundo `-f`.

