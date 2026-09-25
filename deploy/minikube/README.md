# Minikube

**Responsabilidad**: alojar la documentación y, más adelante, los recursos
específicos para ejecutar NEXO en Minikube (Kubernetes sobre Docker Desktop
y WSL 2) como entorno de desarrollo, integración y demostración.

**Qué no debe implementarse aquí**: configuración ni referencias a un
despliegue productivo definitivo. Minikube es exclusivamente el entorno
local de desarrollo/demo de NEXO.

**Componente relacionado**: transversal — entorno de ejecución de C1–C5,
D1–D2 y del stack de observabilidad.

## Perfil y arranque

Requisitos: Docker Desktop con WSL 2 habilitado, Minikube, `kubectl` y Helm;
asegurar al menos 4 CPU y 8 GiB de memoria disponibles para la VM.

```sh
minikube start --driver=docker --cpus=4 --memory=8192
kubectl apply -f deploy/kubernetes/namespaces/
kubectl apply -f deploy/kubernetes/observability/
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update
helm upgrade --install nexo-otel-collector open-telemetry/opentelemetry-collector -n nexo-observability -f observability/collector/values-local.yaml
```

Los namespaces son `nexo-venue`, `nexo-central`, `nexo-external`,
`nexo-observability` y `nexo-chaos`. La configuración del colector, las
pruebas de humo, el acceso a Grafana y la exportación opcional a Grafana Cloud
se documentan en [observability/collector/README.md](../../observability/collector/README.md).

**Decisiones pendientes**: addons adicionales y estrategia de construcción
local de imágenes. El perfil base del clúster ya está definido.
