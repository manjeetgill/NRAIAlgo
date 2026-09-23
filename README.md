# NRAIAlgo

Multi-tenant algorithmic trading platform for Indian broker accounts (Kotak Neo, ICICI Breeze, Zerodha, Upstox).

Architecture: modular TypeScript monolith (Fastify API, Next.js frontend, Node.js worker) with an isolated Python broker-adapter service, PostgreSQL as the durable source of truth, and Redis for ephemeral cache/fan-out only. See the approved technical and product specification for the full contract.

## Workspace layout

- `apps/web` — Next.js frontend
- `apps/api` — Fastify API (health check only so far)

Additional workspaces (`apps/worker`, `services/broker-adapter`) are added incrementally, each in its own commit.

## Requirements

- Node.js 22.13.0+ (see `.nvmrc`)

## Getting started

```bash
npm install
npm run dev
```
