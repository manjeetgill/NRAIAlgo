# Kotak Neo API integration

Implementation reference for NRAIAlgo, reviewed 22 September 2026. This documents the current implementation, not all Kotak API capabilities. See [Zerodha integration](zerodha.md) for the other broker.

## Technology and responsibility

Kotak uses the official **Python SDK `kotakneoapi==3.0.7`** through a private subprocess bridge. Node retains dashboard aggregation and validation; Python handles broker login, account reads and WebSocket transport. There is no new HTTP service or public port. See [SDK setup and operations](kotak-sdk.md).

REST supplies Kotak account holdings, position quantities, margin balances and baseline valuations. WebSocket supplies price updates for Kotak positions and notifications that trigger account reconciliation. Zerodha still supplies the dashboard's three live index quotes; Kotak is not currently an automatic index-feed fallback.

## APIs used and why

`session.baseUrl` below is returned by successful Kotak login; account REST paths are appended to that base URL.

The SDK methods driving these operations are `totp_login`, `totp_validate`, `holdings`, `positions`, `limits`, `quotes`, `create_websocket` and `create_order_feed`. The endpoint list explains the upstream purposes; production Node code delegates these calls to the SDK rather than issuing those REST requests itself.

| API / channel | Purpose | Dashboard destination |
| --- | --- | --- |
| `POST https://mis.kotaksecurities.com/login/1.0/tradeApiLogin` | Submit app access token, mobile number, UCC and TOTP; obtain initial session | Broker authorization |
| `POST https://mis.kotaksecurities.com/login/1.0/tradeApiValidate` | Validate MPIN with initial session; obtain trading token, SID and base URL | Saved daily broker session |
| `GET {session.baseUrl}/portfolio/v1/holdings` | Read holding quantities and prices | Kotak holdings and combined portfolio summary |
| `GET {session.baseUrl}/quick/user/positions` | Read carry-forward/intraday quantities, amounts and contract factors | Kotak open-position rows and baseline P&L |
| `POST {session.baseUrl}/quick/user/limits` | Read account funds, margin, collateral and realised MTM | Kotak margin card and P&L baseline |
| `GET https://mis.kotaksecurities.com/script-details/1.0/quotes/neosymbol/{encoded-symbol-list}/ltp` | Obtain LTP baseline for open native-format positions, in batches of 50 | Initial/reconciled position valuation |
| `wss://sfeed.kotaksecurities.com/apifeed` | Stream native touchline prices for subscribed Kotak instruments | Position LTP and estimated P&L |
| `wss://{session-base-host}/realtime` | Receive order/position events | Trigger an earlier REST refresh; not a displayed Kotak order history |

Account REST uses `Auth` and `Sid` headers. Limits uses form-encoded `jData` with `seg`, `exch` and `prod` set to `ALL`. Quote lookup uses the saved app access token in `Authorization`. Never place actual credentials in this README or logs.

## Streaming and REST work together

1. `GET /v1/overview` loads the authenticated workspace's Kotak credentials and reads the account baseline.
2. The backend creates market and order sockets for that workspace. Market authentication requests `native_batch` with session validation enabled. Order authentication uses the saved token and SID.
3. Open positions determine subscriptions, keyed by `exchange segment|token`, for example `nse_fo|<token>`. Only matching Kotak account rows can receive these ticks.
4. The official SDK decodes the binary feed and applies negotiated price dividers. The bridge forwards decoded scrip prices with the source update timestamp; unsupported message types are not used as prices. Our custom Node binary decoder has been removed.
5. Fresh ticks update in-memory LTP and estimated P&L. They never invent position quantities or margin balances.
6. Order/position events and connection state changes mark account reconciliation pending. Valuation overlays wait for a successful REST snapshot whose read began after the pending event. Events arriving during that read remain pending for another refresh.

The browser reads our cached overview about once per second during the actual open session, not the Kotak API once per second. REST snapshots have a 10-second cache lifetime after refresh completion; events can prompt an earlier refresh with an approximately two-second throttle. This is request-driven and subject to network latency, not a hard timing guarantee. Outside the open session the visible browser polls about every 15 seconds. Hidden tabs pause periodic polling.

## Fields and calculations

| Screen value | Current source / calculation |
| --- | --- |
| Signed position quantity | Carry-forward plus intraday buy quantities minus corresponding sell quantities |
| Average entry | Side's buy/sell amount divided by quantity and contract multiplier |
| Position multiplier | Broker multiplier adjusted by `genNum/genDen` and `prcNum/prcDen` |
| Baseline gross P&L | Sell amount minus buy amount plus signed quantity × LTP × multiplier |
| Realised P&L, native response | Limits field `RealizedMtomPrsnt` |
| Unrealised P&L | Baseline gross minus realised |
| Tick valuation delta | `(new LTP - baseline LTP) × signed quantity × multiplier` |
| Available margin | Limits field `Net` |
| Used margin | Limits field `MarginUsed` |
| Collateral | Limits field `CollateralValue` |
| Holding value | Reported quantity × reported closing price, falling back to reported LTP |
| Charges / final net P&L | Unavailable until a real reconciliation source is integrated |

Monetary aggregates are converted to integer paise. Quantities are underlying units, not lot counts. Missing required numeric fields cause a provider failure rather than silently becoming zero. Combined broker balances are informational sums, not interchangeable capital across accounts.

## Freshness, recovery and limits

- Order/channel events advance a reconciliation generation. Only a successful Kotak account read covering that generation clears the barrier; a Zerodha failure does not block it. A later event, including one in the same millisecond, requires another read.
- Kotak reconciliation age is tracked separately. Pending/stale account state degrades the positions, P&L and holdings/margin panels; another provider's refresh cannot make Kotak margins fresh.
- SDK consumers survive temporary iterator exhaustion. A terminal channel or 120-second reconnect timeout retires the bridge; Node restores desired subscriptions in the replacement and ignores old-child callbacks.
- Browser requests have a 30-second deadline covering headers and body, with bounded retry backoff. Price freshness expires independently after 15 seconds and account-panel freshness after 30 seconds; cached values remain visible with stale/degraded labels.
- Tick overlays require an actual open market state, a streaming connection, a reconciled account baseline no older than 30 seconds, and a tick no older than 15 seconds by receipt and source time.
- A tick older than the position baseline is not applied. Stale or pending data stays labelled accordingly; connected does not mean fresh.
- The official SDK owns socket authentication, keepalives, reconnection and subscription restoration. Both channels are configured for up to 10 SDK reconnect attempts. Node separately uses ten rapid bridge-restart retries, then a recovery probe every five minutes. Both channels streaming for 60 seconds resets that budget. Explicit authentication/missing-runtime failures need operator action.
- SDK REST reads use an eight-second timeout; each login/portfolio child has an overall 30-second deadline. The bridge exposes only login, portfolio and streaming operations, never arbitrary order mutations.
- The order socket accepts only an HTTPS session base URL on a `kotaksecurities.com` host. Standard TLS verification remains enabled.
- Current code caps subscriptions at 3,000 and active workspace feed entries at 32. These are implementation limits, not broker entitlement guarantees.
- Idle feeds are stopped after approximately 60 seconds without use, checked periodically. Credential changes replace the workspace's feed and old callbacks are ignored.
- Feed/cache state is in memory. Use a single API feed owner until shared ownership and fan-out are implemented. This is a dashboard connection, not an always-on execution service or durable market-data archive.

After close and on holidays/weekends, account reads can continue while credentials remain valid. Fresh live tick valuations are not forced. The shared index closing-reference source is NSE data, not Kotak historical candles. Market close does not prove settlement, zero positions or final P&L.

## Setup and security

Save Kotak app credentials in Broker Gateways, then complete the daily TOTP/MPIN flow. Relevant application routes:

- `POST /v1/broker-credentials/kotak`
- `POST /v1/broker-auth/kotak/login`
- `GET /v1/broker-auth/status`
- `GET /v1/overview`

The app records a maximum session lifetime of eight hours from login. This is an application cap, not a guarantee that Kotak keeps the session valid that long, and it is not an assumed 15:30 expiry. Broker authorization, platform login and strategy deployment authorization are separate.

App credentials and saved broker sessions use the server credential vault with AES-256-GCM and workspace/provider context. Production requires `CREDENTIAL_VAULT_KEY`. The frontend receives normalized account data and status, not saved broker tokens. Never commit keys, tokens, MPINs, TOTPs or runtime vault files.

## Files to maintain

| File | Responsibility |
| --- | --- |
| `services/kotak-sdk/bridge.py` | Official SDK login, account reads, session restoration and decoded streams |
| `services/kotak-sdk/requirements.txt` | Pinned official SDK dependency |
| `apps/api/src/broker-auth/kotak-sdk.ts` | Private child-process protocol, deadline and schema validation |
| `apps/api/src/broker-auth/kotak.ts` | SDK login delegation, session schema and expiry cap |
| `apps/api/src/broker-auth/kotak-portfolio.ts` | SDK account reads, response normalization and margin/P&L calculations |
| `apps/api/src/market-data/kotak-feed.ts` | SDK child lifecycle, validated events and subscriptions |
| `apps/api/src/market-data/kotak-live-overview.ts` | Workspace isolation, reconciliation barrier and tick valuation |
| `apps/api/src/routes/broker-auth.ts` | Authenticated login endpoints and session persistence |
| `apps/api/src/routes/overview.ts` | Account cache and both broker overlays |
| `apps/api/src/build-overview-snapshot.ts` | Combines broker data and provider failure handling |
| `apps/web/app/app/overview/market-open-screen.tsx` | Positions, margin cards and stream-status presentation |

## Not implemented by this integration

Kotak historical candles, displayed Kotak order-book history, order placement/modification/cancellation, automated broker failover, strategy ownership, risk authorization and final contract-note reconciliation are not supplied by this implementation. The order socket is a reconciliation notification channel; it is not a complete immutable audit log. A connected broker does not unlock execution controls.

## Verification and troubleshooting

Check both Kotak WebSocket labels, each position's last tick and the account snapshot timestamp. If REST works but prices do not stream, inspect subscription mapping, session validity and market-channel status. If ticks arrive but valuation waits, inspect pending/failed REST reconciliation. If no positions exist, a connected stream with no subscribed position prices is expected. Do not use Zerodha numeric tokens for Kotak instruments.

Focused tests: `broker-auth/kotak.test.ts`, `broker-auth/kotak-sdk.test.ts`, `broker-auth/broker-portfolio.test.ts`, `market-data/broker-feeds.test.ts`, `market-data/live-overview.test.ts`, `multi-broker-overview.test.ts` and `routes/overview-recovery.test.ts` under `tests/api`, plus `tests/python/test_bridge.py`. Related broker cases are grouped in these suites; database-backed route tests remain separate. Read-only live verification confirmed SDK account reads, market ticks and order-channel connection. Daily login is unit-tested; it was not rerun with the user's MPIN/TOTP. No order was placed to test an execution event.
