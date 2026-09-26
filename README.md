# NEXO

## Propósito

NEXO es una solución B2B de control de acceso para estadios. Coordina la
validación de presentaciones (boletos/credenciales) en las puertas de un
recinto, garantizando decisiones de acceso consistentes, trazables y
resilientes ante fallos de red o de plataforma.

## Alcance de este repositorio

Este repositorio aloja, de forma incremental:

1. El código de NEXO (cliente de puerta, coordinador local, núcleo central).
2. El despliegue local en Minikube.
3. La instrumentación y configuración de observabilidad.
4. Los experimentos controlados de fallos (chaos engineering).
5. La documentación y las evidencias de pruebas.

## Resumen de la arquitectura

NEXO sigue un estilo de **arquitectura por capas con monolito modular
central** (no microservicios por módulo):

- **C1 — Cliente de puerta o lector**: registra la presentación, conserva un
  diario local, solicita una decisión al coordinador y comunica el
  resultado. No decide el acceso de forma autónoma.
- **C2 — Coordinador o autoridad local**: unidad desplegable separada en el
  recinto. Es la única autoridad lógica de validación del evento; evalúa
  reglas y confirma durablemente consumo, decisión, idempotencia y outbox
  antes de devolver una aceptación.
- **D1 — Persistencia transaccional local**: almacena permisos, consumos,
  decisiones, idempotencia y outbox del coordinador.
- **C4 — Núcleo central**: monolito modular organizado en capas (API/
  presentación, aplicación, dominio, infraestructura), con los módulos de
  negocio M1 (configuración y permisos), M2 (ingesta de intentos y
  evidencia), M3 (conciliación) y M4 (contratación y liquidación).
- **C3 — Adaptador de boletería**: vive dentro del núcleo central, asociado
  a M1. No se implementa como microservicio independiente.
- **C5 — Panel de operación**: se sirve desde el núcleo central. No contiene
  reglas de autorización ni de liquidación.
- **D2 — Persistencia central**: PostgreSQL compartido, con repositorios y
  propietarios de escritura separados por módulo.

La nube o plataforma central **nunca** es una autoridad alternativa de
validación. Un lector aislado **tampoco** puede autorizar por sí mismo.

## Entorno local: Minikube

La primera implementación se despliega localmente en **Minikube**
(Kubernetes sobre Docker Desktop y WSL 2). Minikube es el entorno de
desarrollo, integración y demostración de NEXO — **no** está documentado
como un despliegue productivo definitivo.

## Estado actual

Los seis componentes (C1–C5, D1–D2) están implementados: el lector emulado
(`src/reader-client/`), el coordinador local con su persistencia
(`src/local-coordinator/`), el núcleo central con M1–M4 y el panel C5
(`src/central-core/`), la boletería simulada (`src/ticketing-sim/`), los
manifiestos de Minikube (`deploy/`), la observabilidad (`observability/`) y
`nexo-chaos` (`chaos/`). El hito M1 (login, panel con datos reales, V1 → D1 →
E1 → D2 → SSE) está en `main` y `npm run test:m1` lo verifica de punta a
punta. Los cuatro experimentos de fallos se ejecutaron en Minikube el
26-09-2026:

- F1 RED-01, corte C2→C4: aprobada;
- F2 SER-06, caída de observabilidad: aprobada con degradación prevista;
- F3 BD-01, D1 indisponible: aprobada con degradación prevista;
- F4 REC-01, CPU de C2: no concluyente.

Su análisis está en
[`docs/fault-experiments/`](docs/fault-experiments/README.md) y la evidencia,
en [`chaos/evidence/`](chaos/evidence/README.md). La vista `#/lector` del
panel solo muestra intentos registrados: la validación manual desde C5 es un
recorte (PR #33).

## Advertencia de seguridad

No se debe almacenar en este repositorio ningún secreto, credencial, token,
contraseña ni información personal (datos de boleto, QR completos, datos de
titulares, etc.). Los secretos se crean externamente al repositorio (ver
[config/README.md](config/README.md)).

## Árbol general del repositorio

```
nexo/
├── README.md
├── LICENSE-PENDING.md
├── .gitignore
├── .editorconfig
├── .gitattributes
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
│   ├── architecture/
│   │   └── contracts.md
│   ├── decisions/
│   ├── observability/
│   ├── fault-experiments/
│   └── evidence/
├── src/
│   ├── shared/
│   │   ├── contracts/
│   │   ├── domain/
│   │   └── telemetry/
│   ├── local-coordinator/
│   │   ├── api/
│   │   ├── application/
│   │   ├── domain/
│   │   └── infrastructure/
│   ├── central-core/
│   │   ├── api/
│   │   ├── application/
│   │   ├── domain/
│   │   ├── infrastructure/
│   │   ├── web/
│   │   └── modules/
│   │       └── <m>/
│   │           ├── domain/
│   │           ├── application/
│   │           ├── infrastructure/
│   │           └── api/
│   ├── reader-client/
│   └── ticketing-sim/
├── deploy/
│   ├── minikube/
│   ├── kubernetes/
│   │   ├── namespaces/
│   │   ├── application/
│   │   ├── data/
│   │   ├── observability/
│   │   └── chaos/
│   └── scripts/
├── observability/
│   ├── collector/
│   ├── dashboards/
│   ├── alerts/
│   ├── telemetry-contract/
│   └── synthetic-telemetry/
├── chaos/
│   ├── experiments/
│   │   ├── red-01-central-connection/
│   │   ├── ser-06-observability-outage/
│   │   ├── bd-01-local-persistence/
│   │   └── rec-01-coordinator-cpu/
│   ├── scripts/
│   └── evidence/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── load/
│   ├── resilience/
│   └── fixtures/
└── config/
    └── examples/
```

## Ejecución paso a paso

### Requisitos

- Node.js >= 24 y npm (`package.json` declara `engines.node: ">=24"`).
- Para el laboratorio completo en Kubernetes: Docker Desktop con WSL 2,
  Minikube, `kubectl` y Helm (ver [ADR-015](docs/decisions/ADR-015-laboratorio-local-minikube.md)
  y [deploy/minikube/README.md](deploy/minikube/README.md)). Perfil mínimo
  recomendado: `minikube start --driver=docker --cpus=4 --memory=8192`.
- Ningún secreto ni dato personal va en Git; las contraseñas de laboratorio
  se piden por variable de entorno (ver `config/examples/`).

### 1. Instalar dependencias y verificar el andamiaje

```sh
npm ci
npm run build      # typecheck de todos los workspaces
npm run lint
npm test           # pruebas unitarias (Vitest)
```

### 2. Entorno local con Docker Compose (hito M1)

`npm run dev` levanta D1, D2 y `otel-lgtm` con
`deploy/compose/docker-compose.dev.yml` (proyecto Compose `nexo-dev`,
compartido entre sesiones: nunca usar `down -v`), aplica migraciones y
semilla si ya existen, y arranca C4 (`central-core`) y C2
(`local-coordinator`) como procesos Node:

```sh
npm run dev
```

En otra terminal, arranca el lector emulado (C1) contra el C2 local:

```sh
npm run dev:reader
```

Para detener los procesos de Node con Ctrl+C basta; D1/D2/`otel-lgtm` siguen
corriendo hasta `npm run dev:down` (o `npm run dev:down -- --reset` para
borrar volúmenes).

Prueba de humo de punta a punta (V1 → D1 → E1 → D2 → SSE), con `npm run dev`
arriba:

```sh
npm run test:m1
```

Pruebas de integración completas (requieren Docker/Testcontainers):

```sh
npm run test:integration
```

### 3. Despliegue completo en Minikube

Con Minikube corriendo y los namespaces/observabilidad ya aplicados (ver
[deploy/minikube/README.md](deploy/minikube/README.md)):

```sh
node deploy/scripts/up.mjs     # o deploy/scripts/up.ps1 en PowerShell
```

Construye las 5 imágenes locales (`imagePullPolicy: Never`, sin registro),
crea los Secrets de laboratorio, aplica los manifiestos de
`deploy/kubernetes/{namespaces,data,application}` y ejecuta migraciones y
semilla. Otros scripts en [`deploy/scripts/`](deploy/scripts/README.md):

- `node --import tsx deploy/scripts/seed.ts` / `deploy/scripts/seed.ps1` —
  siembra D1/D2 (requiere `SEED_OPERATOR_PASSWORD`).
- `node deploy/scripts/load.mjs` / `load.ps1` — exporta boletas activas y
  corre el lector emulado como Job de carga (perfil `nominal`, 30 s).
- `node deploy/scripts/down.mjs` / `down.ps1` — retira Deployments/Jobs,
  conserva PVC y Secrets.
- `node deploy/scripts/reset.mjs --confirm` — como `down`, además borra PVC
  y Secrets (destruye datos).

### 4. Experimentos de fallos (`nexo-chaos`)

`chaos/scripts/nexo-chaos.ts` valida, planea, ejecuta y revierte los cuatro
experimentos de `chaos/experiments/` (RED-01, SER-06, BD-01, REC-01):

```sh
node chaos/scripts/nexo-chaos.ts validate chaos/experiments/red-01-central-connection/experiment.yaml
node chaos/scripts/nexo-chaos.ts plan chaos/experiments/red-01-central-connection/experiment.yaml
node chaos/scripts/nexo-chaos.ts run chaos/experiments/red-01-central-connection/experiment.yaml --confirm
node chaos/scripts/nexo-chaos.ts status
node chaos/scripts/nexo-chaos.ts restore
```

Ver [chaos/README.md](chaos/README.md) para el detalle de cada subcomando,
el watchdog de reversión (máx. 15 min) y el puerto de Toxiproxy requerido
para F1. Cada ejecución deja su registro en `chaos/evidence/`, y
`chaos/scripts/evidencias.ts` recolecta métricas, capturas e integridad
([chaos/evidence/README.md](chaos/evidence/README.md)).

### 5. Ver Grafana (dashboards y alertas)

Con el Collector y `otel-lgtm` desplegados en `nexo-observability`:

```sh
kubectl -n nexo-observability port-forward svc/nexo-otel-lgtm 3000:3000
```

Abrir `http://localhost:3000`. Los dashboards versionados están en
[`observability/dashboards/`](observability/dashboards/) (operación del
evento; sincronización y resiliencia) y las alertas en
[`observability/alerts/`](observability/alerts/); ver
[`docs/observability/`](docs/observability/README.md) para la
justificación de cada métrica.

## Estado y trazabilidad

- Decisiones de arquitectura y su estado: [`docs/decisions/`](docs/decisions/README.md).
- Resultados de F1–F4: [`docs/fault-experiments/`](docs/fault-experiments/README.md).
- Los enlaces de la documentación se verifican con
  `node scripts/check-links.mjs --code-paths docs README.md`.
