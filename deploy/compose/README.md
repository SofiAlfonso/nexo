# Entorno local con Docker Compose

Inicia PostgreSQL para D1 y D2 junto con el backend local de observabilidad:

```sh
docker compose -f deploy/compose/docker-compose.dev.yml up -d
```

Puertos publicados:

- D1 (PostgreSQL por sede): `localhost:5433`
- D2 (PostgreSQL central): `localhost:5434`
- OTLP/gRPC: `localhost:4317`
- OTLP/HTTP: `localhost:4318`
- Grafana: [http://localhost:3000](http://localhost:3000) (`admin` / `admin`)

`otel-lgtm` provisiona automáticamente los dashboards de
`observability/dashboards/` (carpeta **NEXO**) y las alertas de
`observability/alerts/` (T41/T42). Para recibir sus notificaciones en
desarrollo, arranca `node observability/alerts/webhook-receptor.mjs` antes
de levantar el stack (ver `NEXO_ALERT_WEBHOOK_URL` en `.env.example`).

Conexiones PostgreSQL predeterminadas:

- D1: `postgresql://nexo_venue:nexo_venue_dev@localhost:5433/nexo_venue`
- D2: `postgresql://nexo_central:nexo_central_dev@localhost:5434/nexo_central`

El archivo `.env.example` contiene valores locales de desarrollo; puede
usarse directamente con `docker compose --env-file deploy/compose/.env.example`.

Detén los servicios conservando los datos con:

```sh
docker compose -f deploy/compose/docker-compose.dev.yml down
```

Para eliminar también los volúmenes y reiniciar las bases de datos desde
cero, ejecuta el mismo comando con `down -v`.

> ⚠️ **Entorno compartido**: en el laboratorio de la ola 1 sólo hay un
> Docker; el proyecto Compose `nexo-dev` (D1 `5433`, D2 `5434`, `otel-lgtm`)
> es **compartido entre sesiones**. Nunca ejecutes `down -v` (ni borres sus
> volúmenes) salvo que sepas que ninguna otra sesión depende de esos datos.
> Las pruebas automáticas deben usar Testcontainers, no este stack; si
> necesitas un stack propio y aislado, usa
> `docker compose -p nexo-<tu-sesion> ...` con otros puertos.

## Correr el hito M1 localmente (`npm run dev`)

`npm run dev` (`scripts/dev.mjs`, T27) automatiza lo anterior y arranca C4 y
C2 con las variables de `deploy/compose/.env.example` (o de tu propio
`deploy/compose/.env`, que no se versiona):

1. `npm ci` en la raíz del repositorio (una sola vez, o tras cambios en el
   lockfile).
2. `npm run dev` — internamente:
   - Levanta `docker compose -f deploy/compose/docker-compose.dev.yml up -d`
     y espera a que D1, D2 y `otel-lgtm` estén `healthy`.
   - Corre migraciones (`src/local-coordinator/infrastructure/db/migrate.ts`,
     `src/central-core/infrastructure/db/migrate.ts`) y la semilla
     (`deploy/scripts/seed.ts --export tmp/dev-boletas.json`, un único script
     que siembra D1 y D2 y exporta boletas reales para `dev:reader`) si ya
     existen; si una sesión de la ola 1 (S1-data) todavía no las publicó, lo
     indica en la consola y continúa sin fallar.
   - Arranca `node src/central-core/index.ts` (C4, puerto `CENTRAL_PORT`,
     por defecto `8080`) y `node src/local-coordinator/index.ts` (C2, puerto
     `COORDINATOR_PORT`, por defecto `8081`), con la salida de cada uno
     prefijada (`[central]`, `[coordinator]`).
3. `Ctrl+C` detiene C4 y C2 de forma ordenada; D1/D2/`otel-lgtm` siguen
   corriendo (`npm run dev` sólo hace `up -d`, nunca `down -v`, porque el
   stack es compartido — ver advertencia arriba). Para pararlos:
   `npm run dev:down` (o con `-- --reset` para además borrar los datos y
   reiniciar desde cero, sólo si ninguna otra sesión los necesita).
4. `npm run dev:reader` arranca el lector emulado (C1, perfil de carga
   `nominal` de `tests/load/`) contra el C2 local — requiere que
   `npm run dev` ya esté corriendo.

Variables relevantes de `deploy/compose/.env.example` (valores de
laboratorio, sin secretos reales — ver `AGENTS.md` §8):

| Variable | Uso |
|---|---|
| `CENTRAL_PORT`, `COORDINATOR_PORT`, `TICKETING_PORT` | Puertos HTTP locales de C4, C2 y la boletería simulada. |
| `CENTRAL_URL` | URL que usan C1 y C2 para hablar con C4 (`http://localhost:8080` en desarrollo). |
| `SEED_OPERATOR_PASSWORD` | Contraseña de los operadores de laboratorio sembrados en D2 (ADR-016). |
| `SESSION_COOKIE_SECRET` | Clave de firma de la cookie `nexo_sesion` de C4 en desarrollo. |

### Verificación de punta a punta

`npm run test:m1` ejecuta `tests/integration/m1/m1-end-to-end.test.ts`
contra el entorno de `npm run dev`: login por rol, `GET /api/puntos` con
datos reales de D2, una validación V1 contra C2 (queda en D1) y su llegada
a D2 vía outbox/E1 en <= 10 s, visible por `GET /api/intentos` y por un
evento `intento` en `GET /api/stream`. Mientras C4 o C2 todavía no
respondan (piezas de otras sesiones de la ola 1), la suite se omite sola
con un aviso indicando qué falta; no hace falta editarla a mano para
activarla.

La prueba de validación V1 no usa un `lectorId`/`codigo` inventados: lee
`tmp/dev-boletas.json` (la exportación real que deja el paso de semilla de
`npm run dev`) y elige el primer punto de `/api/puntos` que tenga un
lector habilitado en D1, y la primera boleta vigente y sin usar de su
zona. Si esa exportación no existe todavía (o quedó desactualizada frente
a D1), la prueba falla con un mensaje explícito indicando qué falta en vez
de un 403 opaco. Puedes forzar otros valores con las variables de entorno
`NEXO_BOLETAS`, `NEXO_LECTOR_ID`, `NEXO_CODIGO_BOLETA` y
`NEXO_ZONA_SOLICITADA`.

> ⚠️ **Hashes de operador obsoletos en un D2 ya sembrado**: la siembra de
> operadores usa `ON CONFLICT (usuario) DO NOTHING`, así que si alguna vez
> se sembró `auth.operadores` con un `SEED_OPERATOR_PASSWORD` distinto (por
> ejemplo, durante una corrida parcial de `npm run dev` interrumpida antes
> de terminar de sembrar), las corridas siguientes de `npm run dev` **no**
> actualizan esas filas y el login sigue devolviendo 401 aunque el resto
> del entorno esté sano. En el stack compartido `nexo-dev`, si ves 401 en
> `test:m1` con la contraseña de `.env.example`, antes de tocar datos
> avisa a la orquestadora: sólo debe reescribirse `auth.operadores` (o
> reiniciar el volumen de D2) con su autorización explícita, porque D2 es
> compartido entre sesiones de la ola 1.

### Paso a paso para correr M1 completo localmente

1. Clona el repo y desde la raíz corre `npm ci` (una sola vez, o tras
   cambios en `package-lock.json`).
2. Verifica que Docker Desktop esté corriendo. Si compartes máquina con
   otras sesiones de la ola 1, revisa la advertencia de "Entorno
   compartido" más arriba antes de continuar.
3. (Opcional) copia `deploy/compose/.env.example` a `deploy/compose/.env`
   si quieres sobreescribir algún valor local; `npm run dev` funciona con
   los valores de ejemplo tal cual (sin secretos reales).
4. En una terminal, desde la raíz del repo:
   ```powershell
   npm run dev
   ```
   Esto deja D1/D2/`otel-lgtm` arriba en Docker Compose, corre migraciones
   y semilla (si ya están publicadas por S1-data) y arranca C4 (`:8080`) y
   C2 (`:8081`) como procesos de Node con salida prefijada por servicio.
   Déjalo corriendo en esa terminal.
5. (Opcional, en otra terminal) para simular el lector físico C1 contra el
   C2 recién levantado:
   ```powershell
   npm run dev:reader
   ```
   Usa automáticamente la exportación de boletas que dejó el paso 4 en
   `tmp/dev-boletas.json`; si no existe (S1-data aún no publicó la semilla),
   pasa tu propia ruta con `-- --boletas <ruta>`.
6. (En una tercera terminal) para validar M1 de punta a punta:
   ```powershell
   npm run test:m1
   ```
   Si C4/C2 todavía no responden (u otra sesión de la ola 1 no ha llegado a
   `main`), la suite se omite sola con un aviso; no es un fallo.
7. Para parar C4/C2 sin tocar los datos: `Ctrl+C` en la terminal del paso 4,
   luego (opcional) `npm run dev:down` para además detener los contenedores
   de Docker (conservando sus volúmenes). Sólo agrega `-- --reset` si
   ninguna otra sesión de la ola 1 necesita esos datos — borra los
   volúmenes de D1/D2.
