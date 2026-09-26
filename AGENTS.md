# AGENTS.md — instrucciones para agentes en NEXO

NEXO es el control de acceso B2B para estadios del curso ST1625 (taller 3: implementación, observabilidad y análisis de fallos). Este archivo es la referencia común para cualquier agente (Copilot CLI, sesiones paralelas, subagentes) que trabaje en el repositorio.

## Propósito

Construir una PoC local, en contenedores, que reproduzca la arquitectura del taller 2: C1 lector de puerta, C2 coordinador local (con D1), C4 núcleo central (monolito modular con M1–M4, C3 dentro de M1 y C5 servido por C4) y D2 PostgreSQL compartido. La interfaz C5 es el prototipo del entregable 07 conectado a datos reales, sin simulador.

## Invariantes (no negociables)

1. **C2 es la única autoridad** de validación del recinto. Ninguna otra pieza decide un ingreso.
2. **El lector no decide**: un lector aislado de C2 no autoriza; responde "sin confirmación".
3. **La nube nunca autoriza**: C4 recibe evidencia y distribuye permisos, pero no es autoridad alternativa.
4. **Consumo único** garantizado por restricción `UNIQUE` en D1, no por lógica en memoria.
5. **Idempotencia por `idOrigen`**: el mismo `idOrigen` con el mismo contenido devuelve la decisión original; con contenido distinto es error de integridad.
6. **Bitácora solo adición**: no hay `UPDATE` ni `DELETE` sobre registros de auditoría.
7. **Outbox transaccional**: la decisión y su fila de outbox se escriben en la misma transacción de D1; el envío a C4 (E1) es asíncrono e idempotente.
8. **Sin secretos ni datos personales** en Git. Solo plantillas en `config/examples/`; los secretos reales son Kubernetes Secrets o variables locales.

## Stack

- TypeScript en todo, **Node 24 LTS** (`engines >=24`, imagen `node:24-alpine`, CI en 24). Ver [ADR-014](docs/decisions/ADR-014-runtime-typescript-node-24.md).
- npm workspaces, Fastify, `pg`, Vitest, zod, `decimal.js` para importes, argon2 para contraseñas.
- D1 y D2 en PostgreSQL 16, instancias separadas.
- OpenTelemetry SDK → Collector (cola `file_storage`) → `grafana/otel-lgtm` local; Grafana Cloud opcional.
- Laboratorio en Minikube con Kustomize ([ADR-015](docs/decisions/ADR-015-laboratorio-local-minikube.md)); Docker Compose solo para `npm run dev`.
- Namespaces: `nexo-venue`, `nexo-central`, `nexo-external`, `nexo-observability`, `nexo-chaos`.

## Estructura (G07/G08)

```text
src/
├── shared/
│   ├── contracts/     tipos y esquemas zod de V1, H1, E1, P1, P2, O2 (solo cambian vía la orquestadora)
│   ├── domain/        motor de primer ingreso usado por C2
│   └── telemetry/     inicialización OTel compartida
├── reader-client/     C1 y lector emulado (generador de carga)
├── local-coordinator/ C2; infrastructure/db/ = D1
├── central-core/      C4
│   ├── api/ application/ domain/ infrastructure/   solo lo compartido (servidor, D2, telemetría)
│   ├── modules/<modulo>/{domain,application,infrastructure,api}
│   └── web/           C5 (prototipo portado, servido por C4)
└── ticketing-sim/     boletería simulada (sistema externo de prueba)
tests/{unit,integration,load,resilience,fixtures}/
deploy/{compose,minikube,kubernetes,scripts}/   observability/   chaos/   config/examples/
docs/{context,decisions,architecture,observability,fault-experiments,evidence}/
```

Un módulo no importa el `infrastructure/` de otro módulo (regla de ESLint).

## Flujo de trabajo

El hito M1 ya se cumplió (login, panel con datos reales, V1 → D1 → E1 → D2 → SSE y `npm run dev`). Desde entonces **no se hace push directo a `main`**:

```powershell
git fetch origin; git rebase origin/main
npm ci; npm run lint; npm test
git push -u origin HEAD
gh pr create --base main --fill
```

- Una rama por tarea o funcionalidad (la rama del worktree de la sesión). PR contra `main` con CI verde (`npm ci`, `npm run lint`, `npm test`); se integra con *squash* cuando CI pasa y no hay conflictos.
- Antes de abrir o actualizar el PR, rebasa sobre `origin/main`. Si otro PR ya integró algo que choca, resuelve el conflicto en tu rama.
- Cada sesión solo edita sus rutas propias. Quien rompe `main` lo arregla primero.
- Una dependencia nueva se agrega al `package.json` del workspace propio; el cambio de `package-lock.json` va en el mismo PR y en un commit aparte.
- Commits pequeños, Conventional Commits en inglés, con el trailer `Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>`.
- `npm run test:m1` (con `npm run dev` arriba) es la prueba de humo de punta a punta; no la rompas.

**Producto**: la aplicación va a producción. C5 puede tener bienvenida, ayuda o tutorial, pero **no simulación** en la interfaz ni datos inventados. El modo `?fixtures` es solo para desarrollo y no debe activarse contra un backend real.

**Entorno compartido** (varias sesiones en la misma máquina):

- Docker Desktop y Minikube son compartidos: no reinicies Docker, no ejecutes `wsl --shutdown`, `minikube stop` ni `minikube delete`.
- El proyecto Compose `nexo-dev` (D1 `5433`, D2 `5434`, `otel-lgtm`) es compartido: nunca `down -v` ni borrar sus volúmenes. Las pruebas automáticas usan Testcontainers; para un stack propio usa `docker compose -p nexo-<sesion>` con otros puertos.
- Los puertos `8080` (C4), `8081` (C2) y `8082` (boletería) del `npm run dev` compartido los usa una sola sesión a la vez; para pruebas propias levanta los servicios en otros puertos (`CENTRAL_PORT`, `COORDINATOR_PORT`, `TICKETING_PORT`).
- En el clúster, cada sesión despliega solo en los namespaces de su tarea; los experimentos de caos (F1–F4) se ejecutan de uno en uno.

## Qué leer según la tarea

| Tarea | Documento |
|---|---|
| Visión, alcance, tarifa, KR, controles CA1–CA4 | [docs/context/taller1.md](docs/context/taller1.md) |
| Dominio, ADR originales, arquitectura, secuencias, observabilidad, pruebas, fallos | [docs/context/taller2.md](docs/context/taller2.md) |
| Escenarios F1–F4: hipótesis, umbrales y resultados | [docs/fault-experiments/](docs/fault-experiments/README.md) |
| Métricas obligatorias y su justificación | [docs/observability/](docs/observability/README.md) |
| Interfaz C5, API O2, métricas de la interfaz | [docs/context/prototipo.md](docs/context/prototipo.md) y [DESIGN.md](DESIGN.md) |
| Decisiones vigentes | [docs/decisions/](docs/decisions/README.md) |
| Contratos entre componentes | `docs/architecture/contracts.md` y `src/shared/contracts/` |

Lee solo lo que la tarea necesita. Si una decisión cambia, actualiza o crea el ADR correspondiente.
