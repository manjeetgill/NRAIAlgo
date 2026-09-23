# Kotak official SDK bridge

Uses the official `kotakneoapi==3.0.7` Python package. Node starts private child processes and exchanges JSON lines over stdin/stdout. No HTTP listener or new network port is exposed. Zerodha remains on the official Node SDK.

## Install (from repository root)

```sh
python3 -m venv services/kotak-sdk/.venv
services/kotak-sdk/.venv/bin/python -m pip install -r services/kotak-sdk/requirements.txt
```

Python 3.10+ is required by the SDK; this integration was tested with Python 3.14. Set `KOTAK_SDK_PYTHON` in the API process environment to an alternate interpreter if needed. Otherwise Node uses the repository-local `.venv/bin/python`. Deploy the `services/kotak-sdk` directory alongside `apps/api`; the compiled API resolves the same repository-relative path.

Missing Python/dependencies produces an unavailable broker result, never an automatic return to the old custom transport. SDK upgrades must be deliberate: pin the version and rerun normalization, session-restoration and streaming checks.

## Responsibilities

- `login`: official `totp_login` then `totp_validate`; returns only the session fields the existing encrypted vault stores.
- `portfolio`: restore the saved session in SDK configuration; call `holdings`, `positions`, `limits` and `quotes`. Holdings/positions/limits run concurrently; quotes are batched by 50. Node retains existing paise-based normalization and account identity checks.
- `stream`: official `create_websocket` and `create_order_feed`. The SDK handles binary decoding and socket recovery. The bridge emits only normalized prices, channel states and order/position reconciliation notifications.
- No arbitrary SDK method dispatch; no order submission, cancellation, modification or logout operations are exposed.

The stream uses one child per active Kotak workspace. Login and portfolio calls use short-lived children, with a 30-second Node deadline and eight-second SDK REST timeout. This keeps account sessions isolated but adds Python startup cost per account refresh. For higher user counts, replace per-read children with a supervised workspace-scoped worker pool, keeping the same protocol and security boundaries.

Credentials travel only through private stdin, not argv or environment variables. SDK stdout is redirected away from the protocol, stderr is drained without publication, and only fixed failure messages cross the boundary. Do not enable unreviewed SDK file logging. Session base URLs must use HTTPS on a Kotak host. TLS verification stays enabled. The existing vault and authenticated workspace routing remain authoritative.

The SDK owns reconnection, keepalives and subscription restoration. Node retries crashed bridge processes with bounded backoff (ten rapid retries, followed by one recovery probe every five minutes). The retry budget resets after both channels remain streaming for 60 seconds. Explicit authentication or missing-runtime errors require operator action. Closing the dashboard eventually releases idle workspace feeds; this is not an unattended strategy runner. Tick freshness and account reconciliation are still enforced by `KotakLiveOverview`.

The bridge keeps SDK consumers alive when an iterator ends during a temporary disconnect. A channel that fails or remains disconnected for 120 seconds shuts down the bridge; Node replaces it and restores desired subscriptions. Initial connection has a 30-second deadline. Retired-child callbacks are ignored.

IPC errors are allowlisted: `TOTP_LOGIN`, `MPIN_VERIFY`, `SDK_TIMEOUT`, `SDK_MISSING`, `SDK_UPSTREAM`, and `SDK_INVALID_RESPONSE`. Authentication rejections preserve their stage; timeouts remain timeouts. Raw broker responses and exception text are never forwarded as error messages.

## Test

```sh
services/kotak-sdk/.venv/bin/python -m unittest discover -s services/kotak-sdk -p 'test_*.py'
npm exec --workspace apps/api -- vitest run src/broker-auth/kotak-sdk.test.ts src/market-data/broker-feeds.test.ts src/market-data/live-overview.test.ts src/broker-auth/broker-portfolio.test.ts
```

Tests use mocks, not live trading. Read-only live verification can use an already-authorized account; never put credentials in fixtures or shell arguments. Daily-login behavior is unit-tested, not verified by silently reauthenticating a user's account.
