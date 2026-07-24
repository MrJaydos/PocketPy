# Multi-stage build: compile the React client, then ship a lean runtime image that
# serves both the API and the built client from a single Node process on one port.

# ---- Stage 1: build ---------------------------------------------------------
FROM node:24-bookworm-slim AS build
WORKDIR /app

# Build tools so better-sqlite3 can compile from source if no prebuilt binary is
# available for the platform (normally prebuild-install just downloads one).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (better layer caching): copy only manifests, then ci.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

# Copy the rest and build the client (also copies the pinned Pyodide runtime into
# the client's public/ so it ends up in dist/ and is served same-origin).
COPY . .
RUN npm run build:client

# Drop devDependencies so they don't travel to the runtime image.
RUN npm prune --omit=dev

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Copy only what the server needs at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/challenges ./challenges
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/package.json ./package.json

# The SQLite file lives on a mounted volume at /data (see docker-compose / Coolify).
# Run as the built-in non-root "node" user and give it ownership of the data dir.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

ENV PORT=3000
EXPOSE 3000

# Coolify can use this, and it also gives `docker` a health signal. Uses Node's
# built-in fetch (Node 18+) so we need no extra tools like curl.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
