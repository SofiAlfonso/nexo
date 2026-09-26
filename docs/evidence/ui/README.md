# T32 — Comparación visual prototipo vs. panel real (C5)

Capturas tomadas con Playwright contra:

- **Panel real**: `npm run dev` propio (C4 en `:8090`, C2 en `:8091`), reutilizando el D1/D2/otel-lgtm
  compartido (`nexo-dev`). Evento y datos reales del ambiente de desarrollo (sin `?fixtures`).
- **Prototipo**: `NEXO_07_Prototipo` original, servido con `python -m http.server 8099` (Playwright
  no permite navegar a `file://`).

Cada pantalla tiene un par `panel-real-NN-*.png` / `prototipo-NN-*.png`. Resultado general: el layout,
la jerarquía visual y los componentes coinciden con el prototipo. Las diferencias esperadas son datos
reales (vacíos o en curso) en vez de los datos de demostración del prototipo, y la ausencia del dock de
demo/simulación (correcto: cero simulación en producción).

## 01 — Resumen
Coincide. El panel real muestra el estado vacío/inicial real del evento (sin incidentes, sin dock de
demo, sin insignia de notificación falsa) en vez de los datos simulados del prototipo.

## 02 — Incidentes
Coincide en estructura. Se encontró y corrigió un texto residual que mencionaba "la simulación" en el
mensaje de bandeja vacía (`alertas.js`) y en el mensaje de "incidente no encontrado" (`incidente.js`),
ambos en violación del requisito de cero simulación en producción.

## 03 — Puertas
Coincide en estructura (lista + detalle). Se encontró y corrigió un bug real: la ficha "Lector asignado"
(`punto.js`) mostraba "Cargando…" de forma permanente en puertas sin ningún lector jamás conectado —un
estado vacío legítimo de producción, no un estado de carga— lo cual podía confundir al operador. Ahora
distingue "todavía cargando" (`!Array.isArray(p.recientes)`) de "cargado pero vacío" (mensaje explícito:
"Ningún lector se ha autenticado todavía en esta puerta.").

## 04 — Lector
Coincide en estructura. Los botones "Prueba un caso" del panel real siguen siendo solo locales (no
llaman a C2 real todavía) — pendiente de T31 (bloqueado en pregunta a la orquestadora sobre CORS/ruta
dedicada en C2 para el panel).

## 05 — Cierre
Coincide en estructura, con la diferencia esperada de datos de evento reales frente a los datos de demo
del prototipo. Durante esta ronda de T32, S2-settlement fusionó M3/M4 (#18): las rutas
`/api/cierre/preliminar|definitivo|diferencias/:id|cobro` dejaron de ser 501 y ahora ejecutan
`ServicioConciliacion` real contra D2. Se encontraron y corrigieron tres problemas:

1. **Bug de severidad alta (crash):** `cierre.js#pasos()` lanzaba `TypeError` cuando
   `condicionesCierre()` no traía todas las condiciones esperadas, dejando toda la pantalla `#/cierre`
   en blanco. `ok(id)` ahora devuelve `false` de forma segura cuando falta una condición, en vez de
   fallar.
2. **Bug de datos (ids equivocados):** `pasos()` comprobaba condiciones con los ids `'diarios'`,
   `'buzon'`, `'cambios'`, pero el contrato real (`evaluarCondicionesCierre` en
   `modules/reconciliation/domain`) usa `'diarios-sincronizados'`, `'buzon-vacio'`,
   `'cambios-al-dia'`. El paso "Registros completos" nunca podía marcarse hecho aunque el backend
   dijera que sí. Corregido para usar los ids reales.
3. **Hallazgo de integración (fuera de mi alcance en `web/**`):** `GET /api/eventos/actual/estado` —la
   ruta que alimenta el estado en vivo del panel vía SSE— sigue usando
   `PreparacionConciliacionRepositorio` (un stub anterior a M3 en
   `central-core/application/o2/puertos-preparacion.ts`, comentado explícitamente como «M1 solo
   necesita el estado inicial para O2, sin M3 real aún») en vez de `ServicioConciliacion.obtenerConciliacion`
   (el servicio real de M3). Por eso el estado en vivo trae siempre `diferencias: []` y
   `condiciones: []`, aunque las rutas dedicadas de cierre (`/api/cierre/*`) sí calculan datos reales
   cuando se invocan directamente. Se reportó a la orquestadora para que asigne el cableado de
   `servicio-o2.ts` a quien corresponda (probablemente S2-settlement o la dueña de `application/o2`).
   Mientras tanto, se ajustó `cierre.js` (dentro de mi alcance de `web/**`) para no fabricar un estado
   falso: cuando `condiciones` llega vacía, el paso "Registros completos" y el panel "Para declarar
   conciliado" muestran explícitamente "no disponible todavía" / "Las condiciones de cierre aún no
   tienen una fuente de datos real conectada al panel" en vez de aparentar que ya se comprobaron o que
   faltan. No se aplicó el mismo tratamiento a la lista de "Diferencias" porque no hay una señal
   confiable para distinguir "cero diferencias reales" de "todavía no calculadas" en ese caso (a
   diferencia de `condiciones`, donde el servicio real siempre devuelve 6 entradas y el stub siempre
   devuelve 0).

Se verificó además que el aviso de "no disponible todavía" (toast por error) se dispara correctamente
cuando una acción de cierre falla (confirmado por DOM, aunque la captura
`panel-real-05-cierre-aviso-501.png` no alcanzó a congelar el toast por ser transitorio; queda como
evidencia del comportamiento antes del merge de M3, cuando esas rutas sí devolvían 501).

## 06 — Preparación
Coincide en estructura. Confirma que el arreglo de PR #14 (reemplazar CA1–CA4 inventados por
"No disponible todavía" cuando no hay fuente de datos real) se ve correctamente en el panel real, con
una nota explícita: "Estas pruebas de aceptación aún no tienen una fuente de datos real conectada al
panel; esta sección se completará cuando exista."

## 07 — Detalle de incidente (`#/incidentes/:id`)
No se pudo capturar en el panel real: el ambiente de desarrollo compartido no tiene incidentes reales
en este momento (cero simulación implica que no se puede fabricar uno solo para la captura). Se
documenta únicamente la vista del prototipo como referencia. El código de `incidente.js` fue revisado:
usa el mismo modelo de datos que alimenta el resto del panel (sin datos inventados propios de esta
vista) y ya se corrigió el texto de "simulación" en el mensaje de no encontrado (ver punto 02). Las
acciones "Tomar" y "Agregar nota" llaman a `POST /api/incidentes/:id/acciones`, verificado con pruebas
de integración (T31, PR #14).

## Bugs encontrados y corregidos en esta ronda de T32

| Archivo | Problema | Corrección |
|---|---|---|
| `vistas/alertas.js` | Texto "la simulación" en bandeja vacía | Mensaje honesto de producción |
| `vistas/incidente.js` | Texto "la simulación" en incidente no encontrado | Mensaje honesto de producción |
| `vistas/punto.js` | "Cargando…" permanente sin lector asignado | Distingue cargando vs. vacío real |
| `vistas/cierre.js` | `TypeError` si falta una condición de cierre → página en blanco | `ok(id)` con `false` por defecto |
| `vistas/cierre.js` | ids de condición equivocados (`'diarios'` vs. `'diarios-sincronizados'`, etc.) | Ids alineados al contrato real de `evaluarCondicionesCierre` |
| `vistas/cierre.js` | Con `condiciones: []` (stub aún no cableado a M3), el paso mostraba "falta sincronizar" como si se hubiera comprobado y fallado | Muestra "no disponible todavía" quando no hay datos, sin inventar un resultado |

## Hallazgo de integración reportado a la orquestadora (fuera de `web/**`)

`central-core/application/o2/servicio-o2.ts` arma `conciliacion` para `GET /api/eventos/actual/estado`
con `PreparacionConciliacionRepositorio` (stub pre-M3, `diferencias: []` y `condiciones: []` fijos) en
vez de `ServicioConciliacion.obtenerConciliacion` (M3 real, ya mergeado en #18 por S2-settlement). Las
rutas dedicadas `/api/cierre/*` sí usan el servicio real. Cablear el estado en vivo al servicio real
requiere tocar `central-core/application/o2/` e `infrastructure/o2-repositorio.ts`, fuera de la
propiedad de esta sesión (`web/**`, `evidence-ingestion/**`, `seed.sql`).

## T31 — Cierre del panel sin rutas 501 ni datos inventados (S3-panel): cierre y preparación

Capturas nuevas (`t31-01-preparacion.png`, `t31-03-cierre.png`) tomadas con Playwright contra
`npm run dev` propio de S3-panel (central `:18380`, coordinador `:18381`, boletería `:18382`;
D1/D2/otel-lgtm propios levantados por `scripts/dev.mjs`), autenticada como `supervisor` /
`nexo_operador_dev`. Ambas rutas se verificaron con 0 errores de consola tras un
`location.reload(true)` forzado.

- **`t31-01-preparacion.png` (`#/preparacion`)**: cierra el hallazgo de integración de arriba en la
  parte que correspondía a T31. `GET /api/eventos/actual/estado` ahora arma `preparacion` con datos
  reales de `m1_config_permisos.controles_preparacion`/`apertura_confirmada_en` (D2), con escritura
  real vía `POST /api/preparacion/controles/:id` y `POST /api/preparacion/confirmar` (antes 501). La
  captura muestra "6/6 · Confirmado" para `EVT-2026-02` (evento ya `abierto`, preparación sembrada
  consistente con ese estado). CA1–CA4 ("Pruebas de aceptación") se deja como recorte honesto:
  "No disponible todavía" — no existe ninguna fuente real de esos criterios en el repositorio, y no se
  fabrica un dato. Cobertura de la regla de negocio (control inválido, control pendiente bloquea la
  apertura) en `tests/unit/central/servicio-o2-preparacion.test.ts` (unitario, sin Testcontainers) y
  `tests/integration/central/c4-server.test.ts` (extremo a extremo contra Postgres real).
- **`t31-03-cierre.png` (`#/cierre`)**: `EventoConfigRepositorioPg.obtenerEventoActual` ahora también
  resuelve eventos en estado `cerrado` (antes solo `abierto`/`preparacion`), así que el estado en vivo
  no queda en blanco justo cuando `#/cierre` necesita mostrar conciliación/liquidación real. Verificado
  con `tests/integration/settlement/cierre.test.ts` contra Postgres real (evento sembrado `cerrado`,
  con una diferencia ya resuelta y saldo cobrado).
- `#/puertas` y `#/puertas/:id` se re-verificaron sin cambios de código en esta ronda (0 errores de
  consola).

## T31 — Cierre del panel sin rutas 501 ni datos inventados (S3-panel): `#/lector`

Captura nueva (`t31-02-lector.png`) tomada con Playwright contra `npm run dev` propio de S3-panel
(central `:18380`, coordinador `:18381`, boletería `:18382`), autenticada como
`supervisor` / `nexo_operador_dev`, 0 errores de consola tras `location.reload(true)`.

- **`t31-02-lector.png` (`#/lector`)**: el botón "Prueba un caso" del punto 04 llamaba a
  `POST /api/lector/escaneos` con un cuerpo `SolicitudEscaneoLector`, un endpoint y un tipo que nunca
  existieron en `src/shared/contracts/` ni en `src/central-core/api/rutas/` — es decir, simulaba una
  validación V1 desde el navegador. V1 es responsabilidad exclusiva de C2 (invariante 1/2), y ADR-008
  reserva mTLS para lectores físicos (PR #10); autenticar un "lector web" equivalente exigiría un
  mecanismo de sesión nuevo en C2, fuera del alcance de esta sesión. Se retira el botón/flujo simulado
  de `lector.js` (también se corrige un bug real: `cargarPuntoDetalle` no manejaba el caso sin
  `recientes`). La vista ahora solo muestra evidencia real de intentos V1 ya registrados (histórico
  desde D2/D1), sin fabricar una validación nueva. Documentado como recorte explícito en
  `docs/coherencia/matriz.md` §3, fila (i).
