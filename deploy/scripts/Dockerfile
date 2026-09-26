# nexo-db-init — Job de migraciones y semilla (`deploy/scripts/seed.ts`).
# Necesita el código de D1 (local-coordinator) y D2 (central-core) a la vez,
# por lo que no reutiliza ninguno de los Dockerfile por servicio. Build desde
# la raíz del repo (monorepo con npm workspaces):
#   docker build -f deploy/scripts/Dockerfile -t nexo/db-init:dev .
#
# Node 24 ejecuta TypeScript nativamente (ADR-014); no hay paso de `tsc`.

FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json ./
COPY src/shared/package.json src/shared/package.json
COPY src/local-coordinator/package.json src/local-coordinator/package.json
COPY src/central-core/package.json src/central-core/package.json
COPY src/reader-client/package.json src/reader-client/package.json
COPY src/ticketing-sim/package.json src/ticketing-sim/package.json
RUN npm ci --omit=dev --ignore-scripts

FROM base AS runtime
RUN addgroup -S nexo && adduser -S nexo -G nexo
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY src/shared ./src/shared
COPY src/local-coordinator ./src/local-coordinator
COPY src/central-core ./src/central-core
COPY deploy/scripts/seed.ts deploy/scripts/seed.ts
COPY deploy/scripts/export-boletas.ts deploy/scripts/export-boletas.ts
USER nexo

CMD ["node", "deploy/scripts/seed.ts"]
