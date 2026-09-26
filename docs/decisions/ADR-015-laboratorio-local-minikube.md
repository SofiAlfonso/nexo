# ADR-015: Laboratorio local en Minikube

- **Estado**: Aceptado
- **Fecha**: 25 de septiembre de 2026
- **Origen**: taller 3, decisión Q7 de la orquestación (plan del taller 3, gaps G01, G14 y G15)

## Contexto

El entregable 11 del taller 2 (§11.2) proponía Docker Compose para el laboratorio de fallos.
El taller 3 necesita reproducir fronteras de confianza y perturbar enlaces, procesos y bases sin recompilar NEXO.
Minikube sobre Docker Desktop y WSL 2 es un entorno local de desarrollo, integración y demostración, no un despliegue productivo.

## Decisión

Usar Minikube y separar `nexo-venue` (C2, D1, lectores emulados), `nexo-central` (C4 con C3 y C5, D2), `nexo-external` (boletería simulada), `nexo-observability` y `nexo-chaos` (Toxiproxy y ejecuciones).
Restringir con NetworkPolicies el tráfico de T2 §5.2: C1 a C2, recinto a central saliente para E1/P2 y C4 a D2, además de las dependencias externas y de telemetría explícitas.
Usar Kustomize para manifiestos de aplicación, Helm solo para Collector y `otel-lgtm`; construir imágenes dentro de Minikube con `imagePullPolicy: Never`.
Reservar `deploy/compose/docker-compose.dev.yml` (D1, D2 y `otel-lgtm`) solo para `npm run dev` y el hito M1, nunca para los experimentos.

## Alternativas consideradas

- Docker Compose para todo: no ofrece NetworkPolicies ni escalado a cero de StatefulSets para ensayar F1–F4 con la misma topología.
- kind o k3d: añaden otra opción de clúster local sin ventaja necesaria para el plan acordado.

## Consecuencias

Los fallos se reproducen en una topología con fronteras explícitas, pero requieren Docker Desktop, WSL 2, Minikube, kubectl y Helm disponibles.
Las imágenes locales no se descargan del registro; las pruebas deben verificar que existen dentro del clúster.
El laboratorio no acredita disponibilidad, seguridad ni recuperación de un despliegue productivo.

## Criterio para aceptar

Aplicar manifiestos por Kustomize, comprobar las cinco fronteras y probar que las NetworkPolicies deniegan tráfico no permitido sin bloquear V1, E1 y P2.
Ejecutar en Minikube F1 RED-01, F2 SER-06, F3 BD-01 y F4 REC-01 con reversión y evidencia de los resultados.

## Aplicación en el taller 3

- Configurar namespaces y políticas en `deploy/minikube/` y manifiestos de aplicación en `deploy/kubernetes/` (G01, G14).
- Construir imágenes en Minikube y fijar `imagePullPolicy: Never` (G15); usar `observability/collector/` para Helm.
- Mantener `deploy/compose/docker-compose.dev.yml` limitado a desarrollo/M1; ejecutar fallos desde `chaos/experiments/`.
