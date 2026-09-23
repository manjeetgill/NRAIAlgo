# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY backend/nodejs/package.json backend/nodejs/package.json
COPY shared/typescript/package.json shared/typescript/package.json
COPY frontend/nextjs/package.json frontend/nextjs/package.json
RUN npm ci

FROM dependencies AS api-build
COPY tsconfig.base.json ./
COPY shared/typescript shared/typescript
COPY backend/nodejs backend/nodejs
RUN npm run build --workspace shared/typescript && npm run build --workspace backend/nodejs

FROM dependencies AS web-build
COPY tsconfig.base.json ./
COPY shared/typescript shared/typescript
COPY frontend/nextjs frontend/nextjs
# Rewrites are compiled by Next; public /v1 traffic is routed by Caddy.
ENV API_INTERNAL_URL=http://api:4000
RUN mkdir -p frontend/nextjs/public && npm run build --workspace shared/typescript && npm run build --workspace frontend/nextjs

FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/nodejs/package.json backend/nodejs/package.json
COPY shared/typescript/package.json shared/typescript/package.json
COPY frontend/nextjs/package.json frontend/nextjs/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace=@nraialgo/api --workspace=@nraialgo/contracts && npm cache clean --force
COPY backend/python/kotak-sdk/requirements.txt backend/python/kotak-sdk/requirements.txt
RUN python3 -m venv backend/python/kotak-sdk/.venv && backend/python/kotak-sdk/.venv/bin/pip install --no-cache-dir -r backend/python/kotak-sdk/requirements.txt
COPY --from=api-build /app/backend/nodejs/dist backend/nodejs/dist
COPY --from=api-build /app/shared/typescript/dist shared/typescript/dist
COPY backend/python/kotak-sdk/bridge.py backend/python/kotak-sdk/bridge.py
USER node
EXPOSE 4000
CMD ["node", "backend/nodejs/dist/main.js"]

FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3010
COPY --from=web-build --chown=node:node /app/frontend/nextjs/.next/standalone ./
COPY --from=web-build --chown=node:node /app/frontend/nextjs/.next/static frontend/nextjs/.next/static
COPY --from=web-build --chown=node:node /app/frontend/nextjs/public frontend/nextjs/public
USER node
EXPOSE 3010
CMD ["node", "frontend/nextjs/server.js"]
