# Tests and database isolation

All automated tests live in `tests/`, grouped into `api`, `web`, `contracts`,
`python`, and `deploy`. One Vitest configuration covers TypeScript tests.
Relative imports point to application source; production builds exclude tests.

## Commands (from the repository root)

```bash
npm test
npm run test:api
npm run test:web
npm run test:contracts
npm run test:api -- tests/api/routes/auth.test.ts
backend/python/kotak-sdk/.venv/bin/python -B -m unittest discover -s tests/python -p 'test_*.py'
python3 -B -m unittest discover -s tests/deploy -p 'test_*.py'
```

API tests require Docker and the `postgres:17` image (pulled automatically if
missing). Web and contract tests need neither Docker nor a database. Python SDK
tests require the dependencies in `backend/python/kotak-sdk/requirements.txt`.
`npm run test:smoke` is an opt-in read of external NSE data; it is excluded from
normal tests and does not use application database credentials.

## Database boundary

The runner ignores inherited database URLs, PostgreSQL environment variables,
vault keys and setup tokens. It never reads `.runtime/postgres-access.json`,
application secret files, or `.env`. Each API run starts a new PostgreSQL cluster
on a random loopback port, with random credentials and a tmpfs data directory.
No application directory or database volume is mounted. Both the migration
owner and the restricted application role exist only in this temporary cluster.

Migration, authentication, permission and transaction tests write fixtures only
inside that disposable cluster. They never write to the application database.
PostgreSQL client guards reject any connection outside the two generated test
URLs, and a mock rejects attempts to read local application DB configuration.
Direct Vitest API invocation without the runner fails closed, including in CI.
No application database read is needed for these automated tests.

The container is removed on completion, failure, SIGINT and SIGTERM. An uncatchable
process kill can leave a container named `nraialgo-tests-<UUID>`; inspect the
`nraialgo.purpose=isolated-tests` label before removing that exact container.
The runner never falls back to an existing PostgreSQL service if Docker fails.

CI uses this same runner. Release tests mock Docker/SSH operations and never
deploy anything. Broker tests use fake responses and do not place orders.
