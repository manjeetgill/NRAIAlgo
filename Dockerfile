# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/contracts/package.json apps/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

FROM dependencies AS api-build
COPY tsconfig.base.json ./
COPY apps/contracts apps/contracts
COPY apps/api apps/api
RUN npm run build --workspace apps/contracts && npm run build --workspace apps/api

FROM dependencies AS web-build
COPY tsconfig.base.json ./
COPY apps/contracts apps/contracts
COPY apps/web apps/web
# Rewrites are compiled by Next; public /v1 traffic is routed by Caddy.
ENV API_INTERNAL_URL=http://api:4000
RUN mkdir -p apps/web/public && npm run build --workspace apps/contracts && npm run build --workspace apps/web

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/contracts/package.json apps/contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@nraialgo/api --workspace=@nraialgo/contracts && npm cache clean --force
COPY services/kotak-sdk/requirements.txt services/kotak-sdk/requirements.txt
RUN python3 -m venv services/kotak-sdk/.venv && services/kotak-sdk/.venv/bin/pip install --no-cache-dir -r services/kotak-sdk/requirements.txt
COPY --from=api-build /app/apps/api/dist apps/api/dist
COPY --from=api-build /app/apps/contracts/dist apps/contracts/dist
COPY services/kotak-sdk/bridge.py services/kotak-sdk/bridge.py
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3010
COPY --from=web-build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
COPY --from=web-build --chown=node:node /app/apps/web/public apps/web/public
USER node
EXPOSE 3010
CMD ["node", "apps/web/server.js"]
