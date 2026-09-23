# ICICI Direct Breeze (read-only)

Broker Gateways includes an ICICI Breeze tab. Save the Breeze app API key and
secret, open the ICICI login page, and paste the resulting API session token into
the daily authorization form. Brokerage passwords are entered only at ICICI.
App credentials and broker sessions use the existing encrypted credential vault.
Reconfiguring ICICI invalidates its previous saved session. The application caps
sessions at midnight IST; ICICI can expire them earlier.

Broker Gateways is configuration-only. ICICI holdings, positions and orders appear
in shared consolidated tables and the ICICI individual dashboard across market states.
ICICI-specific bank balances and allocations appear only in its individual view. It
fetches funds, demat holdings, NSE equity portfolio holdings, portfolio positions, and today's NSE/NFO/BSE orders
on load and a serialized 30-second refresh cycle. Cash Holdings also supports manual
refresh. It is a timestamped REST snapshot, not streaming data.
Failures are reported per section. Unknown values are retained, never converted
to zero. Only explicitly allowed fields reach the browser; bank account numbers
and raw broker responses are excluded.

Supported holdings and position columns can be sorted from their headers.
Unavailable analytics and action columns are not sortable.
Numeric strings sort numerically; missing values stay last. The equity holdings
table includes Today's P&L (estimated): current quantity multiplied by the price
move implied by Breeze's change_percentage. This is not realized/session trading
P&L and is not adjusted for intraday quantity changes or charges. On non-trading
days it represents the latest broker-reported session. Missing or invalid daily
change values are unavailable, not zero.

## Current limits

- ICICI holdings participate in selected-scope portfolio summaries; incomplete
  coverage is marked explicitly. Session P&L and margin are not combined with ICICI
  funds or holdings P&L. ICICI is available in the dashboard broker selector. Funds allocation/bank balances
  must not be relabelled available trading margin. Demat holdings do not provide
  valuations; equity portfolio holdings supply cost and market price for calculated
  unrealized holdings P&L. This is not session P&L. Missing/zero costs or prices on
  nonzero holdings leave the value unavailable. Incomplete coverage shows only a
  labelled known subtotal. Portfolio positions may omit P&L.
- Quotes, historical candles, streaming subscriptions, trades, and the remaining
  Breeze endpoints are not implemented by this initial account integration.
- No order placement, modification, cancellation, fund transfer, or live execution.
- Read-only authentication, funds, demat and equity portfolio response shapes
  have been checked against the configured local account. Deployment verification
  is still required; this does not enable trading.
- No schema migration is required: the encrypted broker tables already use
  provider identifiers rather than a fixed provider enum.

## Protocol references

- https://api.icicidirect.com/breezeapi/documents/index.html
- https://github.com/Idirect-Tech/Breeze-Python-SDK

The official SDK uses GET requests with JSON bodies and a checksum of the exact
timestamp + serialized body + API secret. Node HTTPS is used because fetch does
not permit GET bodies. All requests use the fixed ICICI HTTPS API host, bounded
timeouts and response sizes; redirects are not followed.
