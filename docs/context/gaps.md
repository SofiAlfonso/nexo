# Gaps entre el repositorio `nexo` y el plan del taller 3

Comparación del 25 de septiembre de 2026 entre [taller3.md](taller3.md) y el estado real del repositorio `SofiAlfonso/nexo` (README en [main_README.md](main_README.md) y archivos de las ramas). Incluye las decisiones que hay que tomar antes de trabajar en paralelo y un plan de sesiones con worktrees.

## 1. Estado real del repositorio

| Rama | Contenido | Estado |
|---|---|---|
| `main` (`23753e9`) | Esqueleto: carpetas con `.gitkeep`, README por carpeta, `.gitignore`, `config/examples/secrets.example.env`. | Remota al día. |
| `feature/observability-chaos` (`3f4ad01`) | 5 archivos más: `deploy/kubernetes/namespaces/namespaces.yaml`, `observability/collector/values-local.yaml` (Collector por Helm, exportador `debug`), tres Jobs `telemetrygen` de humo en `observability/synthetic-telemetry/`. | Publicada en `origin`, sin fusionar en `main`. |
| `tolarteh-cautious-fishstick` | Worktree en `C:/Users/tolar/code/copilot-worktrees/nexo/`, en `23753e9` (igual a `main`). | Sin cambios propios. |

No hay código, `package.json`, Dockerfiles, manifiestos de aplicación, dashboards, alertas, pruebas ni ADR. Todos los commits son de una sola autora. En la máquina actual no están instalados Docker, Minikube, kubectl ni Helm (T01).

## 2. En qué ya coinciden

- Capas con monolito modular; C2 como unidad separada y única autoridad; C3 dentro de C4 en M1; C5 servido por C4; D2 en PostgreSQL con dueño de escritura por módulo; la nube nunca autoriza y el lector aislado no decide.
- Minikube sobre Docker Desktop y WSL 2 como entorno de desarrollo y demostración (D1 del plan).
- Los cuatro experimentos: `red-01-central-connection`, `ser-06-observability-outage`, `bd-01-local-persistence`, `rec-01-coordinator-cpu` (§3.1 del plan).
- Latencia de al menos 95 % en 300 ms con tardías y sin respuesta en el denominador (D11).
- Toxiproxy para red y límites de recursos de Kubernetes para CPU; `stress-ng` solo si se aprueba (recomendación 3).
- Secretos fuera del repositorio, creados como Kubernetes Secrets.

## 3. Gaps y decisión recomendada

Cada gap indica qué dice el repo, qué dice el plan y qué conviene hacer. Los marcados "Bloquea" deben resolverse en la ola 0 (sección 5), antes de abrir sesiones en paralelo.

| ID | Tema | Repositorio | Plan (taller3.md) | Recomendación | Bloquea |
|---|---|---|---|---|---|
| G01 | Namespaces | `nexo-application`, `nexo-data`, `nexo-observability`, `nexo-chaos` (por función). | `nexo-recinto`, `nexo-central`, `nexo-externo`, `nexo-obs` (por frontera de confianza). | Separar por ubicación, que es lo que prueba RED-01 y lo que dibuja NEXO_04: `nexo-venue` (C2, D1, lectores emulados), `nexo-central` (C4 con C3 y C5, D2), `nexo-external` (boletería simulada) y conservar `nexo-observability` y `nexo-chaos` (Toxiproxy y ejecuciones). Mantener nombres en inglés como el resto del repo. Las NetworkPolicy se escriben por namespace. | Sí |
| G02 | Motor de D1 | `secrets.example.env` tiene `LOCAL_DB_PATH`, lo que sugiere una base embebida en archivo. | PostgreSQL 16 en instancia separada (D3 del plan). | PostgreSQL en su propio StatefulSet en `nexo-venue`. Permite inyectar BD-01 sin tocar el proceso de C2 (escalar a 0 o bloquear el puerto), usa el mismo driver que D2 y es la candidata del taller 2. Cambiar la plantilla a `LOCAL_POSTGRES_HOST`, `_PORT`, `_DB`, `_USER`, `_PASSWORD`. | Sí |
| G03 | Métricas | Negocio: disponibilidad del flujo, consumos duplicados, completitud y pérdida de evidencia. Técnicas: latencia, pendientes (cantidad y edad), errores técnicos y sin respuesta. | Negocio: admisiones e ingreso, disponibilidad, falsos rechazos y duplicados. Técnicas: latencia, pendientes, edad del heartbeat. | Unir las dos listas para que cada fallo mueva al menos una métrica (ver tabla 3.1). N1 admisiones facturables e ingreso I(N); N2 disponibilidad del flujo; N3 integridad: consumos duplicados y pérdida de evidencia (tolerancia cero). T1 latencia; T2 pendientes, cantidad y edad del más antiguo; T3 errores técnicos y sin respuesta. La edad del heartbeat y los falsos rechazos pasan a métricas de apoyo, porque ninguno de los cuatro fallos las mueve. | Sí |
| G04 | Backend de telemetría | Exportación OTLP a Grafana Cloud; hoy solo exportador `debug`. | Backend en el clúster como principal, Grafana Cloud opcional (recomendación 2). | Collector con dos exportadores: `otlphttp` hacia `grafana/otel-lgtm` en `nexo-observability` (principal de la demo) y hacia Grafana Cloud solo si existe el Secret. Confirmar con el equipo, porque el repo asumía Grafana Cloud. | No |
| G05 | Cola persistente del Collector | El README la exige; `values-local.yaml` no la tiene (solo `memory_limiter` y `batch`). | Collector con `file_storage` y reintentos (T40). | Agregar la extensión `file_storage` con un PVC, `sending_queue.storage: file_storage` y `retry_on_failure` en los exportadores. Sin esto SER-06 no demuestra drenaje. | No |
| G06 | Mecanismo de SER-06 | Pendiente: detener el Collector o bloquear la exportación. | Escalar el Collector a 0 o cortar la exportación (T52). | Cortar la exportación (escalar `otel-lgtm` a 0 o un proxy de Toxiproxy delante): llena la cola persistente y deja ver el drenaje, que es la hipótesis de EXP 06 y del README. Detener el Collector queda como variante. | No |
| G07 | Estructura interna de C4 | Capas globales (`api/`, `application/`, `domain/`, `infrastructure/`) y `modules/` al mismo nivel, sin regla de cómo se combinan. | Matriz capas × módulos (T2 §4.2). | Cada módulo tiene sus capas: `modules/<modulo>/{domain,application,infrastructure,api}`. Las carpetas globales quedan para lo compartido: `api/` servidor HTTP y composición, `application/` sin lógica, `domain/` núcleo compartido (tipos de evento y cliente), `infrastructure/` conexión a D2 y telemetría. Una regla de ESLint impide importar el `infrastructure` de otro módulo. | Sí |
| G08 | Carpetas que el plan necesita y el repo no tiene | Solo `reader-client`, `local-coordinator`, `central-core`. | `src/central-core/web/` (C5), boletería simulada, paquete de dominio compartido. | Crear `src/central-core/web/`, `src/ticketing-sim/` (sistema externo de prueba) y `src/shared/` con `contracts/` (tipos y esquemas de V1, H1, E1, P1, P2, O2), `domain/` (motor de primer ingreso, usado por C2) y `telemetry/`. Actualizar el árbol del README. | Sí |
| G09 | Lenguaje y herramientas | "Stack tecnológico pendiente" en C1, C2 y C4. | TypeScript sobre Node 22, Fastify, `pg`, Vitest, `decimal.js` (D2). | Registrar en ADR-014 y dejar el andamiaje hecho (T02) antes de abrir sesiones. | Sí |
| G10 | Formato y numeración de ADR | Plantilla y numeración pendientes. | Formato de los ADR del taller 2; nuevos ADR-014 y ADR-015. | `docs/decisions/ADR-0NN-<tema>.md` con los campos del taller 2 (estado, fecha, contexto, decisión, alternativas, consecuencias, criterio para aceptar). Copiar un resumen de ADR-001 a ADR-013 para poder actualizar su estado con la PoC. | Sí |
| G11 | Contratos entre componentes | No existen; cada README los deja pendientes. | Borrador en §3.3 del plan y API de P §12. | Definirlos en código en la ola 0 (`src/shared/contracts/`, con fixtures JSON en `tests/fixtures/`) y documentarlos en `docs/architecture/contracts.md`. Es lo que permite que interfaz, lector, coordinador y núcleo avancen a la vez. | Sí |
| G12 | Contexto para las sesiones | El repo no tiene los documentos del curso ni instrucciones para agentes. | taller1.md, taller2.md, taller3.md, prototipo.md, DESIGN.md en la carpeta del taller. | Copiar `DESIGN.md` a la raíz, el resto a `docs/context/` y crear `AGENTS.md` (y `.github/copilot-instructions.md` apuntando a él) con reglas, invariantes y qué documento leer por tipo de tarea. | Sí |
| G13 | D3 archivo | No aparece en el README ni en la estructura. | MinIO, recortable. | No desplegar MinIO: tomar la alternativa de ADR-012 "retener los 90 días en PostgreSQL" y registrarlo. Ahorra un componente sin afectar ningún fallo. | No |
| G14 | Formato de manifiestos | Namespaces en YAML plano; Collector con valores de Helm. | Sin definir (T26). | Manifiestos de aplicación en YAML con Kustomize (`kubectl apply -k`, sin instalar nada extra); Helm solo para el Collector y `otel-lgtm` si se usa su chart. Instalar Helm en T01. | No |
| G15 | Imágenes locales | Estrategia pendiente en `deploy/minikube/`. | Dockerfiles multi-stage (T27). | Construir dentro de Minikube (`minikube image build` o `minikube -p minikube docker-env --shell powershell \| Invoke-Expression`) con `imagePullPolicy: Never`. Registrar digest en la configuración de NEXO_04 (T60). | No |
| G16 | Scripts | Se prevé PowerShell para Windows. | `nexo-chaos` en TypeScript con YAML (T50); scripts `up`, `down`, `seed`, `load`, `reset`. | `nexo-chaos` como CLI de Node en `chaos/scripts/` (portable) y envoltorios `.ps1` en `deploy/scripts/` y `chaos/scripts/` para Windows. Experimentos como `chaos/experiments/<id>/experiment.yaml`. | No |
| G17 | Generador de carga | "Generador de carga o solicitudes" en herramientas de caos; `tests/load/` vacío. | `reader-client` en modo emulado (D6). | `src/reader-client` es el lector y el generador; `tests/load/` guarda los perfiles (nominal, pico, estrés) que ese cliente ejecuta. | No |
| G18 | Certificados de mTLS | No previstos; los Secrets se crean a mano. | mTLS C1-C2 con CA de laboratorio (recomendación 5). | Script `deploy/scripts/new-lab-certs.ps1` que genera la CA y las credenciales por lector fuera del repositorio y crea los Secrets. | No |
| G19 | `.gitignore` demasiado amplio | `*secret*` y `*secrets*` ignoran cualquier archivo cuyo nombre contenga "secret". | | Riesgo para los agentes: `secret-ref.yaml`, `secrets.ts` o `lab-secrets.ps1` quedarían fuera sin aviso. Restringir a `*.secret.*`, `secrets/` y `*.pem`, `*.key`, `*.crt` fuera de `config/examples/`. | Sí |
| G20 | Errata | `src/central-core/README.md` dice `infraestructure/`; la carpeta es `infrastructure/`. | | Corregir. | No |
| G21 | Rama sin fusionar | `feature/observability-chaos` tiene el Collector y los namespaces fuera de `main`. | | Fusionarla (PR) antes de la ola 0, porque las sesiones nuevas parten de `main`. G01 y G05 la modifican después. | Sí |
| G22 | Integración continua | No hay workflows. | | Un workflow de GitHub Actions con `npm ci`, `npm run lint` y `npm test` en cada PR. Con varias sesiones en paralelo es lo que evita fusionar algo roto. | Sí |
| G23 | Herramientas locales | No están Docker, Minikube, kubectl ni Helm. | T01. | Instalar antes de la ola 2. Las sesiones de la ola 1 que solo corren pruebas unitarias no lo necesitan; las de integración usan Testcontainers o un `docker run postgres` propio. | Ola 2 |

### 3.1 Qué métrica mueve cada fallo (con G03)

| Fallo | N1 admisiones | N2 disponibilidad | N3 integridad | T1 latencia | T2 pendientes | T3 errores y sin respuesta |
|---|---|---|---|---|---|---|
| F1 RED-01, corte recinto-central | Sigue creciendo en D1; en D2 se congela y luego converge | Sin cambio | Debe quedar en 0 | Sin cambio | Crece y drena al volver | Sin cambio |
| F2 SER-06, caída de observabilidad | Sin cambio | Sin cambio | Debe quedar en 0 | Sin cambio (medido en el lector) | Sin cambio | Sin cambio; la cola del Collector crece y drena |
| F3 BD-01, D1 indisponible | Se detiene | Cae | Debe quedar en 0 | Sube hasta el plazo | Sin cambio | Sube ("sin confirmación") |
| F4 REC-01, CPU del coordinador | Más lenta | Puede caer | Debe quedar en 0 | Se degrada | Puede crecer | Sube si hay timeouts |

## 4. Cambios que esto implica en taller3.md

Pendientes de aplicar cuando el equipo confirme la sección 3:

- §2 y D1: namespaces de G01 y rutas de G08.
- D3: D1 en PostgreSQL (G02) y D3 retenido en D2 (G13).
- §3.2: métricas de G03 y la tabla 3.1.
- D4 y T40: cola persistente (G05) y exportadores (G04).
- T52: mecanismo de SER-06 (G06).
- T00 y T02: incluir G07, G10, G11, G12, G19, G21 y G22.
- T26 y T27: Kustomize e imágenes locales (G14, G15).

## 5. Trabajo en paralelo con sesiones y worktrees

### 5.1 Reglas

1. Una sesión, un worktree, una rama `t3/<ola>-<tema>` creada desde `main` después de fusionar la ola anterior. Cada sesión termina en un PR.
2. Cada sesión es dueña de sus rutas (tabla 5.2) y no edita las de otra. Los archivos compartidos (raíz `package.json`, `package-lock.json`, `AGENTS.md`, `README.md`, `docs/context/taller3.md`) solo los cambia la sesión base o la de integración.
3. Si una sesión necesita una dependencia nueva, la agrega en el `package.json` de su workspace y lo dice en el PR. El lockfile se regenera al fusionar (`npm install` en `main`), no se resuelve a mano.
4. Los contratos (`src/shared/contracts/`) no cambian en las olas 1 y 2 sin acuerdo; si una sesión necesita cambiarlos, abre un PR aparte que se fusiona primero.
5. Solo hay un clúster de Minikube en la máquina. Solo una sesión a la vez despliega en él (la de integración en la ola 3 y la de experimentos en la ola 4). Las demás usan pruebas unitarias y, para integración con base de datos, Testcontainers (puertos aleatorios, sin choques entre worktrees).
6. Cada worktree hace su propio `npm install`. Cerrar las sesiones terminadas para liberar disco.
7. El seguimiento del plan lo actualiza solo la sesión orquestadora con el resultado de cada PR.
8. Prompt de cada sesión: IDs de tareas, documentos a leer (solo los necesarios), rutas propias, contrato que aplica, criterio de aceptación y comandos de verificación.

### 5.2 Olas

Complejidad: A = orquestador, M = GPT-6 Sol, B = GPT-6 Luna (§4 del plan).

| Ola | Sesión | Rama | Cx | Tareas | Rutas propias | Lee | Depende de |
|---|---|---|---|---|---|---|---|
| 0 | Base | `t3/0-base` | A | Fusionar G21; G01, G02 (plantilla), G07, G08, G10 (ADR-014, ADR-015 y resumen 001-013), G11 contratos y fixtures, G12 contexto y `AGENTS.md`, G19, G20, G22; T02 andamiaje con todas las dependencias previstas | Todo el repositorio | taller3, taller2, prototipo §12 | — |
| 1 | Dominio | `t3/1-domain` | A | T10, luego T11 | `src/shared/domain/`, `tests/unit/domain/` | taller2 §2, §6, §9; prototipo §7 | Ola 0 |
| 1 | Datos | `t3/1-data` | M | T13, T14 | `src/local-coordinator/infrastructure/db/`, `src/central-core/infrastructure/db/`, `deploy/scripts/seed*`, `tests/integration/db/` | taller2 §2, §5.8; prototipo §6 | Ola 0 |
| 1 | Liquidación y boletería simulada | `t3/1-settlement` | B | T12; boletería simulada de T23 | `src/central-core/modules/contracting-settlement/domain/`, `src/ticketing-sim/`, `tests/unit/settlement/` | taller2 §9 (PB-15 a PB-24) | Ola 0 |
| 1 | Plataforma | `t3/1-platform` | M | T27, T26 (sin la aplicación), G05, G04 (`otel-lgtm`), G14, G15 | `deploy/`, `observability/collector/`, `*/Dockerfile` | taller3 D1, §3.1; gaps | Ola 0 y T01 |
| 1 | Interfaz | `t3/1-web` | M | T30 contra los fixtures de los contratos (modo sin backend), T32 | `src/central-core/web/` | prototipo, DESIGN | Ola 0 |
| 1 | Lector emulado | `t3/1-reader` | M | T24 con un servidor V1 de prueba | `src/reader-client/`, `tests/load/` | taller3 D6; taller2 §6, §10 | Ola 0 |
| 2 | Coordinador | `t3/2-coordinator` | A | T20, T21 (lado emisor) | `src/local-coordinator/` (salvo `infrastructure/db/`) | taller2 §4, §5.4, §6 | Dominio, Datos |
| 2 | Núcleo central | `t3/2-central` | M | T22, adaptador C3 de T23, receptor de E1 | `src/central-core/{api,application,domain,infrastructure,modules}` (salvo `infrastructure/db/` y liquidación) | taller2 §4, §5; prototipo §8, §9, §12 | Datos, Liquidación |
| 2 | Caos | `t3/2-chaos` | M | T50 | `chaos/` | taller2 §11; taller3 §3.1 | Plataforma |
| 2 | Dashboards y alertas | `t3/2-dashboards` | B | Borrador de T41 (paneles sobre los nombres del contrato de telemetría) y T42 | `observability/dashboards/`, `observability/alerts/`, `observability/telemetry-contract/` | taller2 §8; prototipo §15 | Ola 0 |
| 3 | Integración | `t3/3-integration` | A | Manifiestos de la aplicación (resto de T26), despliegue completo en Minikube, T21 de punta a punta | `deploy/kubernetes/application/`, raíz | taller3 | Ola 2 |
| 3 | Interfaz conectada | `t3/3-web-live` | M | T31 | `src/central-core/web/` | prototipo §5.5, §12 | Integración (API disponible) |
| 3 | Instrumentación | `t3/3-otel` | M | T40, T41 final | `src/shared/telemetry/` y los puntos de instrumentación | taller2 §8 | Coordinador, Núcleo |
| 3 | mTLS y pruebas de integridad | `t3/3-mtls` | M | T25, T55 | `src/reader-client/`, `src/local-coordinator/api/`, `deploy/scripts/new-lab-certs.ps1`, `tests/resilience/` | taller2 §5.7, §9 | Coordinador, Lector |
| 4 | Experimentos | `t3/4-experiments` | A | T43, T51 a T54, T57 | `chaos/experiments/`, `docs/fault-experiments/`, `docs/observability/` | taller2 §11; taller3 §3 | Ola 3 |
| 4 | Evidencias | `t3/4-evidence` | B | T56 | `chaos/evidence/`, `docs/evidence/` | taller3 T56 | Cada experimento |
| 5 | Documentación | `t3/5-docs` | A, M, B | T60 y T62 (A), T61 (M), T63 y T64 (B) | `docs/`, `README.md` | todo | Ola 4 |

Paralelismo máximo: 6 sesiones en la ola 1 y 4 en la ola 2. Las olas 0, 3 (integración) y 4 son cuellos de botella de una sola sesión por diseño: la ola 0 fija lo que las demás comparten y la 4 usa el único clúster.

Conflictos que hay que vigilar:

- Núcleo central (ola 2) y liquidación (ola 1) comparten `modules/contracting-settlement/`: la ola 1 solo escribe `domain/`; la ola 2, el resto.
- Instrumentación (ola 3) toca archivos de coordinador y núcleo: se abre después de fusionar ambos y en una sola sesión.
- mTLS (ola 3) toca `reader-client` y `local-coordinator/api/`: no se abre en paralelo con otra sesión que edite esas rutas.

### 5.3 Checklist de la ola 0

- [ ] Instalar Docker Desktop, Minikube, kubectl y Helm (T01).
- [ ] Confirmar con el equipo G01, G02, G03, G04 y G07.
- [ ] Fusionar `feature/observability-chaos` en `main`.
- [ ] Crear `t3/0-base` y aplicar los gaps marcados "Bloquea".
- [ ] Verificar: `npm ci`, `npm run lint`, `npm test` en verde localmente y en Actions; `kubectl apply -f deploy/kubernetes/namespaces/` crea los cinco namespaces.
- [ ] Fusionar y abrir las seis sesiones de la ola 1 desde el nuevo `main`.
