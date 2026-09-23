import { UpdatedAt } from "./updated-at";
import Link from "next/link";
import type { ReactNode } from "react";
import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";
import { formatPaise, formatTimestamp } from "./format";
import shared from "./market-open.module.css";
import styles from "./market-closed.module.css";
import { PortfolioTable, type PortfolioRow } from "./portfolio-table";

function Card({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return <section className={styles.card} aria-label={title}><header className={styles.cardHeader}><h2>{title}</h2>{badge && <span className={shared.tag}>{badge}</span>}</header>{children}</section>;
}
function Source({ panel }: { panel: Panel<unknown> }) {
  return <details className={shared.provenance}><summary>Source & refresh {panel.status !== "available" ? "*" : ""}</summary><UpdatedAt value={panel.asOf}/><p>Source: {panel.source}</p><span>{panel.reason}</span></details>;
}
function Money({ value }: { value: number | null | undefined }) {
  return <span className={value == null ? shared.muted : value < 0 ? shared.negative : undefined}>{value == null ? "—" : formatPaise(value)}</span>;
}
const CHECKS = { totp: "Platform MFA", priceFeed: "Regular-session live feed", brokerSessions: "Broker sessions", riskLimits: "Risk limits" };
const STATUS: Record<string, string> = { passed: "Passed", failed: "Failed", unknown: "Unknown", not_applicable: "Not applicable" };

/** Calendar selects this view; a closed exchange does not settle an account,
 * revoke a broker token, flatten exposure, or authorize the next deployment. */
export function MarketClosedScreen({ snapshot, layout, accountHoldings }: { snapshot: OverviewSnapshot; layout?: "after-close" | "weekend-holiday"; accountHoldings?: { rows: PortfolioRow[]; complete: boolean } }) {
  const weekend = (layout ?? snapshot.session.data?.state) === "weekend-holiday";
  const actuallyClosed = snapshot.session.data?.calendarValid && (snapshot.session.data.state === "after-close" || snapshot.session.data.state === "weekend-holiday");
  const session = snapshot.session.data;
  const pnl = snapshot.pnl.status === "available" ? snapshot.pnl.data : null;
  const perf = pnl?.performance;
  const holdings = snapshot.holdings.data;
  const deployment = snapshot.deployment.data;
  const expired = snapshot.connections.data?.filter(connection => connection.status === "session_expired") ?? [];
  const checks = Object.entries(CHECKS).map(([key, label]) => ({ label,
    check: key === "priceFeed" && actuallyClosed ? { status: "not_applicable", reason: "The regular market is closed; this does not verify the next session's feed." }
      : key === "brokerSessions" && expired.length ? { status: "failed", reason: "A reported broker session has expired." }
      : snapshot.readiness.data?.checks[key as keyof typeof CHECKS] ?? { status: "unknown", reason: "No verification available" },
  }));
  const passed = checks.filter(({ check }) => check.status === "passed").length;
  const holdingRows = accountHoldings?.rows ?? holdings?.holdings ?? [];
  const complete = accountHoldings?.complete ?? snapshot.holdings.status === "available";
  const holdingValue = complete && holdingRows.every(row => row.marketValuePaise != null) ? holdingRows.reduce((sum, row) => sum + row.marketValuePaise!, 0) : null;
  const positions = snapshot.positions?.data;
  const reportedPositions = positions?.filter(position => position.quantity !== 0);
  const reconciled = pnl?.reconciliationStatus === "reconciled" && pnl.netPaise !== null;
  const closeQuotes = snapshot.prices.data ?? [];
  const quoteTiles = [
    { instrumentId: "NSE:NIFTY50", label: "NIFTY 50" },
    { instrumentId: "NSE:BANKNIFTY", label: "BANK NIFTY" },
    { instrumentId: "NSE:INDIAVIX", label: "INDIA VIX" },
  ];

  return <div className={`${shared.terminal} ${styles.closed} ${weekend ? styles.weekend : ""}`}>
    <h1 className={shared.srOnly}>{weekend ? "Weekend / holiday" : "After close"}</h1>
    {expired.length > 0 && <div className={styles.authNotice} role="alert"><span>Broker re-authentication required · {expired.map(connection => connection.source).join(", ")}</span><Link className={shared.button} href="/app/broker-connections">Review broker login</Link></div>}

    <section className={styles.banner} aria-label="Closed market status"><div><strong><span className={styles.dot} />{layout ? "Current account snapshot" : weekend ? "Weekend Research & Risk Review" : "Session Closed"}</strong><span className={shared.tag}>{layout ? `${layout} layout · not a historical snapshot` : weekend ? "Weekend / holiday · market closed" : "After close"}</span><p>Last completed session: {session?.lastCompletedSession ?? "Unavailable"}. Account updates and reconciliation continue after market close.</p></div><div className={styles.nextSession}><span>Next trading session</span><strong>{session?.nextSession ?? "Not yet confirmed"}</strong><small>Next calendar transition: {formatTimestamp(session?.nextTransitionAt ?? null)} IST</small></div></section>

    <div className={styles.quotes} aria-label="Market reference prices">
      {quoteTiles.map(tile => {
        const quote = closeQuotes.find(item => item.instrumentId === tile.instrumentId);
        return <section className={styles.quoteCard} key={tile.instrumentId}><header><h2>{tile.label}</h2><span className={shared.tag}>{!quote ? "Unavailable" : quote.priceBasis === "official-close" ? "Official close" : quote.priceBasis === "last-observed" ? "Last observed" : quote.priceBasis.toUpperCase()}</span></header><strong>{quote ? quote.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}</strong><footer>{quote ? `Price as of ${formatTimestamp(quote.sourceAsOf)} IST${quote.fresh ? "" : " · not fresh"}` : "Price reference not received"}</footer></section>;
      })}
    </div>
    <div className={styles.referenceNote}><span>Closing references are separate from account balances. Publication or corrections can arrive after close.</span><Source panel={snapshot.prices} /></div>

    <div className={`${styles.summaryGrid} ${weekend ? styles.weekendGrid : ""}`}>
      <Card title={weekend ? "Accumulated Performance" : "Session P&L Summary"} badge={reconciled ? "Reconciled" : "Provisional / pending"}>
        <p className={styles.caption}>Reported period: {pnl?.period ?? "Unavailable"}</p>
        <div className={`${styles.bigNumber} ${pnl && (pnl.netPaise ?? pnl.grossPaise) >= 0 ? shared.positive : ""}`}><Money value={pnl?.netPaise ?? pnl?.grossPaise} /></div>
        <p className={styles.caption}>{pnl?.netPaise != null ? "Net P&L" : "Gross position P&L · net pending charges"}</p>
        <dl className={styles.inset}><div><dt>Gross P&L</dt><dd><Money value={pnl?.grossPaise} /></dd></div><div><dt>Charges</dt><dd>{pnl?.chargesPaise == null ? "Pending" : <Money value={pnl.chargesPaise} />}</dd></div><div><dt>Net P&L</dt><dd>{pnl?.netPaise == null ? "Unavailable" : <Money value={pnl.netPaise} />}</dd></div></dl>
        {weekend && <div className={styles.chartEmpty}><span className="material-symbols-outlined" aria-hidden="true">show_chart</span><strong>Weekly equity history unavailable</strong><span>Daily stored results are needed for a cumulative curve; the account snapshot is not a weekly return.</span></div>}
        <div className={styles.statistics}>
          {/* Day-level, not trade-level: there is no per-trade win/loss data
              yet, so this must never be labeled "Win ratio" (which would
              imply per-trade granularity it doesn't have). Derived from
              session_pnl_history -- see session-performance.ts. */}
          <div><span>Day win rate</span><strong>{perf?.dayWinRatePct != null ? `${perf.dayWinRatePct}%` : "—"}</strong></div>
          {/* Needs trade-level fills (entries/exits per instrument), not
              just daily gross P&L -- out of scope until that exists. */}
          <div><span>Profit factor</span><strong>—</strong></div>
          <div><span>Sharpe</span><strong>{perf?.sharpe != null ? perf.sharpe.toFixed(2) : perf ? `${perf.sessionsRecorded}/${perf.sessionsRequiredForSharpe} sessions` : "—"}</strong></div>
          <div><span>Max drawdown</span><strong>{perf?.maxDrawdownPaise != null ? formatPaise(perf.maxDrawdownPaise) : "—"}</strong></div>
        </div>
        <Source panel={snapshot.pnl} />
        <details className={styles.disclosure}><summary>View P&L breakdown</summary><dl className={styles.inset}><div><dt>Realised</dt><dd><Money value={pnl?.realisedPaise} /></dd></div><div><dt>Unrealised</dt><dd><Money value={pnl?.unrealisedPaise} /></dd></div></dl><p>Reconciliation: {pnl?.reconciliationStatus ?? "Unknown"}. Market close alone does not make these figures final.</p></details>
      </Card>

      <Card title={weekend ? "Securities & Demat" : "Demat Holdings"} badge="Account snapshot">
        <p className={styles.caption}>{complete ? "Reported holdings value" : "Total withheld — selected account data incomplete"}</p><div className={styles.bigNumber}><Money value={holdingValue} /></div>
        <p className={styles.caption}>Margin and collateral below cover the overview feed only; bank balances are not margin.</p>
        <dl className={styles.inset}><div><dt>Margin deployed</dt><dd><Money value={holdings?.usedMarginPaise} /></dd></div><div><dt>Available margin</dt><dd><Money value={holdings?.availableMarginPaise} /></dd></div><div><dt>Pledged collateral</dt><dd><Money value={holdings?.collateralPaise} /></dd></div></dl>
        <ul className={styles.holdings}>{holdingRows.slice(0, 3).map(holding => <li key={`${holding.provider}:${holding.accountId}:${holding.symbol}`}><span><strong>{holding.symbol}</strong><small>{holding.quantity} units · {holding.provider}</small></span><Money value={holding.marketValuePaise} /></li>)}</ul>
        {holdingRows.length === 0 && <p className={styles.caption}>{complete ? "No holdings reported by the connected sources." : "Holdings unavailable for the selected accounts."}</p>}
        {accountHoldings ? <p className={styles.caption}>Holdings use the selected account snapshots; see Broker data sources &amp; refresh status below. Margin feed: {snapshot.holdings.source} · {snapshot.holdings.status}.</p> : <Source panel={snapshot.holdings} />}
        <details className={styles.disclosure}><summary>Holdings & collateral details</summary><PortfolioTable rows={holdingRows} available={complete} /></details>
      </Card>

      <Card title={weekend ? "Execution Engines" : "Strategy Posture"} badge={deployment?.workerStatus ?? "Unknown"}>
        <div className={styles.engine}><strong>{deployment?.deploymentId ?? "No strategy engine data"}</strong><dl className={styles.inset}><div><dt>Worker</dt><dd>{deployment?.workerStatus ?? "Unknown"}</dd></div><div><dt>Deployment grant</dt><dd>{deployment?.grantStatus ?? "Unknown"}</dd></div><div><dt>Scheduled at</dt><dd>{formatTimestamp(deployment?.scheduledAt ?? null)}</dd></div></dl></div>
        <div className={styles.exposure}><span className="material-symbols-outlined" aria-hidden="true">shield</span><span>{reportedPositions ? `${reportedPositions.length} open positions reported by ${snapshot.positions?.source}. Other account exposure is not inferred.` : "Overnight exposure unverified. Market close does not flatten positions."}</span></div>
        <Source panel={snapshot.deployment} />
        <div className={styles.bottomActions}><button className={shared.button} disabled title="Deployment command service is not connected">Arm at next open</button><details className={styles.disclosure}><summary>Inspect status</summary><p>{deployment?.lastOutcome ?? "No strategy outcome available."}</p><p>Starting requires explicit deployment authorization and valid execution checks.</p></details></div>
      </Card>
    </div>

    <div className={styles.lowerGrid}>
      <Card title={weekend ? "Weekend Optimizations" : "Since the Close"} badge={layout ? "Current snapshot activity · not period-filtered" : "Reported activity"}>
        <div className={styles.job}><strong>Research & parameter sweeps</strong><span className={shared.muted}>Not connected</span></div>
        <div className={styles.job}><strong>Closing price reference</strong><span>{closeQuotes.length && closeQuotes.every(quote => quote.priceBasis === "official-close") ? "Official closing values received" : "Pending / last observed"}</span></div>
        <div className={styles.job}><strong>Account reconciliation</strong><span className={reconciled ? shared.positive : shared.warning}>{pnl?.reconciliationStatus ?? "Unknown"}</span></div>
        <ol className={styles.events}>{snapshot.activity.data?.events.map(event => <li key={event.eventId}><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time><span>{event.description}</span></li>)}</ol>
        {!snapshot.activity.data?.events.length && <p className={styles.emptyActivity}>{snapshot.activity.data ? "No activity reported in this snapshot. Research job status is not connected." : "No background-job activity source connected. No running jobs or completed archives assumed."}</p>}
        <Source panel={snapshot.activity} />
      </Card>
      <div className={styles.rightStack}>
        <Card title="Data & Broker Connections" badge="Server reported">
          <div className={styles.job}><strong>Actual server session</strong><span className={styles.accent}>{snapshot.session.data?.state ?? "Unknown"}</span></div>
          {snapshot.connections.data?.map(connection => <div className={styles.job} key={connection.source}><span>{connection.source}<small>{formatTimestamp(connection.asOf)} IST</small></span><strong className={connection.status === "session_expired" ? shared.warning : shared.muted}>{connection.status.replaceAll("_", " ")}</strong></div>)}
          <Source panel={snapshot.connections} />
          <Link className={shared.configure} href="/app/broker-connections">Configure / re-authenticate brokers →</Link>
        </Card>
        <Card title="Next Session Pre-Flight" badge={`${passed}/4 passed`}>
          <div className={styles.checks}>{checks.map(({ label, check }) => <div key={label}><span>{label}<small>{check.reason}</small></span><strong className={check.status === "passed" ? shared.positive : check.status === "failed" ? shared.negative : shared.warning}>{STATUS[check.status]}</strong></div>)}</div>
          <p className={styles.caption}>Revalidate for the next session. Passing checks never starts a strategy automatically.</p>
        </Card>
      </div>
    </div>
    <footer className={shared.terminalFooter}><span>{snapshot.scope.exchange} / {snapshot.scope.segment} · Calendar: {snapshot.calendarVersion}</span><span>Account snapshot: {formatTimestamp(snapshot.generatedAt)} IST</span></footer>
  </div>;
}
