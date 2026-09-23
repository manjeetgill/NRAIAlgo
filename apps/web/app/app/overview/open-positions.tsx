"use client";

import Link from "next/link";
import { useState } from "react";
import { RecordTable } from "./record-table";
import { SnapshotMetric } from "./snapshot-metric";
import { formatPaise } from "./format";
import styles from "./market-open.module.css";

export interface OpenPositionView {
  estimatedPnlPaise?: number | null;
  details?: Record<string, unknown>;
  id: string; provider: string; symbol: string; account: string; exchange: string; product: string;
  quantity: number | null; average: number | null; ltp: number | null; previousClose?: number | null; pnlPaise: number | null;
  mtmPaise?: number | null; marginPaise?: number | null; side: "BUY" | "SELL" | null; expiry?: string | null; asOf?: string | null; fresh?: boolean;
}
export function calculateOpenPnl(quantity: number | null, average: number | null, ltp: number | null, multiplier = 1): number | null {
  if (quantity == null || average == null || ltp == null || ![quantity,average,ltp,multiplier].every(Number.isFinite) || average <= 0 || ltp <= 0 || multiplier <= 0) return null;
  const value = Math.round((ltp-average)*quantity*multiplier*100);
  return Number.isSafeInteger(value) ? value : null;
}
export function calculateDailyMtm(quantity: number | null, previousClose: number | null, ltp: number | null, multiplier = 1): number | null {
  if (quantity == null || previousClose == null || ltp == null || ![quantity,previousClose,ltp,multiplier].every(Number.isFinite) || previousClose <= 0 || ltp <= 0 || multiplier <= 0) return null;
  const value = Math.round((ltp-previousClose)*quantity*multiplier*100);
  return Number.isSafeInteger(value) ? value : null;
}
export function effectivePositionPnl(row: OpenPositionView): number | null {
  const value = row.pnlPaise ?? row.estimatedPnlPaise ?? null;
  return value !== null && Number.isSafeInteger(value) ? value : null;
}
export function nonMcxPositions<T extends { exchange: string }>(rows: T[]): T[] {
  return rows.filter(row => row.exchange.trim().toUpperCase() !== "MCX");
}
export function completePositionPnl(rows: OpenPositionView[], available: boolean): number | null {
  const values = rows.map(effectivePositionPnl);
  const sum = available && values.every(value => value !== null) ? values.reduce<number>((total, value) => total + value!, 0) : null;
  return sum !== null && Number.isSafeInteger(sum) ? sum : null;
}
const LABELS: Record<string, string> = { zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" };
const tone = (value: number | null) => value === null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";
const money = (value: number | null, signed = false) => value === null ? "Unavailable" : `${signed && value > 0 ? "+" : ""}${formatPaise(value)}`;
const columns = [ ["symbol", "Instrument & route"], ["side", "Side"], ["quantity", "Qty (units)"], ["average", "Avg price"], ["ltp", "LTP"], ["intraday", "Day MTM"], ["pnlPaise", "Position P&L (gross)"],  ] as const;

/** Shared layout for consolidated, individual and Breeze views. No synthetic
 * strategies, lots, Greeks or day-P&L derived from lifetime broker P&L. */
export function OpenPositions({ rows, available = true, marginPaise = null, scope = "Selected brokers", detailed = false, excludeMcx = false, showBroker = true }: { showBroker?: boolean; excludeMcx?: boolean; rows: OpenPositionView[]; available?: boolean; mtmPaise?: number | null; marginPaise?: number | null; scope?: string; detailed?: boolean }) {
  const [segment, setSegment] = useState("all");
  const visibleRows = rows.filter(row => segment === "all" || (segment === "mcx" ? row.exchange.trim().toUpperCase() === "MCX" : ["NSE", "BSE", "NFO", "BFO"].includes(row.exchange.trim().toUpperCase())));
  const omitMcx = excludeMcx && segment !== "mcx";
  const filteredScope = `${scope}:segment:${segment}`;
  const pnlRows = omitMcx ? nonMcxPositions(visibleRows) : visibleRows;
  const total = completePositionPnl(pnlRows, available);
  const reportedMargin = available ? marginPaise : null;
  const mtm = available && pnlRows.every(row => row.mtmPaise != null) ? pnlRows.reduce((sum, row) => sum + row.mtmPaise!, 0) : null;
  const brokers = [...new Set(visibleRows.map(row => row.provider))].map(provider => `${visibleRows.filter(row => row.provider === provider).length} ${LABELS[provider] ?? provider}`).join(" · ");
  return <div className={styles.positionTable}>
    <div className={styles.positionToolbar}><span className={styles.tag}>Read-only broker snapshot</span><span title="Read-only account view; order execution is not connected">Execution locked</span></div>
    <div className={styles.positionToolbar} role="group" aria-label="Position market filter">{[["all", "All"], ["equity", "Equity & F&O"], ["mcx", "MCX"]].map(([value, label]) => <button key={value} type="button" className={styles.button} aria-pressed={segment === value} onClick={() => setSegment(value!)}>{label}</button>)}</div>
    <div className={styles.positionSummary}>
      <div><span>Open positions</span><strong>{available || rows.length ? `${visibleRows.length} displayed positions` : "Unavailable"}</strong><small>{brokers || scope}</small></div>
      <div><span>Day MTM · open positions</span><SnapshotMetric signed value={mtm} scope={`${filteredScope}:${omitMcx ? "excluding-mcx" : "all-exchanges"}`} asOf={rows[0]?.asOf} /><small title="Calculated as (current price minus previous close) × signed units × contract multiplier">Previous close → current · open positions{omitMcx && " · Excluding MCX"}</small></div>
      <div><span>Open-position P&amp;L</span><SnapshotMetric signed value={total} scope={`${filteredScope}:${omitMcx ? "excluding-mcx" : "all-exchanges"}`} asOf={rows[0]?.asOf} /><small title="Uses broker-reported P&L where supplied, otherwise calculated open-position estimates. Estimates exclude realized P&L; values are before charges.">Before charges · may include estimates{omitMcx && " · Excluding MCX"}</small></div>
      <div><span>Account used margin</span><SnapshotMetric value={reportedMargin} scope={scope} asOf={rows[0]?.asOf} /><small title="Account-level balance, not margin allocated to these positions">Account balance</small></div>
    </div>
    {(mtm === null || total === null || reportedMargin === null) && <details><summary>Metric coverage *</summary><p>Complete selected-account values are required. Last-confirmed values remain marked *. Metrics not yet supplied are omitted from summary cards, not treated as zero.</p><p>{mtm === null ? "Day MTM not confirmed. " : ""}{total === null ? "Position P&L not confirmed. " : ""}{reportedMargin === null ? "Account used margin not confirmed. " : ""}Greeks, strategy and lots appear in record details only when supplied.</p></details>}
    {available && !visibleRows.length && <p>No positions in this market selection.</p>}
    {!rows.length && !available && <p>Awaiting position-level data</p>}
    <RecordTable key={segment} rows={visibleRows} label="Open position details" id={row=>row.id} limit={detailed ? undefined : 5} columns={columns.map(([key,label]) => ({key,label,value:(row: OpenPositionView) => key === "intraday" ? row.mtmPaise : key === "pnlPaise" ? effectivePositionPnl(row) : row[key], render:(row: OpenPositionView) => key === "symbol" ? <><strong>{row.symbol}</strong>{showBroker && <span className={styles.brokerChip} data-broker={row.provider} aria-label={`Broker: ${LABELS[row.provider]}`}>{LABELS[row.provider]}</span>}<small>{row.exchange} · {row.product}</small>{row.fresh && <small>Live tick</small>}</> : key === "side" ? <span data-tone={row.side === "SELL" ? "negative" : row.side === "BUY" ? "positive" : "neutral"}>{row.side ?? "Not supplied"}</span> : key === "quantity" ? <span data-tone={tone(row.quantity)}>{row.quantity ?? "Not supplied"}</span> : <span data-tone={tone(key === "intraday" ? row.mtmPaise ?? null : key === "pnlPaise" ? effectivePositionPnl(row) : null)}>{money(key === "average" ? row.average == null ? null : Math.round(row.average*100) : key === "ltp" ? row.ltp == null ? null : Math.round(row.ltp*100) : key === "intraday" ? row.mtmPaise ?? null : effectivePositionPnl(row), key === "intraday" || key === "pnlPaise")}{key === "pnlPaise" && row.pnlPaise == null && effectivePositionPnl(row) != null && <sup title="Calculated open-position estimate: (last price minus average entry) × signed units. Excludes realized P&L and charges.">*</sup>}</span> }))} />
    {!detailed && <Link className={styles.button} href="/app/live-positions">View all positions ({rows.length}) →</Link>}
    <div className={styles.positionNotice}><span className="material-symbols-outlined" aria-hidden="true">info</span><p>{scope} view · Positions remain separate by broker and account. Missing feeds and analytics are not zero exposure. Broker selection changes the view only; order execution is locked.</p><small>{available ? `${rows.length} reported positions` : "Incomplete account coverage"}</small></div>
  </div>;
}
