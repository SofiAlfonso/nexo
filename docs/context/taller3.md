# Taller 3: plan de implementación y seguimiento de NEXO

Documento vivo: define el plan del entregable 3 y registra su avance. Solo el agente orquestador actualiza las tablas de seguimiento; los subagentes reportan su resultado y el orquestador lo consolida, para evitar ediciones concurrentes.

Última actualización: 25 de septiembre de 2026. Estado general: decisiones D1 a D12 cerradas con el equipo (Q1 a Q16 de la orquestación) y gaps de [gaps.md](gaps.md) §4 aplicados; ADR vigentes en [docs/decisions/](../decisions/README.md). Ejecución en sesiones paralelas (§3.5) con el hito M1 como primera meta (§3.4).

Contexto completo, autocontenido:

- [taller1.md](taller1.md): caso de negocio (premisas, alcance, piloto, tarifa, KR y controles CA1 a CA4).
- [taller2.md](taller2.md): entregables arquitectónicos (dominio, ADR-001 a ADR-013, arquitectura de referencia e implementación, clases y secuencia, prototipo, observabilidad, pruebas, volumetría y fallos).
- [prototipo.md](prototipo.md): especificación detallada del prototipo de interfaz (roles, armazón, componentes, pantallas, estado, incidentes, conciliación, API que necesita, bloqueos, invariantes, reglas de medición y supuestos). Solo la necesitan las tareas de interfaz (T30 a T32), las que definen la API O2 (T22) y las de métricas (T41, P §15).
- [DESIGN.md](../../DESIGN.md): sistema de diseño del panel (tokens de color, tipografía, espaciado, sombras, componentes, patrones de pantalla, accesibilidad y reglas de estilo). Lo usan T30 a T32 y cualquier tarea que cree o cambie interfaz.

Las referencias "T2 §n" de este documento remiten a la sección n de [taller2.md](taller2.md), "T1 §n" a la de [taller1.md](taller1.md) y "P §n" a la de [prototipo.md](prototipo.md).

## 1. Rúbrica del entregable 3

| Criterio | Peso | Qué debe existir |
|---|---|---|
| Aplicación funcionando | 40 % | Funcionalidades principales operativas, despliegue en el entorno definido, experiencia estable, evidencias (video, accesos, ejemplos). |
| Observabilidad | 20 % | 3 métricas de negocio y 3 técnicas funcionando de forma real, justificadas; recolección y visualización en tiempo real; dashboards, logs, trazas y alertas. |
| Simulación y análisis de fallos | 30 % | 4 escenarios de fallo de tipos diferentes; análisis de métricas, recuperación y degradación; conclusiones; scripts, registros y capturas. |
| Patrones utilizados | 10 % | Patrones identificados y justificados, relacionados con atributos de calidad, con evidencia en código y documentación. |
| Autoevaluación | +10 % | Reflexión con logros, dificultades y propuestas de evolución, coherente con la evidencia. |
| Coherencia | hasta -10 % | Lo desplegado coincide con ADR, supuestos, alcance y entregables previos; ADR actualizados si algo cambia; entregables del taller 2 presentes y consistentes (por ejemplo, ejecución de pruebas unitarias). |

Nota = (puntos base 0 a 100 + adicionales 0 a 10 - descuento 0 a 10) × 30 %.

Condiciones del equipo para esta entrega:

- La coherencia con el taller 2 es prioritaria, en especial con los ADR (T2 §3), la arquitectura de implementación (T2 §5) y el prototipo de interfaz (T2 §7).
- El simulador del prototipo (T2 §7.4) no se recrea: la interfaz debe mostrar la carga que está en las bases de datos.
- No hay despliegue en nube por ahora. El entorno local debe reproducir las capas y módulos en contenedores como se desplegarían después, y permitir el análisis de fallos.
- Presupuesto: 12 horas de trabajo con IA.

## 2. Repositorio

Repositorio `nexo` (hoy un cascarón sin implementación funcional). Su README ya fija:

- Arquitectura por capas con monolito modular central, no microservicios (ADR-001).
- C1 cliente de puerta, C2 coordinador local como unidad desplegable separada, D1 persistencia local, C4 núcleo central con M1 a M4, C3 dentro de C4 asociado a M1, C5 servido desde C4, D2 PostgreSQL compartido con propietarios de escritura por módulo. Coincide con T2 §5.1.
- La nube nunca es autoridad alternativa y un lector aislado no autoriza.
- Entorno local: Minikube (Kubernetes sobre Docker Desktop y WSL 2), documentado como entorno de desarrollo, integración y demostración, no como despliegue productivo.
- Cuatro experimentos de fallo iniciales: `red-01-central-connection`, `ser-06-observability-outage`, `bd-01-local-persistence`, `rec-01-coordinator-cpu`.
- Sin secretos ni datos personales en el repositorio.

Estructura existente:

```text
nexo/
├── docs/{architecture,decisions,observability,fault-experiments,evidence}/
├── src/
│   ├── reader-client/            C1
│   ├── local-coordinator/        C2 y D1
│   └── central-core/             C4 (incluye C3 y sirve C5)
│       ├── api/  application/  domain/  infrastructure/
│       └── modules/{configuration-permissions, evidence-ingestion, reconciliation, contracting-settlement}/
├── deploy/{minikube, kubernetes/{namespaces,application,data,observability,chaos}, scripts}/
├── observability/{collector,dashboards,alerts,telemetry-contract,synthetic-telemetry}/
├── chaos/{experiments/{red-01-…,ser-06-…,bd-01-…,rec-01-…}, scripts, evidence}/
├── tests/{unit,integration,load,resilience}/
└── config/examples/
```

Este plan usa esa estructura con dos ajustes (G07 y G08 de [gaps.md](gaps.md)):

- Cada módulo de C4 tiene sus capas: `modules/<modulo>/{domain,application,infrastructure,api}`. Las carpetas globales de `central-core/` quedan para lo compartido: `api/` servidor HTTP y composición, `application/` sin lógica, `domain/` núcleo compartido, `infrastructure/` conexión a D2 y telemetría. Una regla de ESLint impide importar el `infrastructure/` de otro módulo.
- Rutas nuevas: `src/central-core/web/` para el panel C5 portado del prototipo, `src/ticketing-sim/` para la boletería simulada (sistema externo de prueba, fuera de C4) y `src/shared/` con `contracts/` (tipos y esquemas de V1, H1, E1, P1, P2, O2, con fixtures en `tests/fixtures/` y documentación en `docs/architecture/contracts.md`), `domain/` (motor de primer ingreso, usado por C2) y `telemetry/`. También `deploy/compose/` para el entorno de desarrollo de `npm run dev`.

## 3. Decisiones de partida

Cerradas con el equipo el 25 de septiembre de 2026 (Q1 a Q16 de la orquestación). Cada una queda registrada en un ADR nuevo o en la actualización de uno existente (`docs/decisions/`).

| ID | Decisión | Motivo | Estado |
|---|---|---|---|
| D1 | Minikube con namespaces por frontera de confianza (G01): `nexo-venue` (C2, D1, lectores emulados), `nexo-central` (C4 con C3 y C5, D2), `nexo-external` (boletería simulada), `nexo-observability` (Collector y `otel-lgtm`) y `nexo-chaos` (Toxiproxy y ejecuciones de `nexo-chaos`). NetworkPolicies que solo permiten el tráfico de T2 §5.2: recinto a central saliente (E1, P2), lectores a C2 (V1, H1), C4 a D2. Toxiproxy como pod intermedio en el enlace recinto-central y en C3-boletería. Manifiestos con Kustomize; Helm solo para el Collector y `otel-lgtm` (G14). Imágenes construidas dentro de Minikube con `imagePullPolicy: Never` (G15). Docker Compose solo para `npm run dev` y el hito M1. | Ya fijado en el README del repo. Reproduce las fronteras de NEXO_04 y deja el despliegue listo para una nube con Kubernetes. Cambia el entorno del laboratorio de fallos, que el entregable 11 proponía sobre Docker Compose (T2 §11.2). | Decidido: ADR-015 |
| D2 | TypeScript sobre **Node.js 24 LTS** (`engines >=24`, `node:24-alpine`, CI en 24) para C1, C2, C4, el adaptador de C5 y `nexo-chaos`; npm workspaces, Fastify, `pg`, Vitest, zod, argon2 y `decimal.js` para importes (PB-18 exige decimal). | Runtime y lenguaje seguían pendientes (T2 §5.9, §9). El prototipo ya es JavaScript y el SDK de OpenTelemetry para Node cubre trazas, métricas y logs. Node 22 se descarta por estar en mantenimiento (fin de vida en abril de 2027). Alternativas: Go, Java con Spring Boot. | Decidido: ADR-014 |
| D3 | D1 y D2 en PostgreSQL 16, instancias separadas (StatefulSet con volumen persistente); D1 en `nexo-venue` (G02; la plantilla de secretos usa `LOCAL_POSTGRES_HOST`, `_PORT`, `_DB`, `_USER`, `_PASSWORD`). Sin MinIO: D3 se reemplaza por retener los 90 días en D2 (G13). Autoridad local en `nodo-unico`, como en la configuración de NEXO_04 (T2 §5.3). | PostgreSQL es premisa para D2 y candidata para D1 (T2 §4.7); en un StatefulSet propio permite inyectar BD-01 sin tocar el proceso de C2. `nodo-unico` deja fuera RED-06, BD-06 y EXP 07 (condicionados a ADR-005) y se refleja en el prototipo, que muestra réplica (T2 §7.5, D9). | Decidido: ADR-005, ADR-012 actualizado |
| D4 | OpenTelemetry SDK en C1, C2, C4 y C5 hacia un Collector con cola persistente (`file_storage` en un PVC, `sending_queue.storage` y `retry_on_failure`, G05). El Collector exporta por `otlphttp` a `grafana/otel-lgtm` en `nexo-observability` (principal) y a Grafana Cloud Free solo si existe el Secret (G04). | Coincide con T2 §8.1 (Collector local, Grafana Cloud Free en PoC) y permite la demo sin internet y sin secretos. El backend local es la variante de laboratorio de ADR-013. | Decidido: ADR-013 actualizado |
| D5 | El panel C5 es el prototipo portado a `src/central-core/web/` y servido por C4, con `simulador.js` reemplazado por un adaptador `api.js` que llena el mismo `store` por REST y SSE. Los incidentes salen de reglas en C4 sobre datos reales: heartbeat de más de 60 s, enlace del recinto caído, latencia fuera de umbral, Collector caído. | La rúbrica penaliza que la interfaz no corresponda con el prototipo. Mantener vistas y CSS limita el trabajo al adaptador. Se eliminan el guion de incidentes, los saltos de reloj y el personal simulado. | Decidido |
| D6 | La carga la produce `reader-client` en modo emulado: N lectores con credencial propia, diario durable, `idOrigen` estable, heartbeat cada 10 s y perfiles de T2 §10 (nominal, pico, estrés) guardados en `tests/load/` (G17). Cada intento lleva su resultado esperado, que sirve de referencia independiente para falsos rechazos y de contador independiente para la conciliación. | Así la carga pasa por C2 y queda persistida en D1 y D2, que es lo que el panel lee. Un generador HTTP genérico no tiene diario ni heartbeat. | Decidido |
| D7 | Latencia: se mide la proporción de validaciones en 300 ms o menos (SLO de T2 §8.2, al menos 95 %) y se reporta también el p95 frente a los 500 ms de CA2 y ADR-002. | T2 §8.2 declara que 300 ms sustituye a 500 ms; mostrar ambos evita una contradicción con ADR-002 y con el prototipo. | Decidido |
| D8 | Seguridad mínima: mTLS entre C1 y C2 con CA de laboratorio y credencial revocable por lector (ADR-008, PB-14; certificados con `deploy/scripts/new-lab-certs.ps1`, G18). RLS en D2 **no** se implementa: ADR-009 queda "pendiente de PoC, recortada". Operadores del panel con usuario y contraseña por cada uno de los 5 roles del prototipo, sembrados en D2 con hash argon2 y sesión en cookie firmada; el rol sale del usuario. `identidadOperadores` queda como PoC local. | Son baratos de demostrar con un recinto. Con un solo cliente en la semilla, RLS no demuestra nada visible. El login reemplaza el selector de rol del prototipo y deja autor real en D2. | Decidido: ADR-008, ADR-009 actualizado, ADR-016 |

### 3.1 Escenarios de fallo

Los cuatro del README del repo, uno por cada dimensión del catálogo de T2 §11.1:

| ID | Tipo | Escenario | Experimento | Inyección en Minikube | Hipótesis a verificar |
|---|---|---|---|---|---|
| F1 | Red | RED-01: corte entre recinto y central | EXP 01 | `nexo-chaos` deshabilita el proxy Toxiproxy recinto-central durante 5 min en la demo y 15 min en la corrida de evidencia (CA1). | Las validaciones siguen en C2; el outbox crece; el panel marca la antigüedad de los datos del recinto (SER-05); al volver se drena al menos el 99,5 % en 5 min; cero pérdidas y cero duplicados. |
| F2 | Servicio | SER-06: caída de observabilidad | EXP 06 | Cortar la exportación del Collector durante 15 min (escalar `otel-lgtm` a 0 o un proxy de Toxiproxy delante, G06); detener el Collector queda como variante. | La validación y la auditoría no se interrumpen; T1 sigue en objetivo según el contador de `reader-client`; la cola persistente retiene y luego drena; la alerta de pérdida de visibilidad se dispara. |
| F3 | Base de datos | BD-01: persistencia local indisponible | Nuevo, derivado de BD-01 y EXP 05 | Escalar el StatefulSet de D1 a 0 o bloquear su puerto con NetworkPolicy durante 2 min con carga nominal. | Ninguna aceptación nueva; C2 responde "sin confirmación" (PU-03-07, PB-12); los lectores no abren; al volver D1, los consumos previos están íntegros y los reintentos con el mismo `idOrigen` no duplican. |
| F4 | Recursos | REC-01: saturación de CPU del coordinador | Nuevo, derivado de REC-01 y del escenario de estrés | `stress-ng` en un contenedor auxiliar del pod de C2, o reducir `resources.limits.cpu`, durante el perfil pico. | La latencia se degrada y se ve en dashboard y alerta; las solicitudes sin respuesta permanecen en el denominador; la integridad de consumos no cambia. |

Pruebas de integridad complementarias, fuera de los cuatro fallos pero exigidas por CA3 y ADR-003: EXP 03 (reintento tras caída del coordinador, SER-01 con BD-03) y EXP 04 (500 boletas con dos solicitudes simultáneas). Se ejecutan en `tests/resilience/`.

### 3.2 Métricas (3 de negocio y 3 técnicas)

Unificadas con las del README del repo (G03) para que cada fallo mueva al menos una métrica.

| ID | Tipo | Métrica | Cálculo | Umbral | Origen |
|---|---|---|---|---|---|
| N1 | Negocio | Admisiones registradas e ingreso facturable | Primeros consumos aceptados por evento; I(N) = 500 + 0,40 N | Informativa, conciliada al cierre | T1 §5.1, KR5.1, RN-04, RN-09 |
| N2 | Negocio | Disponibilidad del flujo de validación | Decisiones definitivas / solicitudes del lector, incluidos timeouts y "sin confirmación" | ≥ 99,9 % | T2 §8.2, CA2 |
| N3 | Negocio | Integridad | Boletas con más de un consumo y registros de evidencia perdidos entre D1 y D2 | 0 y 0 | ADR-003, ADR-004, ADR-011, alertas A1 |
| T1 | Técnica | Latencia de validación | Respuestas en 300 ms o menos / solicitudes, con tardías y sin respuesta en el denominador; p95 | ≥ 95 %; p95 ≤ 500 ms | T2 §8.2, CA2, ADR-002 |
| T2 | Técnica | Pendientes de sincronización | Filas del outbox sin confirmar, edad del más antiguo y proporción drenada en 5 min | ≥ 99,5 % en 5 min | KR2.1, ADR-011, alertas A10 y A11 |
| T3 | Técnica | Errores técnicos y sin respuesta | Respuestas "sin confirmación", timeouts y errores técnicos / solicitudes | Informativa; alerta si supera el presupuesto de N2 | T2 §8.2, PU-03-07, PB-12 |

Se muestran también, sin contarlas entre las seis: edad del último heartbeat por punto (≤ 60 s para marcar "sin comunicación", KR1.2, alerta A8), falsos rechazos según `reader-client` (≤ 0,5 %, KR4.1), visibilidad en 5 s, evidencia completa, rechazos por motivo y ocupación de la cola del Collector. El heartbeat y los falsos rechazos pasan a apoyo porque ninguno de los cuatro fallos los mueve.

Qué métrica mueve cada fallo:

| Fallo | N1 admisiones | N2 disponibilidad | N3 integridad | T1 latencia | T2 pendientes | T3 errores y sin respuesta |
|---|---|---|---|---|---|---|
| F1 RED-01, corte recinto-central | Sigue creciendo en D1; en D2 se congela y luego converge | Sin cambio | Debe quedar en 0 | Sin cambio | Crece y drena al volver | Sin cambio |
| F2 SER-06, caída de observabilidad | Sin cambio | Sin cambio | Debe quedar en 0 | Sin cambio (medido en el lector) | Sin cambio | Sin cambio; la cola del Collector crece y drena |
| F3 BD-01, D1 indisponible | Se detiene | Cae | Debe quedar en 0 | Sube hasta el plazo | Sin cambio | Sube ("sin confirmación") |
| F4 REC-01, CPU del coordinador | Más lenta | Puede caer | Debe quedar en 0 | Se degrada | Puede crecer | Sube si hay timeouts |

### 3.3 Contratos iniciales

Borrador para que los agentes trabajen en paralelo. Lo cierra T00 y lo mantiene T20. Semántica en T2 §4.3 y §5.4.

- V1, C1 a C2: `POST /v1/validaciones` con `{ idOrigen, lectorId, puntoId, codigo, proposito, zonaSolicitada, instanteLector }`; responde `{ decision: aceptado | rechazado | sin-respuesta, motivo, idOrigen, versionPermisos }`. Mismo `idOrigen` y contenido devuelve la decisión original; distinto contenido, error de integridad (PB-04).
- H1, C1 a C2: `POST /v1/heartbeats` y `POST /v1/diario/lotes`.
- E1, C2 a C4: `POST /v1/lotes-evidencia` con hasta 100 registros (`loteEvidenciaMax`), idempotente por `idOrigen` y por identificador de lote.
- P2, C4 a C2: `GET /v1/permisos?desdeVersion=n`, solicitado por el recinto, con firma del contenido.
- P1, boletería simulada a C3: `GET /versiones` y `GET /versiones/{n}` en JSON; C3 traduce al modelo canónico dentro de M1.
- O2, panel a C4: inicio y cierre de sesión de operador (ADR-016; rutas exactas en el contrato de autenticación de `src/shared/contracts/`), `GET /api/eventos/actual/estado`, `GET /api/puntos`, `GET /api/puntos/{id}`, `GET /api/incidentes`, `GET /api/incidentes/{id}`, `POST /api/incidentes/{id}/acciones`, `POST /api/cierre/preliminar`, `POST /api/cierre/definitivo`, `GET /api/stream` (SSE).

Los contratos viven en código en `src/shared/contracts/` (esquemas zod), con fixtures en `tests/fixtures/` y documentación en `docs/architecture/contracts.md` (G11). Solo cambian pidiéndolo a la orquestadora.

### 3.4 Hito M1

Primera meta de la ejecución: una rebanada vertical que atraviesa todas las capas. M1 se cumple cuando:

1. El panel exige login con usuario y contraseña de laboratorio (ADR-016).
2. El panel muestra el resumen y `#/puertas` con datos reales de D2.
3. Un lector emulado valida en C2 y la decisión queda en D1.
4. La evidencia llega a D2 por el outbox (E1) y se ve en el panel por SSE.
5. `npm run dev` levanta todo en local con PostgreSQL en Docker Compose, sin Minikube.

Lo que no forma parte de M1 arranca después de declararlo.

### 3.5 Modelo de trabajo en sesiones

- Una sesión orquestadora crea las sesiones de trabajo (una por worktree), les entrega prompts autocontenidos, arbitra los contratos y es la única que actualiza las tablas de seguimiento de este documento.
- Cada sesión tiene un líder que reparte su alcance entre 2 a 4 subagentes con archivos disjuntos, integra, verifica y publica. Las rutas de cada sesión son exclusivas.
- Hasta M1, trunk en `main`: `git fetch origin`, `git rebase origin/main`, `npm run lint` y `npm test` locales y `git push origin HEAD:main`. Quien rompe `main` lo arregla primero. Después de M1, ramas de funcionalidad y PR con CI.
- `package.json` raíz y lockfile los cambia solo la sesión base; una dependencia nueva se agrega al workspace propio y el lockfile va en un commit aparte.
- Olas: 0 base (S0-base, S0-docs, S0-platform); 1 hito M1 (coordinador, datos, núcleo central, interfaz, lector, plataforma); después de M1, liquidación y boletería, mTLS, manifiestos de Minikube, instrumentación, dashboards y alertas, `nexo-chaos`, integridad, resto del panel; luego experimentos F1 a F4 en serie sobre el único clúster, evidencias y documentación. Reglas y conductas para agentes en [AGENTS.md](../../AGENTS.md).

## 4. Asignación por complejidad

| Complejidad | Quién la ejecuta | Criterio |
|---|---|---|
| Alta (A) | Agente orquestador | Decisiones de arquitectura, lógica que sostiene invariantes de los ADR (consumo único, idempotencia, outbox), diseño y análisis de fallos, coherencia con el taller 2. |
| Media (M) | Subagentes GPT-6 Sol (`gpt-6-sol`) | Componentes completos con contrato definido: servicios, interfaz, observabilidad, manifiestos, herramienta de caos, esquema de datos. |
| Baja (B) | Subagentes GPT-6 Luna (`gpt-6-luna`) | Tareas acotadas y verificables: andamiaje, Dockerfiles, datos semilla, pruebas con especificación cerrada, alertas, capturas, README, revisión de estilo. |

Reglas para delegar:

1. Cada subagente recibe el ID de la tarea, las secciones de [taller1.md](taller1.md) o [taller2.md](taller2.md) que debe leer, el contrato de la §3.3 que le aplica y el criterio de aceptación.
2. El subagente no edita este archivo. Devuelve archivos cambiados, comandos de verificación con su salida y desviaciones respecto del contrato.
3. El orquestador revisa las tareas M antes de marcarlas como hechas; las B se aceptan si pasa su verificación.
4. Toda desviación de un ADR o de T2 §5 se anota en la §7 y se resuelve en T60.

## 5. Plan de tareas y seguimiento

Estados: `pendiente`, `en curso`, `hecho`, `hecho (con recorte)`, `bloqueado`. `hecho (con recorte)` indica que la tarea se cerró con una parte del criterio sin cumplir, registrada en [matriz §3](../coherencia/matriz.md) y en el [informe](../informe/taller3.md) §7. Horas estimadas de reloj con agentes en paralelo.

### Fase 0. Preparación (0,5 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T00 | Confirmar D1 a D12 (§3 y §8); cerrar contratos de la §3.3 (G11); aplicar G07, G10 (ADR-001 a ADR-016 en `docs/decisions/`), G12 (contexto y `AGENTS.md`), G19, G21 (fusionar `feature/observability-chaos`) y G22 (CI) | A | Orquestador | Respuestas del equipo | hecho | ADR en `docs/decisions/` con el formato de los ADR del taller 2 (estado, fecha, contexto, decisión, alternativas, consecuencias, criterio para aceptar). |
| T01 | Instalar Docker Desktop con WSL 2, Minikube, kubectl y Helm; perfil con al menos 8 GB de RAM y 4 CPU | B | Equipo o Luna | — | hecho | `minikube start` y `kubectl get nodes` funcionan en la máquina de demo. |
| T02 | Andamiaje de código en `src/` y `tests/` con la estructura de G07 y G08: npm workspaces, TypeScript sobre Node 24, Vitest, ESLint con fronteras entre módulos; workflow de CI (G22) | B | Luna | T00 | hecho | `npm install`, `npm run build` y `npm test` pasan en vacío. |

### Fase 1. Dominio y datos (2 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T10 | Dominio del primer ingreso: `Boleta`, `IntentoDeValidacion`, `ContextoIngreso`, `EvaluacionIngreso`, `MotorPrimerIngreso`, `ValidarPrimerIngreso`, puerto `UnidadValidacion` y puertos de permisos, outbox y telemetría. Motivos y estados iguales a los del prototipo (T2 §7.3). Clave de consumo de T2 §6.2 | A | Orquestador | T02 | hecho | Nombres coinciden con T2 §2 y §6; el dominio no depende de infraestructura. |
| T11 | Pruebas unitarias PU-03, PU-04, PU-05 y PB-01 a PB-14, PB-21 sobre el motor con dobles de prueba; reporte de cobertura | M | Sol | T10 | hecho | `npm test` en verde; `docs/evidence/unit-tests/` con la tabla PU/PB → prueba y el reporte. |
| T12 | Liquidación y plazos con `decimal.js`: PU-07, PU-08, PB-15 a PB-20, PB-22 a PB-24 | B | Luna | T02 | hecho | PB-18 da exactamente 500,40 y PB-20 500,20; todo el grupo en verde. |
| T13 | Migraciones D1 y D2: `consumo` con UNIQUE sobre la clave de consumo, `intento` con UNIQUE `id_origen`, bitácora de solo adición con trigger que bloquea UPDATE y DELETE, `outbox`, lotes recibidos idempotentes, proyección del panel, incidentes y acciones, conciliación, liquidación, usuarios y roles de operadores (ADR-016); esquemas por módulo; sin RLS en D2 (ADR-009 recortada) | M | Sol, revisa Orquestador | T10 | hecho | Migraciones aplican en limpio; prueba de integración demuestra que UPDATE a la bitácora falla y que un segundo consumo de la misma boleta no entra. |
| T14 | Datos semilla con los nombres del prototipo (P §6): 1 cliente, 1 recinto, 3 eventos, 5 zonas, 20 puntos, 20 lectores, 16.240 boletas, con anuladas, boletas de prueba para los casos del lector (P §5.5) y los casos de CA3 | B | Luna | T13 | hecho | Script de siembra carga todo; conteos verificados por SQL coinciden con P §6. |

### Fase 2. Servicios y despliegue local (3 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T20 | C2 en `src/local-coordinator/`: V1 y H1; una transacción por intento con intento, decisión, consumo, bitácora y outbox (ADR-003, 004, 011); reintento idempotente (BD-03); "sin confirmación" si D1 falla (BD-01) o vence el plazo de 500 ms | A | Orquestador | T10, T13 | hecho | Pruebas de integración contra PostgreSQL real: aceptación, duplicado, reintento y D1 caído. |
| T21 | E1: despachador del outbox en lotes de hasta 100 con backoff y prioridad inferior a V1; recepción idempotente en M2 | A | Orquestador | T20, T22 | hecho | Con el enlace cortado el outbox crece; al volver se vacía sin duplicados en D2. |
| T22 | C4 en `src/central-core/`: M1 (versiones de permisos para P2 y C3), M2 (ingesta de lotes), M3 (conciliación preliminar y definitiva por decisiones únicas frente al contador independiente), M4 (liquidación con T12), API O2 con SSE (P §12) y reglas de incidentes (P §8) | M | Sol | T12, T13 | hecho | Endpoints de la §3.3 responden con datos de D2; un lector sin heartbeat más de 60 s genera un incidente "Puerta sin comunicación". |
| T23 | Boletería simulada en `src/ticketing-sim/` y adaptador C3 dentro de M1: versiones de permisos y anulaciones en JSON, traducción al modelo canónico (ADR-007), anulación en vivo por comando | M | Sol | T22 | hecho | Una anulación hecha en la boletería llega a C2 y la boleta se rechaza con "Boleta anulada por la boletería"; se documenta la ventana en que aún no ha llegado (RN-06). |
| T24 | `src/reader-client/` en modo emulado: lectores con credencial, diario durable, `idOrigen` estable, reintentos, heartbeat; perfiles nominal, pico y estrés; mezcla de casos con resultado esperado; modo "pares concurrentes"; CLI para arrancar, cambiar perfil y detener | M | Sol | Contratos V1 y H1 | hecho | Sostiene 5,5 TPS con ráfagas de 16,5 y llega a 49,5 TPS en pico; exporta el contador independiente por evento. |
| T25 | mTLS C1-C2 con CA de laboratorio, credencial por lector y revocación (ADR-008, PB-14) | M | Sol | T20, T24 | hecho | Un lector revocado es rechazado por confianza del dispositivo y no consume. Recortable. |
| T26 | Manifiestos en `deploy/kubernetes/` con Kustomize (G14): namespaces (G01), Deployments de C2 y C4, StatefulSets de D1 y D2, Toxiproxy, NetworkPolicies, probes, límites de recursos (sin MinIO, G13); scripts `deploy/scripts/` (`up`, `down`, `seed`, `load`, `reset`, con envoltorios `.ps1`) y `deploy/minikube/` | M | Sol | T02 | hecho | Despliegue desde cero con un comando; una prueba demuestra que C2 no alcanza D2 directamente. |
| T27 | Dockerfiles multi-stage (`node:24-alpine`) por unidad desplegable, construidos dentro de Minikube con `imagePullPolicy: Never` (G15); `npm run dev` con `deploy/compose/` para M1 | B | Luna | T02 | hecho | Imágenes construyen y los pods arrancan. |

### Fase 3. Interfaz (2 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T30 | Portar el prototipo (T2 §7, detalle en P §1 a §11, criterios de aceptación en P §14 a §17 y estilo en DESIGN.md) a `src/central-core/web/`, servido por C4; sustituir `simulador.js` por `api.js` (REST y SSE) que llena el mismo `store`; pantalla de login que reemplaza el selector de rol (ADR-016); quitar guion, saltos de reloj y personal simulado; mostrar la antigüedad de los datos cuando C4 no recibe del recinto; ajustar la tarjeta del coordinador a `nodo-unico` | M | Sol | T22 | hecho | Las seis rutas cargan con datos reales; ninguna vista usa el simulador; con F1 activo el resumen muestra antigüedad y no valores congelados. |
| T31 | Vista `#/lector` validando contra C2 con credencial de lector web; acciones de incidentes persistidas en D2 con tiempos para KR1.3; cierre preliminar y liquidación desde `#/cierre` | M | Sol | T30, T20 | hecho (con recorte): PR #32 y #33; `#/lector` sin validación manual y CA1–CA4 sin fuente (matriz §3, recortes e, i) | Una validación manual aparece en `#/puertas` y en Grafana; una acción sobre un incidente queda registrada. |
| T32 | Comparación visual prototipo frente a panel real, pantalla por pantalla | B | Luna | T30 | hecho | Lista de diferencias con capturas en `docs/evidence/ui/`. |

### Fase 4. Observabilidad (1,5 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T40 | Instrumentación OpenTelemetry en C1, C2, C4 y C5 con los spans de T2 §8.3 y W3C Trace Context; logs JSON con las reglas de T2 §8.4; Collector en `observability/collector/` con `file_storage` en PVC y reintentos (G05); exportación `otlphttp` a `otel-lgtm` en `nexo-observability` y opcional a Grafana Cloud Free si existe el Secret (G04) | M | Sol | T20, T22, T24 | hecho | Una traza muestra lector → C2 → D1 y, tras sincronizar, un Span Link a C4; detener el Collector no bloquea validaciones. |
| T41 | Métricas N1 a N3 y T1 a T3; dashboards como código en `observability/dashboards/` (operación del evento y sincronización y resiliencia, T2 §8.5) | M | Sol | T40 | hecho | Las seis métricas cambian en vivo con la carga emulada. |
| T42 | Alertas en `observability/alerts/`: A1, A6, A8, A11, A13 y A14 de T2 §8.6, con punto de contacto por webhook local | B | Luna | T41 | hecho | Cada alerta se dispara al menos una vez durante F1 a F4 y queda capturada. |
| T43 | Justificación de las seis métricas: decisión que soportan, KR o CA, SLO y ADR | A | Orquestador | T41 | hecho | Tabla lista para el informe en `docs/observability/`. |

### Fase 5. Fallos (2 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T50 | `nexo-chaos` en `chaos/scripts/`: `validate`, `plan`, `run --confirm`, `status`, `abort`, `restore` sobre YAML (T2 §11.2); acciones Toxiproxy, `kubectl scale`, NetworkPolicy, `stress-ng` y límites de CPU; reversión por temporizador; registro JSON de cada ejecución | M | Sol | T26 | hecho | Una ejecución de prueba deja su registro en `chaos/evidence/`. |
| T51 | F1 RED-01/EXP 01: YAML en `chaos/experiments/red-01-central-connection/`, ejecución y verificación | A | Orquestador | T21, T41, T50 | hecho: PR #35, aprobada (1410/1410 drenados en 15 s; PR #31 tras la corrida 1) | Drenado ≥ 99,5 % en 5 min; cero pérdidas y duplicados según SQL de integridad. |
| T52 | F2 SER-06/EXP 06: corte de la exportación del Collector (G06) | A | Orquestador | T40, T50 | hecho (con recorte): PR #35, aprobada con degradación prevista; alerta imposible con Grafana dentro de `otel-lgtm` (PR #34, matriz §3, recorte j) | T1 en objetivo durante la caída; cola drena; alerta disparada. |
| T53 | F3 BD-01 | A | Orquestador | T20, T24, T50 | hecho: PR #35, aprobada con degradación prevista (0 aceptaciones sin D1) | Cero aceptaciones sin D1; integridad al recuperar. |
| T54 | F4 REC-01 | A | Orquestador | T41, T50 | hecho (con recorte): PR #35, no concluyente; A6 no disparó con 100m (matriz §3, recorte l) | Degradación visible en T1 y alerta; integridad sin cambios. |
| T55 | Pruebas de integridad EXP 03 y EXP 04 en `tests/resilience/` | M | Sol | T20, T24 | hecho | Reintentos devuelven la decisión original; 500 consumos, 500 aceptaciones y 500 rechazos. |
| T56 | Evidencias por experimento: paneles, logs, trazas, registro de `nexo-chaos` y consultas de integridad | B | Luna | T51 a T54 | hecho: PR #35 (`chaos/evidence/`; `alertas.log` y `logs/` no versionados, recorte n) | Misma estructura de archivos en cada carpeta de `chaos/evidence/`. |
| T57 | Análisis y conclusiones de F1 a F4 con la escala de T2 §11.3 | A | Orquestador | T56 | hecho: PR #35 (`docs/fault-experiments/`) | Por fallo: hipótesis, perturbación, métricas, recuperación, resultado y aprendizaje, en `docs/fault-experiments/`. |

### Fase 6. Documentación y coherencia (1,5 h)

| ID | Tarea | Cx | Agente | Depende de | Estado | Criterio de aceptación |
|---|---|---|---|---|---|---|
| T60 | Matriz de coherencia ADR ↔ código ↔ prueba ↔ experimento; actualizar el estado de los ADR con PoC ejecutada; configuración de NEXO_04 con runtime e imágenes por digest; registro de recortes | A | Orquestador | T57 | hecho (con recorte): PR #26, PR #37 y digests registrados en la matriz §2; los manifiestos siguen con tags | Ningún ADR contradice lo desplegado; cada desviación de la §7 tiene resolución. |
| T61 | Informe del taller 3: aplicación, observabilidad, fallos y patrones (patrón → atributo de calidad → archivo del repo) | M | Sol | T43, T57, T60 | hecho: PR #29, #30 y PR #37 | Cada afirmación remite a una evidencia del repo. |
| T62 | Autoevaluación: logros, dificultades y propuestas de evolución | A | Orquestador | T61 | hecho: PR #29 y PR #37 (informe §8) | Sección incluida en el informe. |
| T63 | README de ejecución paso a paso y guion del video demo | B | Luna | T60 | hecho: PR #26 y PR #37 | Un integrante que no trabajó en el código levanta el sistema siguiendo el README. |
| T64 | Revisión de estilo, referencias y enlaces del informe | B | Luna | T61, T62 | hecho: PR #29 y PR #37 (0 enlaces rotos) | Sin referencias rotas ni enlaces huérfanos. |

### Cronograma por bloques

| Bloque | Horas | Alta (Orquestador) | Media (Sol) | Baja (Luna) |
|---|---|---|---|---|
| 1 | 0 a 1 | T00 | — | T01, T02 |
| 2 | 1 a 3 | T10 | T13, T26 | T12, T27, T14 |
| 3 | 3 a 6 | T20 | T11, T22, T23, T24 | — |
| 4 | 6 a 8 | T21 | T30, T31, T40, T25 | T32 |
| 5 | 8 a 10 | T43, T51 a T54 | T41, T50, T55 | T42 |
| 6 | 10 a 12 | T57, T60, T62 | T61 | T56, T63, T64 |

Orden de recorte si no alcanza el tiempo: T25, exportación a Grafana Cloud, T32. RLS en D2 y D3 en MinIO ya quedaron recortados (ADR-009, ADR-012). Cada recorte se anota en la §7 y en el ADR correspondiente.

## 6. Patrones esperados en la implementación

Base para T61: patrones de T2 §4.5 más los que aparecen al implementar. Cada fila se confirma con el archivo donde se ve.

| Patrón | ADR | Atributo de calidad | Dónde debería verse |
|---|---|---|---|
| Capas y monolito modular | ADR-001 | Mantenibilidad | `src/central-core/{api,application,domain,infrastructure}` y `modules/` |
| Puertos y adaptadores | ADR-001, ADR-007 | Mantenibilidad, testabilidad | Dominio sin dependencias de infraestructura; `UnidadValidacion` |
| Autoridad única con consumo atómico | ADR-002, ADR-003 | Integridad | UNIQUE sobre la clave de consumo en D1 |
| Receptor idempotente por `idOrigen` | ADR-002, ADR-011 | Confiabilidad | C2 y recepción de lotes en M2 |
| Bitácora de solo adición | ADR-004 | Auditabilidad | Trigger en D1 y D2 |
| Outbox transaccional y store-and-forward | ADR-011 | Disponibilidad ante particiones | Tabla `outbox` y despachador E1 |
| Adaptador anticorrupción | ADR-007 | Interoperabilidad | C3 dentro de M1 |
| Reintento con backoff y prioridad de V1 | ADR-011 | Rendimiento de la validación | Despachador E1 |
| Heartbeat y health check | KR1.2 | Observabilidad, recuperabilidad | H1, probes de Kubernetes, reglas de incidentes |
| Proyección de lectura para el panel | SER-05 | Rendimiento, disponibilidad | Proyección en D2 y API O2 |
| Collector como agente de telemetría | ADR-013 | Observabilidad desacoplada | `observability/collector/` |

## 7. Desviaciones y decisiones durante la ejecución

| Fecha | Tarea | Desviación o decisión | ADR o entregable afectado | Resolución |
|---|---|---|---|---|
| 25-09-2026 | — | El laboratorio de fallos usa Minikube, no Docker Compose como proponía el entregable 11. | Entregable 11 (T2 §11.2), nuevo ADR-015 | Resuelto: ADR-015. |
| 25-09-2026 | — | Los cuatro fallos del repo (RED-01, SER-06, BD-01, REC-01) reemplazan la propuesta anterior del plan (RED-01, SER-01, BD-02, REC-01); EXP 03 y EXP 04 pasan a pruebas de integridad. | Entregable 11 | Adoptado en la §3.1. |
| 25-09-2026 | — | El prototipo muestra réplica y reingresos; la configuración fija `nodo-unico` y el caso de uso excluye reingreso (T2 §7.5). | Entregables 04, 05-06 y 07 | Recomendado en D9 y D10 (§8.1); aplicar en T30 y documentar en T60. |
| 25-09-2026 | — | Revisión del repositorio real: 23 gaps entre el repo y este plan (namespaces, motor de D1, métricas, cola del Collector, estructura de C4, contratos, contexto para agentes, rama sin fusionar) y plan de sesiones paralelas por olas. | [gaps.md](gaps.md) | Resuelto: G01 a G23 decididos y aplicados en la ola 0 (ADR-001 a ADR-016, andamiaje y CI). |
| 25-09-2026 | T22, T30 | Hito M1 cumplido en `main` (27fee6c): login, panel con datos reales de D2, V1 → D1 → E1 → D2 → SSE y `npm run dev`; `npm run test:m1` en verde. C4 responde 501 en preparación y cierre hasta T22 (M3, M4) y T31. P2 aún no se consume en C2 (usa los permisos sembrados en D1). Desde aquí se trabaja con ramas y PR. | §3.4, §3.5 | Pendientes asignados a la ola 2. |
| 26-09-2026 | T51–T57 | F1–F4 ejecutados en Minikube. F1 corta C2→C4 durante 5 min (no los 15 min de EXP 01) y F3 solo hace D1 indisponible (sin los subcasos de disco de EXP 05). Ninguna alerta asociada a un fallo se disparó y F4 fue no concluyente. | ADR-002, 005, 011, 012, 013; T42 | Registrado en [matriz §3](../coherencia/matriz.md) (recortes j–n) y en el [informe](../informe/taller3.md) §3 y §7; los ADR siguen pendientes de PoC completa. |

## 8. Preguntas abiertas y recomendaciones

Recomendación del orquestador para cada pregunta (25-09-2026), confirmada por el equipo el mismo día con los ajustes indicados.

| N.º | Pregunta | Recomendación | Motivo |
|---|---|---|---|
| 1 | Lenguaje (D2) | TypeScript sobre Node 24 LTS (ADR-014). | Reutiliza reglas, motivos y umbrales de `dominio.js` (P §7); un solo lenguaje para panel y servicios. Node 22 se descartó por estar en mantenimiento. El consumo único depende de PostgreSQL, no del lenguaje. |
| 2 | Telemetría (D4) | Backend en el clúster (`grafana/otel-lgtm`) como principal; exportación a Grafana Cloud Free opcional. | F2 (SER-06) apaga el Collector y la demo no debe depender de internet ni de un token. Registrar en ADR-013 como variante de laboratorio de la decisión del entregable 08. |
| 3 | Fallos (§3.1) | Confirmar RED-01, SER-06, BD-01 y REC-01. | Cubren las cuatro dimensiones del catálogo y se inyectan con un comando en Minikube. F1 es el más demostrativo. En F4 preferir bajar `resources.limits.cpu` del pod de C2 a `stress-ng`: es reversible y deja evidencia en el manifiesto. |
| 4 | Carga | Carga en vivo por los lectores emulados hacia C2 y, además, scripts SQL "de escenario" que dejan D2 en un estado dado (preparación, ingreso a mitad, cierre con diferencias). | Solo la carga en vivo produce latencia, heartbeats y sincronización reales, por eso sobre ella se miden métricas y fallos. Los escenarios SQL reemplazan los saltos del panel Demo sin recrear el simulador. Regla: lo sembrado por SQL se marca como sintético y nunca es evidencia de métricas ni de fallos. |
| 5 | Seguridad (D8) | mTLS C1-C2 con credencial revocable, sí. RLS, no: ADR-009 queda "pendiente de PoC" con la razón escrita. | ADR-008 es PoC bloqueante y la interfaz muestra "Autenticación mutua" y la revocación (PB-14). Con un solo cliente en la semilla, RLS no demuestra nada visible; es el primer recorte. |
| 6 | Entregables | Informe en LaTeX con la plantilla del taller 2; video en el orden de la rúbrica (aplicación, observabilidad, cuatro fallos, patrones). | Coherencia con los entregables anteriores. Duración del video y fecha de entrega: confirmar con el profesor. |
| 7 | Máquina de demo | `minikube start --driver=docker --cpus=4 --memory=8192` en un equipo con 16 GB de RAM. | Consumo estimado de 4 a 5 GB entre D1, D2, C2, C4, Toxiproxy, Collector, `otel-lgtm` y los lectores emulados. Falta confirmar la RAM de la máquina elegida. |

### 8.1 Decisiones adicionales derivadas del prototipo

Resuelven las diferencias de P §13. Se aplican en T10, T22 y T30.

| ID | Decisión recomendada | Motivo |
|---|---|---|
| D9 | Falla del coordinador con `nodo-unico`: se conserva el tipo de incidente; los pasos pasan a "verificar el volumen de D1", "reiniciar el coordinador" y "comprobar que las boletas consumidas se rechazan"; se elimina la acción "Promover". El panel muestra el coordinador como un nodo con su estado y las pausas medidas. | No hay réplica que promover. La comprobación posterior es el criterio de ADR-012. F3 (BD-01) cae en este incidente porque C2 queda sin autoridad. |
| D10 | No implementar reingresos: política `reingresoPermitido = false`; la segunda lectura se rechaza con "Uso ya registrado"; la tarjeta de políticas lo muestra. Se retiran el motivo de reingreso suspendido y la acción de suspender reingresos; el incidente "Permisos desactualizados" se mantiene con sus otros pasos. | El caso de uso del entregable 05-06 excluye reingresos y la clave de consumo es `PRIMER_INGRESO`. Reduce alcance sin contradecir el prototipo. |
| D11 | KPI principal "Respuestas en ≤ 300 ms" (meta de T2 §8.2) y en el pie el p95 frente a los 500 ms de CA2. | Concilia el entregable 08 con ADR-002 y con el prototipo (desarrolla D7). |
| D12 | No crear tipos de incidente nuevos: la taxonomía v1 se mantiene. BD-01 se reporta como "Falla del coordinador". SER-06 no genera incidente para el supervisor; su alerta va por Grafana. | La taxonomía está declarada cerrada antes del piloto (P §8). El panel lee de D2 y no de la telemetría, así que sigue funcionando con el Collector caído, que es lo que F2 quiere demostrar. |
