# Zerodha live dashboard

## Data path

Kite WebSocket -> isolated server worker -> workspace tick cache -> authenticated
GET /v1/overview -> browser refresh once per second during the regular market.

The worker consumes incoming ticks. The browser shows the latest value each
second, not every individual tick, and does not call the broker once per second.
This is a monitoring display, not an execution or tick-history recording engine.

## What is connected

- NIFTY 50, BANK NIFTY and INDIA VIX: token lookup using Kite LTP once at worker
  startup; subsequent prices from full-mode WebSocket packets.
- Open Zerodha positions: account positions REST snapshot, subscribed by the
  returned instrument tokens. New fresh ticks estimate gross P&L changes using
  signed quantity and the instrument multiplier. REST remains quantity authority.
- P&L, holdings and equity-account margins: REST reconciliation approximately
  every ten seconds, shared between tabs. Broker requests can take longer.
- Broker margin cards: actual available margin, utilised debits and collateral.
  Margin is not strategy capital and can be negative.
- Latest 50 same-day Zerodha orders: order book REST. Socket order updates and
  reconnects request an earlier account reconciliation, throttled to avoid bursts.
  This is not a durable audit log or an unknown-order execution reconciler.
- Outside regular market hours: slower 15-second browser refresh, existing
  calendar-driven states and official-close reference behavior are retained.

## Start and authenticate

1. Build shared contracts (`npm run prepare-contracts`) and restart API/web, or
   use the repository's normal `npm run dev` workflow.
2. Sign in to NRAIAlgo and configure Zerodha under Broker Gateways.
3. Complete Zerodha's normal interactive daily login with the paid data-enabled
   API application. No stored-password/TOTP automation is introduced.
4. Open `/app/overview`. The server calendar selects the market state. In an open
   session the page reports feed state, last tick, price/position timestamps and
   account provenance. A subscription alone does not replace a valid daily token.

## Failure and security behavior

- Broker tokens stay on the API host. The cookie-authenticated endpoint derives
  workspace/account identity server-side and sends `Cache-Control: no-store`.
- Kite SDK 5.3 has module-level socket state. Each workspace uses a separate worker
  isolate, preventing cross-account event handlers or sockets from mixing.
- Reconnect uses bounded SDK backoff and resubscribes the desired tokens. Old
  connection ticks are cleared. Out-of-order, invalid and future-dated values
  are rejected; ticks older than 15 seconds are not labelled fresh.
- After 30 seconds without a successful account snapshot, account panels are
  degraded and position P&L projection stops. Unknown is never displayed as zero.
- Credential removal/rotation is noticed on the next server account refresh;
  the old worker is terminated. Idle feeds are removed after roughly one minute.
- Display refreshes pause in hidden tabs and do not overlap slow requests.
- Execution buttons remain disabled. Feed readiness does not authorize trades.
- Net P&L/charges, Greeks, strategy ownership/capital and cross-broker execution
  remain unavailable unless implemented separately. Kotak ticks/position rows
  are not supplied by this Zerodha integration.

## Deployment boundary

Run one API instance owning these feeds. The cache, subscription limits and
reconciliation throttles are in-process: they are NOT distributed guarantees.
Before horizontal scaling, move feed ownership to a dedicated worker service
with leases/pubsub and a shared broker-account request/connection budget. This
implementation bounds active workers to 32 and connections per API key to 3;
other programs using the same API key also consume Zerodha's connection budget.
Max 3,000 tokens per feed. Full tick history is not persisted by this dashboard.

## References

- https://kite.trade/docs/connect/v3/websocket/
- https://kite.trade/docs/connect/v3/portfolio/
- https://kite.trade/docs/connect/v3/orders/
