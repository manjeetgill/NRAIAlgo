# NRAIAlgo

Authenticated, read-only portfolio dashboard for Zerodha, Kotak Neo and ICICI
Breeze. Displays broker snapshots, live market updates, holdings, orders, funds,
and explicit data coverage. Order execution is not implemented.

## Workspace layout

| Directory | Responsibility |
| --- | --- |
| `backend/nodejs` | Node.js/Fastify API, authentication, broker adapters and streams |
| `backend/nodejs/src/database` | PostgreSQL adapter, schema/migrations, local setup and calendar import |
| `frontend/nextjs` | Next.js dashboard and account screens |
| `shared/typescript` | Shared API schemas and market-state types |
| `backend/python/kotak-sdk` | Private Python SDK subprocess bridge |
| `tests` | All automated tests, fixtures, setup and test runner |
| `docs` | Broker, dashboard, deployment and review documentation |
| `deploy` | Deployment configuration and operational scripts |

Next.js `.tsx`, `.ts`, and CSS files stay together inside `frontend/nextjs` so
routes, component imports, and framework conventions remain intact. Shared
TypeScript schemas live in `shared/typescript`; they are not frontend pages.
PostgreSQL code stays in the API's dedicated database folder so the API builds as
one deployable unit. Database data and credentials remain in the ignored root
`.runtime/` directory and are never moved into source control.

Root manifests, the lockfile, Dockerfile, and TypeScript base config coordinate
the workspaces. Run commands from the repository root; workspace package names
(`@nraialgo/api`, `@nraialgo/web`, `@nraialgo/contracts`) are unchanged.

## Requirements

- Node.js 22.13.0+ (see `.nvmrc`)
- PostgreSQL for local development; Docker for isolated API tests

## Getting started

```bash
npm ci
npm run dev
```

The frontend runs at `http://localhost:3010`. See [Kotak SDK setup](docs/brokers/kotak-sdk.md)
for its Python environment and [account access](docs/deployment/account-access.md)
for operator-managed login and recovery.

## Verification

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Each API test run creates its own PostgreSQL container with temporary credentials
and memory-backed storage, then removes it. Tests never connect to the application
database. Web and contract tests can run without Docker. See [testing](docs/testing.md)
for focused commands, Python checks and isolation details.

## Documentation and deployment

Start with the [documentation index](docs/README.md). The [DigitalOcean guide](docs/deployment/digitalocean.md)
describes production setup; [private staging](docs/deployment/private-staging.md)
describes the SSH-only deployment workflow. Build and deploy a committed revision.
