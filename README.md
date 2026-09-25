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

El repositorio cuenta con el andamiaje TypeScript y los workspaces npm
`@nexo/shared`, `@nexo/local-coordinator`, `@nexo/central-core`,
`@nexo/reader-client` y `@nexo/ticketing-sim`. Los contratos V1/H1/E1/P1/P2/O2/Auth
están en `src/shared/contracts/` junto con sus fixtures, y CI está configurado.
La implementación de los componentes está en curso (taller 3).

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

## Desarrollo

Requisitos: Node.js >= 24 y npm.

```sh
npm ci
npm run build
npm run lint
npm test
npm run test:integration
npm run dev
```

`npm run build` ejecuta el typecheck de todos los workspaces.
`npm run test:integration` requiere Docker y usa Testcontainers.
`npm run dev` es un placeholder hasta M1.

## Próximos pasos

Los siguientes pasos aún **no** están implementados y requieren instrucción
explícita para comenzar:

- Definir y documentar decisiones de arquitectura (ADRs) en `docs/decisions/`.
- Implementar el cliente de puerta (`src/reader-client/`).
- Implementar el coordinador local y su persistencia (`src/local-coordinator/`).
- Implementar el núcleo central por capas y módulos (`src/central-core/`).
- Crear manifiestos/charts de Kubernetes y scripts de Minikube (`deploy/`).
- Configurar el Collector de OpenTelemetry y los dashboards/alertas
  (`observability/`).
- Implementar los cuatro experimentos de fallos iniciales (`chaos/`).
- Añadir pruebas unitarias, de integración, de carga y de resiliencia
  (`tests/`).
