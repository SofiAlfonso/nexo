# C1 — lector emulado y generador de carga. Build desde la raíz del repo
# (monorepo con npm workspaces), no desde esta carpeta:
#   docker build -f src/reader-client/Dockerfile -t nexo/reader-client:dev .
#
# Node 24 ejecuta TypeScript nativamente (ADR-014); no hay paso de `tsc`.
# El entrypoint es la CLI (`cli/index.ts`); se invoca por subcomandos, p. ej.:
#   docker run nexo/reader-client:dev start --perfil nominal --lectores 20 \
#     --coordinador http://local-coordinator:8081 --boletas /datos/boletas.json
# Sin argumentos, muestra la ayuda (ver src/reader-client/cli/README.md).

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
COPY src/reader-client ./src/reader-client
COPY tests/load ./tests/load

USER nexo

ENTRYPOINT ["node", "src/reader-client/cli/index.ts"]
CMD ["--help"]
