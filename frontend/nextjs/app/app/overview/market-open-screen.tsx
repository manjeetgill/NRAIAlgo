"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";
import { formatPaise, formatTimestamp } from "./format";
import styles from "./market-open.module.css";
import { brokerView, brokerViewLabels, selectedProviders, hasCoreCoverage, type BrokerView } from "./broker-view";
import { iciciPositions } from "./icici-model";
import { useIciciAccount, iciciHoldings } from "./use-icici-account";
import { BrokerDataStatus } from "./broker-data-status";
import { BrokerFilter } from "./broker-filter";
import { SnapshotMetric } from "./snapshot-metric";
import { OpenPositions, calculateOpenPnl, completePositionPnl, effectivePositionPnl, nonMcxPositions } from "./open-positions";


function Icon({ name }: { name: string }) {
  return <span className={`material-symbols-outlined ${styles.icon}`} aria-hidden="true">{name}</span>;
}

function Card({ title, icon, subtitle, aside, children, className = "" }: {
  title: string; icon: string; subtitle?: string; aside?: ReactNode; children: ReactNode; className?: string | undefined;
}) {
  return <section className={`${styles.card} ${className}`} aria-label={title}>
    <header className={styles.cardHeader}>
      <div className={styles.cardHeading}><Icon name={icon} /><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div></div>
      {aside && <div className={styles.aside}>{aside}</div>}
    </header>
    {children}
  </section>;
}

function Provenance({ panel }: { panel: Panel<unknown> }) {
  return <div className={styles.provenance}>
    {panel.status !== "available" && <span className={styles.warning}>{panel.status === "degraded" ? "Partial · " : ""}{panel.reason}</span>}
    <span>Source: {panel.source} · As of {formatTimestamp(panel.asOf)}</span>
  </div>;
}

function Money({ value, signed = false }: { value: number | null | undefined; signed?: boolean }) {
  return <span className={value == null ? styles.muted : signed ? (value < 0 ? styles.negative : styles.positive) : undefined}>
    {value == null ? "—" : `${signed && value > 0 ? "+" : ""}${formatPaise(value)}`}
  </span>;
}

function LockedAction({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <button type="button" className={`${styles.button} ${danger ? styles.danger : ""}`} disabled title="Execution command service is not connected">{children}</button>;
}

const CHECK_LABELS = { totp: "Platform MFA session", priceFeed: "Market-data feed", brokerSessions: "Broker sessions", riskLimits: "Risk limits" };
const CHECK_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed", unknown: "Unknown", not_applicable: "Not applicable" };

/** Market-open presentation only. Commands remain unavailable until the server
 * exposes authorized execution endpoints; market-open is never permission to trade. */
export function LegacyMarketOpenScreen({ snapshot: originalSnapshot, layoutOnly = false }: { snapshot: OverviewSnapshot; layoutOnly?: boolean }) {
  const icici = useIciciAccount();
  return <LegacyMarketOpenView snapshot={originalSnapshot} layoutOnly={layoutOnly} icici={icici} />;
}

function LegacyMarketOpenView({ snapshot: originalSnapshot, layoutOnly = false, icici }: { snapshot: OverviewSnapshot; layoutOnly?: boolean; icici: ReturnType<typeof useIciciAccount> }) {
  const [selectedBroker, setSelectedBroker] = useState<BrokerView>("all");
  const snapshot = brokerView(originalSnapshot, selectedBroker);
  const viewLabels = brokerViewLabels(originalSnapshot);
  const includeIcici = selectedProviders(snapshot, selectedBroker).includes("icici");
  const [showAllocations, setShowAllocations] = useState(false);
  const [showDeployment, setShowDeployment] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const pnl = snapshot.pnl.status === "available" && !includeIcici ? snapshot.pnl.data : null;
  const holdings = snapshot.holdings.data;
  const deployment = snapshot.deployment.data;
  const positions = snapshot.positions?.data?.filter(row => row.quantity !== 0);
  const holdingRows = [...(holdings?.holdings ?? []), ...(includeIcici ? iciciHoldings(icici.account) : [])];
  const positionRows = [...(positions ?? []).map(row => ({
    id: `${row.provider}:${row.accountId}:${row.exchange}:${row.symbol}:${row.product}`, provider: row.provider, symbol: row.symbol, account: row.accountId, exchange: row.exchange, product: row.product,
    quantity: row.quantity, average: row.averagePrice, ltp: row.lastPrice, previousClose: row.previousClose ?? null, pnlPaise: row.pnlPaise, mtmPaise: row.mtmPaise ?? null, side: row.quantity < 0 ? "SELL" as const : "BUY" as const, asOf: row.asOf, fresh: row.fresh, estimatedPnlPaise: calculateOpenPnl(row.quantity, row.averagePrice, row.lastPrice, row.multiplier),
  })), ...(includeIcici && icici.account ? iciciPositions(icici.account.sections.portfoliopositions?.rows ?? [], icici.account.accountId, icici.account.sections.portfoliopositions?.asOf ?? icici.account.asOf) : [])];
  const holdingsComplete = hasCoreCoverage(snapshot, selectedBroker, "holdings") && (!includeIcici || (!icici.stale && icici.account?.sections.portfolioholdings?.status === "available"));
  const positionsComplete = hasCoreCoverage(snapshot, selectedBroker, "positions") && (!includeIcici || (!icici.stale && icici.account?.sections.portfoliopositions?.status === "available"));
  const pnlRows = includeIcici ? nonMcxPositions(positionRows) : positionRows;
  const calculatedPnl = completePositionPnl(pnlRows, positionsComplete);
  const checks = snapshot.readiness.data?.checks;
  const passed = checks ? Object.values(checks).filter((check) => check.status === "passed").length : 0;
  const providers = selectedProviders(originalSnapshot, selectedBroker);
  const metricScope = JSON.stringify([snapshot.scope, selectedBroker, providers]);
  const marginConfirmed = holdingsComplete && !includeIcici && snapshot.holdings.status === "available";
  const close = snapshot.session.data?.nextTransitionAt;
  const roi = pnl?.netPaise != null && pnl.baseCapital.amountPaise != null && pnl.baseCapital.amountPaise > 0
    ? pnl.netPaise / pnl.baseCapital.amountPaise * 100 : null;

  function downloadSnapshot() {
    // OverviewSnapshot is already a public read model: it contains no broker secrets.
    const url = URL.createObjectURL(new Blob([JSON.stringify({ overview: snapshot, brokerView: selectedBroker, icici: includeIcici ? icici.account : null }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nraialgo-overview-${snapshot.generatedAt.replaceAll(":", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return <div className={styles.terminal}>
    <h1 className={styles.srOnly}>Market open</h1>
    <div className={styles.sessionBar}>
      <BrokerFilter value={selectedBroker} onChange={value => { setSelectedBroker(value); setDownloaded(false); }} />
      <span role="status">{viewLabels[selectedBroker]} · Viewing only; execution routing unchanged</span>
    </div>
    <BrokerDataStatus snapshot={snapshot} broker={selectedBroker} iciciStatus={icici.status} />
    <div className={styles.sessionBar}>
      <div className={styles.sessionLeft}><span className={styles.sessionPill}><i />{layoutOnly ? "Market-open layout · current account snapshot" : "Continuous market open"}</span>
        <span>{close ? `Next transition ${formatTimestamp(close)} IST` : "Next transition unavailable"}</span></div>
      <span className={styles.tag}>{snapshot.scope.context} ACCOUNT VIEW</span>
    </div>
    {snapshot.connections.data?.filter(connection => connection.source.startsWith("Kotak ") && connection.source.includes("WebSocket")).map(connection => <div className={styles.footerRow} role="status" key={connection.source}><span>{connection.source}</span><span>Display refresh: 1 second · REST reconciliation retained</span></div>)}
    {snapshot.connections.data?.filter(connection => connection.source.startsWith("ICICI ") && connection.source.includes("WebSocket")).map(connection => <div className={styles.footerRow} role="status" key={connection.source}><span>{connection.source}</span><span>Live price ticks · REST account reconciliation retained</span></div>)}
    {snapshot.marketStream && <div className={styles.footerRow} role="status"><span className={snapshot.marketStream.status === "streaming" ? styles.positive : styles.warning}>Zerodha price stream: {snapshot.marketStream.status} · Display: 1 second · Broker account / margin checks: ~10 seconds; order events trigger earlier checks</span><span>Last tick: {formatTimestamp(snapshot.marketStream.lastTickAt)} IST</span>{snapshot.marketStream.reason && <span className={styles.warning}>{snapshot.marketStream.reason}</span>}</div>}

    <div className={styles.quoteStrip} aria-label="Market prices">
      {(snapshot.prices.data ?? []).map((quote) => <div key={quote.instrumentId} className={styles.quote}>
        <span>{quote.label}</span><strong>{quote.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <small className={quote.fresh ? styles.positive : styles.warning}>{quote.priceBasis === "official-close" ? "Official close" : quote.fresh ? quote.priceBasis.toUpperCase() : "Last known"}</small>
        <span className={styles.quoteTime}>{formatTimestamp(quote.sourceAsOf)} IST</span>
      </div>)}
      {!snapshot.prices.data?.length && <span className={styles.muted}>Market prices unavailable · {snapshot.prices.reason ?? "No quotes received"}</span>}
      {snapshot.prices.status === "degraded" && <span className={styles.warning}>{snapshot.prices.reason}</span>}
    </div>

    <div className={styles.twoColumns}>
      <Card title={includeIcici ? "Open-position P&L" : "Session P&L Breakdown"} icon="account_balance" subtitle={includeIcici ? "Broker values / calculated estimates · before charges" : "Broker P&L · charges and reconciliation status"} aside={<>Allocated capital: <Money value={pnl?.baseCapital.amountPaise} /></>}>
        {includeIcici && <sup title="Uses broker-reported position P&L or calculated estimates where inputs are complete; not a comparable session or day total." aria-label="Session P&L coverage details">*</sup>}
        <div className={styles.pnlBody}>
          <div><div className={styles.label}>{includeIcici ? "Reported / estimated position P&L · Excluding MCX" : "Gross position P&L · before charges"}</div><div className={styles.headline}><SnapshotMetric value={includeIcici ? calculatedPnl : pnl?.grossPaise ?? null} scope={`${metricScope}:${includeIcici ? "calculated-open-excluding-mcx" : "gross"}`} asOf={snapshot.pnl.asOf} signed /></div>
            <details className={styles.subtle}><summary>Metric details *</summary>Complete selected-account values only. Last-confirmed values carry *. ICICI session totals are not comparable; net P&L requires reconciled charges. {includeIcici && <span>{positionRows.length} open positions loaded; {positionRows.length - pnlRows.length} MCX positions excluded from P&L; {pnlRows.filter(row => effectivePositionPnl(row) === null).length} lack reported P&L or valid calculation inputs. {positionsComplete ? "" : "Account refresh coverage is incomplete."} Missing records: {pnlRows.filter(row => effectivePositionPnl(row) === null).map(row => `${row.provider} ${row.exchange} ${row.symbol}: ${row.average == null || row.average <= 0 ? "entry price missing" : row.ltp == null || row.ltp <= 0 ? "valid last price missing" : "calculation basis not verified"}`).join("; ") || "none"}.</span>}</details>
            {roi !== null && <span className={styles.tag}>{`${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% ROI`}</span>}

          </div>
          {!includeIcici && <div className={styles.pnlMetrics}>
            <div><span className={styles.label}>Gross P&L</span><SnapshotMetric value={pnl?.grossPaise ?? null} scope={`${metricScope}:gross-detail`} asOf={snapshot.pnl.asOf} signed /></div>
            <div><span className={styles.label}>Charges:</span><SnapshotMetric value={pnl?.chargesPaise ?? null} scope={`${metricScope}:charges`} asOf={snapshot.pnl.asOf} /></div>
            <div><span className={styles.label}>Unrealised MTM</span><SnapshotMetric value={pnl?.unrealisedPaise ?? null} scope={`${metricScope}:unrealised`} asOf={snapshot.pnl.asOf} signed /></div>
          </div>
        }</div>
        <div className={styles.pnlFooter}>
          <div className={styles.guardrail}><div><span>Drawdown guardrail</span><span>Not configured</span></div><div className={styles.track} /><small>Execution controls unavailable until the command service is connected.</small></div>
          <div className={styles.actions}>
            <LockedAction><Icon name="pause_circle" />Pause entries</LockedAction>
            <button type="button" className={styles.button} onClick={downloadSnapshot}><Icon name="download" />Snapshot</button>
            <LockedAction danger><Icon name="tune" />Kill switches</LockedAction>
            <LockedAction danger><Icon name="close_fullscreen" />Flatten positions</LockedAction>
          </div>
        </div>
        {downloaded && <p className={styles.subtle} role="status">Snapshot downloaded.</p>}
        {!includeIcici && <Provenance panel={snapshot.pnl} />}
      </Card>

      <Card title="Session Telemetry" icon="verified_user" aside={<span className={passed === 4 ? styles.positive : styles.warning}>{passed}/4 PASSED</span>}>
        <div className={styles.telemetry}>
          {Object.entries(CHECK_LABELS).map(([key, label]) => {
            const check = checks?.[key as keyof typeof CHECK_LABELS];
            return <div className={styles.telemetryRow} key={key}><div><span>{label}</span>{check?.reason && <small>{check.reason}</small>}</div><strong className={check?.status === "passed" ? styles.positive : check?.status === "failed" ? styles.negative : styles.warning}>{CHECK_LABEL[check?.status ?? "unknown"]}</strong></div>;
          })}
        </div>
        <div className={styles.footerRow}><span>Deployment authorization</span><strong className={deployment?.grantStatus === "granted" ? styles.positive : styles.warning}>{deployment?.grantStatus ?? "Unknown"}</strong></div>
        <Provenance panel={snapshot.readiness} />
      </Card>
    </div>

    <Card title="Unified Multi-Broker Capital & Margin" icon="account_balance_wallet" subtitle="Account balances and collateral · allocations stay separate from margin" aside={<button type="button" className={styles.button} aria-expanded={showAllocations} onClick={() => setShowAllocations(!showAllocations)}><Icon name="tune" />Allocation details</button>}>
      <div className={styles.capitalGrid}>
        <div className={styles.capitalCard}>
          <div className={styles.label}>Available margin</div><div className={styles.capitalValue}><SnapshotMetric value={marginConfirmed ? holdings?.availableMarginPaise ?? null : null} scope={`${metricScope}:margin`} asOf={snapshot.holdings.asOf} /></div>
          <p className={styles.subtle}>Balances remain separate by account; this is not a shared spending pool.</p>
          <dl className={styles.values}><div><dt>Margin deployed</dt><dd><SnapshotMetric value={marginConfirmed ? holdings?.usedMarginPaise ?? null : null} scope={`${metricScope}:used`} asOf={snapshot.holdings.asOf} /></dd></div><div><dt>Collateral</dt><dd><SnapshotMetric value={marginConfirmed ? holdings?.collateralPaise ?? null : null} scope={`${metricScope}:collateral`} asOf={snapshot.holdings.asOf} /></dd></div></dl>
          <div className={styles.footerRow}><span>{`${holdingRows.length} holding records`}</span><span className={snapshot.holdings.status === "degraded" ? styles.warning : styles.muted}>{selectedBroker === "icici" ? (holdingsComplete ? "Snapshot received" : "*") : snapshot.holdings.status === "degraded" ? "Partial" : snapshot.holdings.status}</span></div>
        </div>
        {providers.map((provider) => {
          const connection = snapshot.connections.data?.find((item) => item.source.toLowerCase().includes(provider.toLowerCase()));
          const rows = holdingRows.filter((row) => row.provider === provider);
          const balance = holdings?.brokerBalances?.find((item) => item.provider === provider);
          return <div className={styles.capitalCard} key={provider}>
            {provider === "icici" && selectedBroker === "icici" && <><strong>ICICI · {icici.account?.accountId ?? "Unavailable"}</strong><p>{icici.status}</p><dl className={styles.values}>{[["total_bank_balance", "Bank balance (not margin)"], ["allocated_equity", "Equity allocation"], ["allocated_fno", "F&O allocation"], ["unallocated_balance", "Unallocated balance"], ["block_by_trade_equity", "Equity trade-blocked funds"], ["block_by_trade_fno", "F&O trade-blocked funds"], ["block_by_trade_balance", "Trade-blocked balance (broker reported)"]].map(([key, label]) => { const value = icici.account?.sections.funds?.rows[0]?.[key!]; return <div key={key}><dt>{label}</dt><dd><Money value={value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Math.round(Number(value) * 100)} /></dd></div>; })}</dl></>}
            <div className={styles.brokerTitle}><strong>{provider === "zerodha" ? "Zerodha Gateway" : provider === "kotak" ? "Kotak Gateway" : "ICICI Gateway"}</strong><span className={styles.tag}>{provider === "icici" ? (icici.account ? "REST snapshot received" : "Unavailable") : connection?.status.replaceAll("_", " ") ?? "Unknown"}</span></div>
            <dl className={styles.values}><div><dt>Available margin</dt><dd><Money value={balance?.availableMarginPaise} /></dd></div><div><dt>Used margin</dt><dd><Money value={balance?.usedMarginPaise} /></dd></div><div><dt>Collateral</dt><dd><Money value={balance?.collateralPaise} /></dd></div><div><dt>Reported holding records</dt><dd>{provider === "icici" ? icici.account?.sections.portfolioholdings?.status === "available" ? rows.length : "—" : balance ? rows.length : "—"}</dd></div></dl>
            <div className={styles.footerRow}><span>{connection?.latencyMs != null ? `${connection.latencyMs} ms reported latency` : "Latency unavailable"}</span><Link href="/app/broker-connections">Manage →</Link></div>
          </div>;
        })}
      </div>
      {showAllocations && <div className={styles.detail}>
        <p>Strategy allocations are not supplied by the broker. Available margin is not allocated capital. Zerodha margins shown here cover its equity account.</p>
        {holdingRows.map((holding) => <div className={styles.footerRow} key={`${holding.provider}:${holding.accountId}:${holding.symbol}`}><span>{holding.symbol} <span>({holding.provider})</span> · {holding.accountId}</span><span>{holding.quantity} units · <Money value={holding.marketValuePaise} /></span></div>)}
      </div>}
      {selectedBroker !== "icici" && <Provenance panel={snapshot.holdings} />}
    </Card>

    <Card title="Demat Holdings" icon="account_balance_wallet" aside={`${viewLabels[selectedBroker]} · Reported holding records`}>
      <ul>{holdingRows.slice(0,3).map((row,index)=><li key={row.provider+row.symbol+index}><strong>{row.symbol}</strong> · {row.provider} · {row.quantity} units</li>)}</ul><p>{holdingRows.length} reported holdings · <Link href="/app/cash-holdings">View detailed cash holdings →</Link></p>
      {!holdingsComplete && <sup title="Selected account data is incomplete. See broker data sources for details.">*</sup>}
    </Card>

    <Card title="Active Execution Engines" icon="account_tree" aside={deployment ? `Worker: ${deployment.workerStatus}` : "Deployment data unavailable"}>
      <div className={styles.tableScroll}><table><thead><tr>{["Strategy / deployment", "State", "Orders", "Capital", "Strategy P&L", "Action"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>
        {deployment?.deploymentId ? <tr><td><strong>{deployment.deploymentId}</strong><small>{deployment.scope ?? "Scope unavailable"}</small></td><td className={deployment.workerStatus === "running" ? styles.positive : styles.warning}>{deployment.workerStatus}</td><td>—</td><td>—</td><td>—</td><td><button type="button" className={styles.button} aria-expanded={showDeployment} onClick={() => setShowDeployment(!showDeployment)}>Inspect</button> <LockedAction>Pause</LockedAction></td></tr>
          : <tr><td colSpan={6}><div className={styles.empty}><Icon name="account_tree" /><strong>Execution engine data unavailable</strong><span>{snapshot.deployment.reason ?? "No deployment details supplied"}</span></div></td></tr>}
      </tbody></table></div>
      {showDeployment && deployment && <div className={styles.detail}>Grant: {deployment.grantStatus} · Valid until: {formatTimestamp(deployment.armedUntil)}<p>{deployment.lastOutcome ?? "No outcome reported"}</p></div>}
      <Provenance panel={snapshot.deployment} />
    </Card>

    <div className={styles.twoColumns}>
      <Card title="Live Open Positions" icon="candlestick_chart" aside={`${positionRows.length} reported broker positions · account-level, not strategy-owned`} className={styles.positions}>
        <OpenPositions showBroker={selectedBroker === "all"} excludeMcx={includeIcici} available={positionsComplete} scope={viewLabels[selectedBroker]} marginPaise={includeIcici ? null : holdings?.usedMarginPaise ?? null} rows={positionRows} />
        {snapshot.positions && <Provenance panel={snapshot.positions} />}
        <div className={styles.positionMetrics}>{["Net delta (Δ)", "Portfolio theta (Θ)", "Net vega (ν)", "Avg slippage"].map((label) => <div key={label}><span className={styles.label}>{label}</span><strong>—</strong></div>)}</div>
      </Card>

      <Card title="Gateways & Routing Matrix" icon="hub" aside={<Link className={styles.iconLink} href="/app/broker-connections" aria-label="Configure broker gateways"><Icon name="settings" /></Link>}>
        <div className={styles.telemetry}>{snapshot.connections.data?.map((connection) => <div key={connection.source} className={styles.telemetryRow}><div><strong>{connection.source}</strong><small>{connection.status.replaceAll("_", " ")} · {formatTimestamp(connection.asOf)}</small></div><strong className={styles.positive}>{connection.latencyMs == null ? "—" : `${connection.latencyMs} ms`}</strong></div>)}</div>
        <div className={styles.detail}><div className={styles.footerRow}><strong>Cross-broker routing</strong><span className={styles.warning}>Not configured</span></div><p>Account reads do not imply automatic order failover.</p><div className={styles.footerRow}><span>Residual exposure</span><span>{snapshot.activity.data ? snapshot.activity.data.residualExposure ? "Reported" : "None reported" : "Unknown"}</span></div></div>
        <Provenance panel={snapshot.connections} />
        <Link className={styles.configure} href="/app/broker-connections"><Icon name="tune" />Configure gateways</Link>
      </Card>
    </div>

    <Card title="Recent Broker Orders" icon="list_alt" aside="Available same-day orders · not an immutable audit log"><Link href="/app/orders-trades">View all orders →</Link><Link href="/app/funds-margin">View all funds & margin →</Link>
      <p className={styles.warning}>Coverage: up to 50 Zerodha orders plus available ICICI same-day orders. Kotak orders are unavailable; this is not a complete multi-broker order history.</p>
      <div className={styles.tableScroll}><table><thead><tr>{["Broker / account", "Order", "Contract", "Side", "Status", "Filled / Qty", "Average fill"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.brokerOrders?.data?.slice(0,3).map(order => <tr key={`zerodha:${order.orderId}`}><td>{selectedBroker === "all" && <span className={styles.brokerChip} data-broker="zerodha">Zerodha</span>}<small>{originalSnapshot.brokerReconciliation?.zerodha?.accountId ?? "Account not supplied"}</small></td><td>{order.orderId}</td><td><strong>{order.symbol}</strong><small>{order.exchange} · {order.product}</small></td><td>{order.side}</td><td>{order.status}</td><td>{order.filledQuantity} / {order.quantity}</td><td><Money value={order.filledQuantity ? Math.round(order.averagePrice * 100) : null} /></td></tr>)}
        {includeIcici && icici.account?.sections.order?.rows.slice(0,2).map((order, index) => <tr key={`icici:${order.order_id}:${index}`}><td>{selectedBroker === "all" && <span className={styles.brokerChip} data-broker="icici">ICICI</span>}<small>{icici.account?.accountId}</small></td><td>{order.order_id ?? "Unavailable"}</td><td><strong>{order.stock_code}</strong><small>{order.exchange_code} · {order.product_type} · {order.expiry_date} · {order.strike_price} · {order.right}</small></td><td>{order.action ?? "Unavailable"}</td><td>{order.status ?? "Unavailable"}</td><td>— / {order.quantity ?? "Unavailable"}<small>{order.pending_quantity ?? "Unknown"} pending</small></td><td><Money value={order.average_price == null || String(order.average_price).trim() === "" || !Number.isFinite(Number(order.average_price)) ? null : Math.round(Number(order.average_price) * 100)} /></td></tr>)}
      </tbody></table></div>
      {includeIcici && <p className={styles.subtle}>ICICI: {icici.account?.sections.order?.status ?? "Unavailable"}{icici.account?.sections.order?.reason ? ` · ${icici.account.sections.order.reason}` : ""} · {icici.status}</p>}
      {snapshot.brokerOrders?.data?.length === 0 && <p className={styles.subtle}>No Zerodha orders reported today.</p>}
      {/* Named "Zerodha:", not a bare "Order data unavailable" -- with an
          ICICI-scoped message right above it, an unlabeled one reads as
          if it could mean "everything", not specifically Zerodha's gap. */}
      {selectedBroker !== "icici" && (snapshot.brokerOrders ? <Provenance panel={snapshot.brokerOrders} /> : <p className={styles.warning}>Zerodha: Order data unavailable</p>)}
    </Card>
    <Card title="Live Audit Stream" icon="list_alt" aside="Snapshot activity · not a streaming subscription">
      {snapshot.activity.data?.events.length ? <ol className={styles.audit}>{snapshot.activity.data.events.map((event) => <li key={event.eventId}><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time><span className={styles.positive}>[{event.scope}]</span><span>{event.description}</span></li>)}</ol> : <div className={styles.empty}><Icon name="list_alt" /><strong>{snapshot.activity.data ? "No events in this snapshot" : "Audit activity unavailable"}</strong></div>}
      <Provenance panel={snapshot.activity} />
    </Card>
    <footer className={styles.terminalFooter}><span>NRAIAlgo · {snapshot.scope.exchange} / {snapshot.scope.segment}</span><span>Snapshot received: {formatTimestamp(snapshot.generatedAt)} IST</span></footer>
  </div>;
}

export { MarketOpenScreen, MarketOpenView } from "./market-open-desk";
