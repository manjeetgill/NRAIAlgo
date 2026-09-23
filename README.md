# NRAIAlgo

## Production deployment

See [DigitalOcean deployment](deploy/digitalocean/README.md) for Docker images,
managed PostgreSQL, TLS, secret provisioning, migration sequencing, first-user
bootstrap and broker registration. The current deployment supports the read-only
dashboard, not unattended order execution.

## Broker integration documentation

For the current implemented dashboard integrations (as distinct from the target architecture below), see:

- [Zerodha API README](ZERODHA_API_README.md) — SDK calls, streaming, account reads and historical-data integration status.
- [Kotak API README](KOTAK_API_README.md) — official Python SDK, REST/WebSocket integration, margin/P&L mapping and reconciliation.

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

## Focused dashboard tests

Related cases are grouped by responsibility rather than one test file per component:

- `apps/api/src/broker-auth/broker-portfolio.test.ts`: both brokers' portfolio normalization and Zerodha order reads.
- `apps/api/src/broker-auth/kotak-sdk.test.ts`: SDK IPC, error handling and production routing.
- `apps/api/src/market-data/broker-feeds.test.ts`: both streaming transports and recovery.
- `apps/api/src/market-data/live-overview.test.ts`: both brokers' freshness and reconciliation barriers.
- `apps/web/app/app/overview/overview-screen.test.tsx`: live, pre-open, closed/weekend and layout-selector rendering.

Browser polling, snapshot composition and cache-recovery tests remain separate because their mocks and lifecycles differ. Database-backed route tests and Python SDK tests are also separate; the focused suites above do not place orders or require live broker credentials.
