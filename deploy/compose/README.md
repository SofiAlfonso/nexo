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
