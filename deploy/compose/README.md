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
     (`deploy/scripts/seed-d1.ts`, `deploy/scripts/seed-d2.ts`) si ya existen;
     si una sesión de la ola 1 (S1-data) todavía no las publicó, lo indica en
     la consola y continúa sin fallar.
   - Arranca `node src/central-core/index.ts` (C4, puerto `CENTRAL_PORT`,
     por defecto `8080`) y `node src/local-coordinator/index.ts` (C2, puerto
     `COORDINATOR_PORT`, por defecto `8081`), con la salida de cada uno
     prefijada (`[central]`, `[coordinator]`).
3. `Ctrl+C` detiene C4 y C2 de forma ordenada; D1/D2/`otel-lgtm` siguen
   corriendo. Para pararlos: `npm run dev:down` (o con `-- --volumes` para
   además borrar los datos y reiniciar desde cero).
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
