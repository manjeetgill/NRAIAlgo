# Zerodha API integration

Implementation reference for NRAIAlgo, reviewed 22 September 2026. This describes the checked-in application code, not every capability offered by Kite Connect. See [Kotak integration](kotak.md) for the other broker.

## Technology and responsibility

The backend uses the official `kiteconnect` Node.js SDK (`KiteConnect` for REST and `KiteTicker` for WebSocket). There is no Python SDK in this dashboard integration. Broker credentials and broker sockets remain on the server.

Zerodha supplies the dashboard's live NIFTY 50, BANK NIFTY and INDIA VIX prices, plus prices for Zerodha positions. It also supplies its own account holdings, positions, margins and recent orders. Kotak positions are priced separately with Kotak tokens; tokens are not interchangeable.

## APIs used and why

| SDK method / event | Application purpose | Current use |
| --- | --- | --- |
| `getLoginURL()` | Send the user to broker authorization | Broker connection setup |
| `generateSession(requestToken, apiSecret)` | Exchange the callback token for the broker session | After successful broker login |
| `setAccessToken()` | Authenticate subsequent SDK reads | Server-side clients |
| `getHoldings()` | Holding quantities, values and pledged quantities | Portfolio and holding summaries |
| `getPositions()` | Authoritative account position quantities, average entry and reported P&L | Open-position table and P&L baseline |
| `getMargins()` | Equity margin balance, utilisation and collateral | Zerodha margin card and combined summary |
| `getOrders()` | Read the same-day order book | Latest 50 orders in Recent Zerodha Orders; not an audit ledger |
| `getLTP()` | Resolve today's tokens for the three dashboard indices | Feed startup, with bounded retries |
| `KiteTicker.subscribe()`, `unsubscribe()`, `setMode(modeFull)` | Maintain subscriptions for indices and this account's positions | Live market streaming |
| `ticks` | Update cached prices and estimated position P&L | Dashboard live valuations |
| `order_update` and ticker connect | Request an earlier REST reconciliation | Refresh account quantities after events/reconnect |

The Overview live price source is the persistent ticker. The unused standalone
REST LTP and historical-candle helpers were removed during repository cleanup;
historical research remains outside the implemented dashboard.

## Data flow and refresh

1. An authenticated request to `GET /v1/overview` loads that workspace's saved broker session.
2. REST reads build the account baseline. A workspace-scoped ticker worker maintains live subscriptions.
3. Ticks update the server's in-memory price cache. The backend overlays valid prices onto the last account snapshot.
4. The browser polls our overview endpoint about once per second during the actual open session. It does not open a broker WebSocket or call broker REST once per second.
5. Account REST results are cached for 10 seconds after a completed refresh. Order/connect events can request an earlier refresh, subject to an approximately two-second throttle. Refresh is request-driven, not an independent always-running reconciliation worker.

Visible tabs poll about every 15 seconds outside the open session. Background polling pauses while hidden; returning to the tab requests a refresh. Price changes depend on actual broker ticks: a one-second display cadence does not guarantee a different price each second.

## What the numbers mean

- Holdings value comes from broker quantity multiplied by reported last price.
- Available margin uses `margins.equity.net`; used margin uses `equity.utilised.debits`; collateral uses `equity.available.collateral`. This is not strategy capital allocation or a cross-broker transferable pool.
- REST P&L sums reported realised and unrealised values from net positions. Live revaluation adds `(new price - baseline price) × signed quantity × multiplier`, converted to paise, to the baseline. It does not repeatedly add the same tick to prior estimates.
- Tick P&L is provisional. Charges and final net P&L remain unavailable until a real reconciliation source exists.
- Prices older than 15 seconds are not labelled fresh. Position overlays stop if the account baseline is older than 30 seconds. Broker receipt time is used if a tick has no exchange timestamp.
- Outside regular market hours, the overview retains its NSE last-completed-session closing reference rather than labelling it live. That source is implemented in `nse-bhavcopy.ts`, not the historical-candle helper. Closing the market does not itself finalise P&L or settle an account.

## Authentication and isolation

Save app credentials through Broker Gateways, then complete Zerodha authorization. Relevant application routes:

- `POST /v1/broker-credentials/zerodha`
- `GET /v1/broker-auth/zerodha/redirect-url`
- `GET /v1/broker-auth/zerodha/login-url`
- `GET /v1/broker-auth/zerodha/callback`
- `GET /v1/broker-auth/status`

The callback uses single-use stored state to identify the workspace. The application records expiry at the next 06:00 IST; broker rejection can still require earlier reauthorization. Broker authorization is separate from platform login and deployment authorization.

The credential vault uses AES-256-GCM with workspace/provider-bound context. Production requires `CREDENTIAL_VAULT_KEY`; never commit keys, tokens or runtime vault files. The ticker runs in a separate Node worker per feed because the installed SDK has module-level ticker state. Worker stdout/stderr are suppressed to avoid exposing credential-bearing socket errors.

The current implementation bounds feeds to 32 workspaces and three workers per API key, and subscriptions to 3,000 tokens. These are code limits, not a promise of broker entitlement. Feeds are removed after approximately 60 seconds without use, checked by periodic cleanup. Deploy one API feed owner; multiple replicas need coordinated ownership and fan-out first. This is not an always-on strategy engine.

## Files to maintain

| File | Responsibility |
| --- | --- |
| `backend/nodejs/src/broker-auth/zerodha.ts` | Login URL, token exchange, session schema and expiry |
| `backend/nodejs/src/broker-auth/zerodha-portfolio.ts` | Holdings, margins, positions and P&L baseline |
| `backend/nodejs/src/broker-auth/zerodha-orders.ts` | Recent order-book panel |
| `backend/nodejs/src/market-data/kite-feed.ts` | SDK worker, subscriptions and events |
| `backend/nodejs/src/market-data/live-overview.ts` | Cached ticks, freshness and valuation overlay |
| `backend/nodejs/src/routes/overview.ts` | Authenticated snapshot cache and refresh coordination |
| `backend/nodejs/src/build-overview-snapshot.ts` | Combines broker account reads and closing references |
| `frontend/nextjs/app/app/overview/use-overview-snapshot.ts` | Browser polling and stale-response handling |

## Not implemented by this integration

No live order placement, modification, cancellation, flattening, strategy execution, automated cross-broker failover, final contract-note reconciliation or durable tick archive is provided by these dashboard reads. Historical import, backtesting and strategy-owned positions remain separate work. A connected feed is not permission to trade.

## Verification and troubleshooting

Order and connection events advance a reconciliation generation. Tick-based position/P&L estimates remain blocked until a successful Zerodha account read covers the current generation. Per-broker reconciliation evidence prevents Kotak failures from blocking a healthy Zerodha read (and vice versa).

Terminal worker failures trigger supervised replacement with exponential backoff (1 second up to 30 seconds, maximum 10 consecutive restarts; a stable 60-second connection resets the failure budget). Desired subscriptions are restored, old-worker callbacks are ignored, and shutdown cancels retries. Explicit authentication rejection waits for new credentials rather than repeatedly retrying them.

Browser requests time out after 30 seconds, including stalled response bodies. Local timers expire tick freshness after 15 seconds and account-panel freshness after 30 seconds even if a response never arrives. A failed initial overview build returns a controlled 503 during its two-second cache retry cooldown.

Check daily broker authorization first, then the displayed WebSocket status, last-tick time, row freshness and REST account timestamp. A connected socket without fresh subscribed ticks is not a fresh price source. Missing market-data entitlement, expired sessions, network interruptions and illiquid instruments can all affect freshness; do not fill gaps with dummy values.

Focused tests include `broker-auth/zerodha.test.ts`, `broker-auth/broker-portfolio.test.ts`, `market-data/broker-feeds.test.ts`, `market-data/live-overview.test.ts`, `multi-broker-overview.test.ts` and `routes/overview-recovery.test.ts` under `tests/api`. Portfolio/order-read cases share one suite, transport recovery another, and valuation/reconciliation another; database-backed route tests remain separate.
