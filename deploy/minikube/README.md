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

## Despliegue de la aplicación (C1–C5, D1–D2)

Con `namespaces/` y `observability/` ya aplicados (paso anterior) y Minikube
corriendo, un solo comando construye las imágenes con `minikube image build`,
crea los Secrets de laboratorio (plantillas, sin secretos en Git), aplica los
manifiestos Kustomize de `deploy/kubernetes/{data,application}` y espera a
que D1/D2/C2/C4 queden listos:

```sh
node deploy/scripts/up.mjs   # o deploy/scripts/up.ps1 en PowerShell
```

Otros scripts en `deploy/scripts/` (documentados en su propio
[README](../scripts/README.md)):

- `down` — elimina Deployments/Jobs/StatefulSets de la aplicación pero
  conserva los PVC y Secrets de D1/D2 (reutilizables en el próximo `up`).
- `reset --confirm` — `down` además de borrar PVC y Secrets; deja el clúster
  como recién creado.
- `load` — exporta las boletas activas de D1, publica una muestra
  representativa como ConfigMap y corre el lector emulado (C1) como Job de
  carga contra `nexo-coordinator` (perfil `nominal`, 30 s).

`nexo-ticketing` (boletería simulada, `nexo-external`) está implementada
(T23, `src/ticketing-sim/`); si no arranca, no bloquea el resto del
despliegue.

**Prueba de frontera** (T26): `tests/integration/k8s/network-policies.test.ts`
verifica contra el clúster vivo que C2 no alcanza D2 directamente, que C2
alcanza D1 y C4 a través de Toxiproxy, y que C4 sí alcanza D2. Requiere el
stack desplegado (`kubectl` en el `PATH` y `nexo-coordinator` Ready):

```sh
npx vitest run --config vitest.integration.config.ts tests/integration/k8s/network-policies.test.ts
```

**Decisiones pendientes**: automatización de la construcción de imágenes en
CI. Toxiproxy no necesita un addon: se despliega como Deployment en
`nexo-venue` (`deploy/kubernetes/application/toxiproxy-deployment.yaml`).
