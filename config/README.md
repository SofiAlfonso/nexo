# Configuración

**Responsabilidad**: alojar configuración no sensible y ejemplos de
variables de entorno (`config/examples/`) que documenten qué secretos
necesita NEXO, sin contener sus valores reales.

**Qué no debe implementarse aquí**: ningún secreto real — tokens de Grafana
Cloud, contraseñas de PostgreSQL, kubeconfig, certificados ni cualquier
credencial. Los secretos se crean **externamente** al repositorio (por
ejemplo, como Kubernetes Secrets aplicados manualmente o mediante un
gestor de secretos) y nunca se versionan en Git.

**Componente relacionado**: transversal — todos los componentes que
requieren configuración externa (C2, C4, D1, D2, Collector).

## Grupos de variables

- **D1 — PostgreSQL local**: `LOCAL_POSTGRES_HOST`, `LOCAL_POSTGRES_PORT`,
  `LOCAL_POSTGRES_DB`, `LOCAL_POSTGRES_USER` y
  `LOCAL_POSTGRES_PASSWORD`. Es la base transaccional por sede que utiliza
  el servicio de validación C2 en `nexo-venue`.
- **D2 — PostgreSQL central**: `CENTRAL_POSTGRES_HOST`,
  `CENTRAL_POSTGRES_PORT`, `CENTRAL_POSTGRES_DB`,
  `CENTRAL_POSTGRES_USER` y `CENTRAL_POSTGRES_PASSWORD`. La utiliza el
  núcleo central C4 en `nexo-central`.
- **Sesión**: `SESSION_COOKIE_SECRET` firma la cookie de sesión.
- **OTLP**: `OTEL_EXPORTER_OTLP_ENDPOINT` apunta al backend local
  `grafana/otel-lgtm`.
- **Grafana Cloud (opcional)**: `GRAFANA_CLOUD_OTLP_ENDPOINT`,
  `GRAFANA_CLOUD_INSTANCE_ID` y `GRAFANA_CLOUD_OTLP_TOKEN`. En Kubernetes
  se guardan en el Secret `nexo-grafana-cloud` de `nexo-observability`.
- **Kubernetes / Minikube**: `KUBECONFIG_PATH` identifica el kubeconfig local.

El entorno de desarrollo con Compose usa
`deploy/compose/.env.example`; no contiene credenciales de producción y
puede utilizarse sin crear un `.env` adicional.

## Kubernetes Secrets

Los Secrets se crean manualmente a partir de un archivo local excluido de
Git; por ejemplo:

```sh
kubectl create secret generic <nombre> \
  --from-env-file=<archivo-local-fuera-de-Git> \
  --namespace <namespace>
```

No se deben copiar valores reales a los archivos de ejemplo versionados.

**Decisiones pendientes**: mecanismo definitivo de gestión de secretos para
Minikube (Kubernetes Secrets manuales vs. herramienta externa).
