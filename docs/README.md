# Documentation

- Dashboard: [live data](dashboard.md), [broker views](broker-views.md), [Alpha Wire](alpha-wire.md)
- Brokers: [Zerodha](brokers/zerodha.md), [Kotak](brokers/kotak.md), [Kotak SDK](brokers/kotak-sdk.md), [ICICI Breeze](brokers/icici.md)
- Operations: [DigitalOcean](deployment/digitalocean.md), [private staging](deployment/private-staging.md), [pgAdmin](deployment/pgadmin.md), [account access](deployment/account-access.md)
- Development: [testing and database isolation](testing.md)
- Historical evidence: [reviews](reviews/) records point-in-time findings and must not be read as the current release status.

Application source lives in `frontend/`, `backend/`, and `shared/`, operational files in `deploy/`, and all
automated tests in `tests/`. The root README is the repository entry point.
Framework-generated `frontend/nextjs/AGENTS.md` and `CLAUDE.md` stay beside Next.js
because its tooling regenerates them there.

Use plain, descriptive commit subjects and explain behavior and verification in
the body. Do not use `feat` prefixes. Keep commits grouped around coherent changes.
