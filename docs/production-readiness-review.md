# Code and release review — 2026-09-22

## Decision

Follow-up: see `manual-validation-2026-09-22.md` for the subsequent fixes, 320-test
run, manual browser matrix, and unresolved multi-tab rate-limit finding.

**Not yet approved for production promotion.** Local code validation is passing,
but local builds are not evidence of deployment-host readiness. No staging or
production deployment was performed during this review. Trading remains read-only.

## Review scope

Reviewed the current working tree, including uncommitted ICICI integration,
portfolio and dashboard changes, plus the existing authentication, credential
vault/session boundaries, database runtime configuration, Dockerfile, Compose
configurations and private-staging release script. This is a targeted engineering
review, not a penetration test or a guarantee that the repository has no defects.

## Confirmed findings addressed

| Priority | Finding | Resolution / regression coverage |
| --- | --- | --- |
| P1 | An in-flight broker login could save a session after app credentials changed. | Lock and compare credentials in the session-save transaction; invalidate old sessions on rotation for every provider. Concurrent ICICI rotation regression added. |
| P1 | Cookie-authenticated mutations lacked explicit origin enforcement. | Reject mismatched Origin and cross-site browser mutations before handler/database work. Same-origin and cross-origin tests added. |
| P2 | Sensitive protected responses did not explicitly prevent caching. | Set Cache-Control: no-store in the shared authentication guard, including unauthorized responses. Regression added. |
| P2 | ICICI polling could stall indefinitely and stop updating account data. | 20-second abort deadline; serialized retries; unmount cancellation. Fake-timer regression verifies timeout and retry. |
| P2 | Cash Holdings duplicated broker fetching and normalization. | Reuse the same polling hook and validated financial model as the dashboard. |
| P2 | Obsolete standalone ICICI account UI and generic tables remained in the source tree. | Removed unused panel and its obsolete tests; retained gateway tests and added direct financial-model tests. |
| P2 | Missing numeric values and non-option descriptors could produce misleading rows. | Null-preserving safe-integer paise conversion; preserve short exposure; omit option metadata for futures; never count demat rows as another portfolio. |
| P2 | Detailed Zerodha holdings fields were discarded before reaching the UI. | Preserve available price/cost/ISIN/exchange and explicitly estimated holding P&L through the shared contract. Unknown fields remain absent. |

## Local verification

- Full suite: **318 tests passed** (204 API, 17 contracts, 97 web).
- Workspace type checks and ESLint passed.
- Production dependency audit (`npm audit --omit=dev`): zero known reported vulnerabilities at review time. This does not scan OS or Python dependencies.
- API and web Docker images built locally. Images have non-root application users;
  deployment configurations retain read-only filesystems, dropped capabilities,
  and no-new-privileges.
- Deployment shell syntax checked; final container smoke-test results recorded
  in the review handoff.
- Existing API tests exercise workspace-scoped reads and encrypted broker-session
  storage. New tests cover origin rejection, cache policy, rotation races, and
  missing financial values.

## Required promotion gates

1. Review and commit the complete intended change set. The deployment script ships
   **committed files only**; this working tree is not a release artifact.
2. Deploy that exact commit to private staging, record image digests, run schema
   migration using admin credentials, then verify readiness with the restricted
   runtime database role. Do not mount migration credentials into the API.
3. Reauthorize Zerodha and Kotak in the target environment. During local manual
   testing only ICICI was configured/authorized; actual Zerodha/Kotak balances and
   account comparisons could not be signed off. Recheck partial/error states and
   compare totals against each broker's current account report.
4. Validate the production domain, HTTPS certificate, same-origin API routing,
   login, invitation/recovery flows with designated test accounts, cookie flags,
   unauthenticated API rejection and development-route 404 on the target host.
5. Back up PostgreSQL **and the matching vault key** to protected off-host storage.
   Restore into an isolated database and verify login/readability. An on-host dump
   or `pg_restore --list` alone is not a successful recovery drill.
6. Verify restart/reconnection behavior, resource usage on the actual Droplet,
   monitoring/alerts and failure rollback procedure. Keep one API replica because
   market-feed ownership/caches are process-local. Shared multi-tab ICICI polling
   can hit the conservative read-rate limit; test expected operator usage.
7. Promote the verified artifact only after these checks. The DigitalOcean public
   Compose target expects a domain and separately configured PostgreSQL; it is not
   interchangeable with the existing localhost-tunnel private-staging stack.

## Deliberate limitations

- No live order execution, automated failover, or high-availability claim.
- No fabricated Greeks, historical trend, dividend data, collateral haircut,
  PIS/NRO classification, net P&L or trading margin from bank balances.
- Session P&L from different broker APIs is not combined unless attribution and
  period semantics are known. Incomplete totals must remain marked incomplete.
- Schema changes are forward-only. Review compatibility before rollback; restoring
  an earlier image alone is not a database recovery strategy.
