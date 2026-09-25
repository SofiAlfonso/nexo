# Boletería simulada (sistema externo de prueba, P1). Build desde la raíz del
# repo (monorepo con npm workspaces), no desde esta carpeta:
#   docker build -f src/ticketing-sim/Dockerfile -t nexo/ticketing-sim:dev .
#
# Node 24 ejecuta TypeScript nativamente (ADR-014); no hay paso de `tsc`.

FROM node:24-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

# --- deps: instala dependencias de producción de todo el monorepo -----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY src/shared/package.json src/shared/package.json
COPY src/local-coordinator/package.json src/local-coordinator/package.json
COPY src/central-core/package.json src/central-core/package.json
COPY src/reader-client/package.json src/reader-client/package.json
COPY src/ticketing-sim/package.json src/ticketing-sim/package.json
RUN npm ci --omit=dev --ignore-scripts

# --- runtime -----------------------------------------------------------------
FROM base AS runtime
RUN addgroup -S nexo && adduser -S nexo -G nexo
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY src/shared ./src/shared
COPY src/ticketing-sim ./src/ticketing-sim

ENV PORT=4002
EXPOSE 4002
USER nexo

CMD ["node", "src/ticketing-sim/index.ts"]
