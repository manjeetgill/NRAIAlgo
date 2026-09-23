"use client";
import Link from "next/link";
import type { OverviewSnapshot } from "@nraialgo/contracts";
import { type IciciAccount } from "./icici-model";
import { iciciPositions } from "./icici-model";
import { OpenPositions } from "./open-positions";
import { brokerViewLabels, selectedProviders, hasCoreCoverage, type BrokerView } from "./broker-view";
import { formatPaise } from "./format";
import styles from "./market-open.module.css";
import { BrokerDataStatus } from "./broker-data-status";

/** Same account tables for every non-live layout; broker selection scopes rows. */
export function AccountDetails({ snapshot, broker, account, status, iciciStale = false }: { snapshot: OverviewSnapshot; broker: BrokerView; account: IciciAccount | null; status: string; iciciStale?: boolean }) {
  const include = selectedProviders(snapshot, broker).includes("icici");
  const labels = brokerViewLabels(snapshot);
  const positions = [...(snapshot.positions?.data ?? []).filter(row => row.quantity !== 0).map(row => ({ id: `${row.provider}:${row.accountId}:${row.symbol}:${row.product}`, provider: row.provider, account: row.accountId, symbol: row.symbol, exchange: row.exchange, product: row.product, quantity: row.quantity, average: row.averagePrice, ltp: row.lastPrice, previousClose: row.previousClose ?? null, pnlPaise: row.pnlPaise, mtmPaise: row.mtmPaise ?? null, side: row.quantity < 0 ? "SELL" as const : "BUY" as const, asOf: row.asOf, fresh: false })), ...(include && account ? iciciPositions(account.sections.portfoliopositions?.rows ?? [], account.accountId, account.sections.portfoliopositions?.asOf ?? account.asOf) : [])];
  const fundsRows = snapshot.holdings.data?.brokerBalances?.slice(0,3) ?? [];
  const iciciFundsRows = broker === "icici" ? (account?.sections.funds?.rows ?? []) : [];
  const hasFunds = fundsRows.length > 0 || iciciFundsRows.length > 0;
  const ordersRows = snapshot.brokerOrders?.data?.slice(0,3) ?? [];
  const iciciOrderRows = include ? (account?.sections.order?.rows.slice(0,2) ?? []) : [];
  const hasOrders = ordersRows.length > 0 || iciciOrderRows.length > 0;
  // Named per source that was actually attempted, never a single broker's
  // name standing in for "nothing here" -- Kotak's own order feed genuinely
  // isn't fetched at all (see the header <sup> tooltip), which is a
  // different, honest reason from "attempted and failed."
  const missingOrderSources = [
    (broker === "all" || broker === "zerodha") ? `Zerodha: ${snapshot.brokerOrders?.reason ?? "no broker session"}` : null,
    include ? `ICICI: ${account?.sections.order?.status ?? "Unavailable"}${account?.sections.order?.reason ? ` · ${account.sections.order.reason}` : ""}` : null,
    broker === "kotak" ? "Kotak: order data is not supplied by the current API" : null,
  ].filter((entry): entry is string => entry !== null);
  return <>
    <BrokerDataStatus snapshot={snapshot} broker={broker} iciciStatus={status} />
    <section className={styles.card} aria-label="Reported Open Positions"><h2>Reported Open Positions</h2><OpenPositions showBroker={broker === "all"} marginPaise={broker !== "all" && broker !== "icici" && snapshot.holdings.status === "available" ? snapshot.holdings.data.usedMarginPaise : null} rows={positions} scope={labels[broker]} available={hasCoreCoverage(snapshot, broker, "positions") && (!include || (!iciciStale && account?.sections.portfoliopositions?.status === "available"))} /></section>
    <section className={styles.card}><h2>Broker Funds</h2><Link href="/app/funds-margin">View all funds & margin →</Link><div className={styles.tableScroll}><table><thead><tr><th>Broker / account</th><th>Balance type</th><th>Amount</th></tr></thead><tbody>
      {fundsRows.map(row => <tr key={`${row.provider}:${row.accountId}`}><td>{row.provider} · {row.accountId}</td><td>Available margin</td><td>{formatPaise(row.availableMarginPaise)}</td></tr>)}
      {broker === "icici" && iciciFundsRows.map((row, index) => <tr key={index}><td>ICICI · {account?.accountId}</td><td>Bank balance</td><td>{row.total_bank_balance == null || String(row.total_bank_balance).trim() === "" || !Number.isFinite(Number(row.total_bank_balance)) ? "Unavailable" : formatPaise(Math.round(Number(row.total_bank_balance) * 100))}</td></tr>)}
    </tbody></table></div>{!hasFunds && <p>No broker funds data — {labels[broker]}{snapshot.holdings.reason ? ` · ${snapshot.holdings.reason}` : ""}</p>}</section>
    <section className={styles.card}><h2>Recent Broker Orders</h2><Link href="/app/orders-trades">View all orders →</Link><sup title="Same-day broker responses, not an audit ledger. Kotak orders are not included.">*</sup><div className={styles.tableScroll}><table><thead><tr><th>Broker</th><th>Order</th><th>Instrument</th><th>Side</th><th>Quantity</th><th>Status</th></tr></thead><tbody>
      {ordersRows.map(row => <tr key={`z:${row.orderId}`}><td>Zerodha</td><td>{row.orderId}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.quantity}</td><td>{row.status}</td></tr>)}
      {iciciOrderRows.map((row, index) => <tr key={`i:${index}`}><td>ICICI</td><td>{row.order_id}</td><td>{row.stock_code}</td><td>{row.action}</td><td>{row.quantity}</td><td>{row.status}</td></tr>)}
    </tbody></table></div>{!hasOrders && missingOrderSources.length > 0 && <p>{missingOrderSources.join(" · ")}</p>}</section>
  </>;
}
