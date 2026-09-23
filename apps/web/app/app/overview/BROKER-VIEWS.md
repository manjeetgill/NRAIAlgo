# Market-open broker views

UI-only: All brokers, Zerodha, and Kotak Neo share the existing market-open
sections, including Active Execution Engines. Other market-session layouts are
unchanged. Switching the view never changes execution routing or server scope.

Holdings and positions keep provider/account identifiers and separate rows for
identical instruments in different accounts. Zero-net-quantity positions are
excluded from the open-position display. Balances are not a transferable margin
pool. Market prices and readiness telemetry remain explicitly shared.

## Current API coverage (reviewed 2026-09-22)

- Zerodha GET /orders provides the day's order book; the current application
  adapter limits the snapshot to 50 rows. Its rows lack explicit provider/account
  fields, so the UI uses the known Zerodha-only contract and account reconciliation
  metadata. It does not claim to show complete order history.
- Kotak's SDK offers order_report(), positions(), holdings(), and limits(). The
  current bridge calls the latter three, not order_report(). The UI explicitly
  reports Kotak orders as unavailable instead of displaying Zerodha's rows.
- P&L is combined by the backend. A single-provider source can be shown in its
  matching individual view; a combined source cannot be split safely using open
  positions. Individual P&L is unavailable until a per-broker read model exists.
- Deployment/activity lack structured broker attribution. These sections remain
  visible but show an explanatory unavailable state in individual views.
- No execution endpoints, database migrations, authentication changes, or extra
  broker requests are introduced by this UI change.

References:
https://kite.trade/docs/connect/v3/orders/
https://kite.trade/docs/connect/v3/portfolio/
https://github.com/Kotak-Neo/Kotak-neo-api-v2
