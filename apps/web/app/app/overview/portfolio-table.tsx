"use client";

import { useState } from "react";
import Link from "next/link";
import { formatPaise } from "./format";
import styles from "./market-open.module.css";
import { DetailedPortfolio } from "./detailed-portfolio";

export interface PortfolioRow {
  name?: string | undefined; details?: Record<string, unknown> | undefined;
  provider: string; accountId: string; symbol: string; quantity: number | null;
  pledgedQuantity?: number | null | undefined; marketValuePaise: number | null;
  averagePaise?: number | null | undefined; ltpPaise?: number | null | undefined;
  dayPnlPaise?: number | null | undefined; unrealizedPaise?: number | null | undefined;
  isin?: string | null | undefined; exchange?: string | null | undefined; investedPaise?: number | null | undefined;
}
const labels: Record<string, string> = { zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" };
const columns = [["symbol", "Instrument & demat route"], ["quantity", "Qty & status"], ["averagePaise", "Avg cost"], ["ltpPaise", "LTP"], ["marketValuePaise", "Current value"], ["dayPnlPaise", "Price-change impact (est.)"], ["unrealizedPaise", "Overall unrealized P&L"]] as const;
type SortKey = typeof columns[number][0];
const money = (n: number | null | undefined, signed = false) => n == null ? "Unavailable" : `${signed && n > 0 ? "+" : ""}${formatPaise(n)}`;
const tone = (n: number | null | undefined) => n == null || n === 0 ? "neutral" : n > 0 ? "positive" : "negative";

export function PortfolioTable({ rows, available = true, detailed = false, scope, showBroker = true }: { rows: PortfolioRow[]; available?: boolean; detailed?: boolean; scope?: string | undefined; showBroker?: boolean }) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "symbol", descending: false });
  const providers = [...new Set(rows.map(row => row.provider))].sort();
  const visibleColumns = columns.filter(([key]) => key !== "averagePaise" && key !== "ltpPaise");
  if (detailed) return <DetailedPortfolio rows={rows} available={available} scope={scope} showBroker={showBroker} />;
  return <div className={`${styles.positionTable} ${styles.portfolioTable}`}>
    <div className={`${styles.tableScroll} ${styles.compactHoldingsScroll}`} tabIndex={0} role="region" aria-label="Scrollable cash holdings"><table aria-label="Portfolio holdings by broker">
      <thead><tr>{visibleColumns.map(([key, label]) => <th key={key} scope="col" aria-sort={sort.key === key ? sort.descending ? "descending" : "ascending" : "none"}><button className={styles.sortHeader} onClick={() => setSort(current => ({ key, descending: current.key === key ? !current.descending : false }))}>{label} <span aria-hidden="true">{sort.key === key ? sort.descending ? "▼" : "▲" : "↕"}</span></button></th>)}</tr></thead>
      {providers.map(provider => <tbody key={provider} aria-label={`${labels[provider] ?? provider} holdings`}>
        {showBroker && <tr className={styles.portfolioGroup}><th colSpan={visibleColumns.length} scope="rowgroup"><span className={styles.brokerChip} data-broker={provider}>{labels[provider] ?? provider}</span> · {rows.filter(row => row.provider === provider).length} holdings</th></tr>}
        {rows.filter(row => row.provider === provider).sort((a, b) => {
          const left = a[sort.key], right = b[sort.key];
          if (left == null) return right == null ? 0 : 1;
          if (right == null) return -1;
          const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "en", { numeric: true });
          return sort.descending ? -order : order;
        }).map((row, index) => <tr key={`${row.accountId}:${row.symbol}:${index}`}>
          <td><div className={styles.positionHeading}><strong>{row.symbol}</strong>{showBroker && <span className={styles.brokerChip} data-broker={provider}>{labels[provider] ?? provider}</span>}<span className={`material-symbols-outlined ${row.pledgedQuantity == null ? styles.muted : row.pledgedQuantity > 0 ? styles.warning : styles.positive}`} role="img" aria-label={row.pledgedQuantity == null ? "Pledge status unavailable" : row.pledgedQuantity > 0 ? "Partly or fully pledged" : "Not pledged"}>{row.pledgedQuantity == null ? "help_outline" : row.pledgedQuantity > 0 ? "lock" : "lock_open"}</span></div><small>{row.accountId}</small></td>
          <td className={styles.positionLtp}>{row.quantity ?? "Unavailable"}<small>{row.pledgedQuantity == null ? "Pledge status unavailable" : `${row.pledgedQuantity} pledged`}</small></td>
          <td className={styles.positionLtp}>{money(row.marketValuePaise)}</td>
          <td data-tone={tone(row.dayPnlPaise)}>{money(row.dayPnlPaise, true)}</td><td data-tone={tone(row.unrealizedPaise)}>{money(row.unrealizedPaise, true)}</td>
        </tr>)}
      </tbody>)}
      {!rows.length && <tbody><tr><td colSpan={visibleColumns.length}>{available ? "No holdings reported for available accounts" : "Holdings unavailable"}</td></tr></tbody>}
    </table></div>
    <Link className={styles.button} href="/app/cash-holdings">View detailed cash holdings →</Link>
  </div>;
}
