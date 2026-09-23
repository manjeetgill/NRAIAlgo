"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";
import { formatPaise, formatTimestamp } from "./format";
import styles from "./market-open.module.css";

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
export function MarketOpenScreen({ snapshot, layoutOnly = false }: { snapshot: OverviewSnapshot; layoutOnly?: boolean }) {
  const [showAllocations, setShowAllocations] = useState(false);
  const [showDeployment, setShowDeployment] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const pnl = snapshot.pnl.data;
  const holdings = snapshot.holdings.data;
  const deployment = snapshot.deployment.data;
  const positions = snapshot.positions?.data;
  const checks = snapshot.readiness.data?.checks;
  const passed = checks ? Object.values(checks).filter((check) => check.status === "passed").length : 0;
  const providers = Array.from(new Set(["zerodha", "kotak", ...(holdings?.holdings.map((row) => row.provider) ?? [])]));
  const close = snapshot.session.data?.nextTransitionAt;
  const roi = pnl?.netPaise != null && pnl.baseCapital.amountPaise != null && pnl.baseCapital.amountPaise > 0
    ? pnl.netPaise / pnl.baseCapital.amountPaise * 100 : null;

  function downloadSnapshot() {
    // OverviewSnapshot is already a public read model: it contains no broker secrets.
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
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
      <div className={styles.sessionLeft}><span className={styles.sessionPill}><i />{layoutOnly ? "Market-open layout · current account snapshot" : "Continuous market open"}</span>
        <span>{close ? `Next transition ${formatTimestamp(close)} IST` : "Next transition unavailable"}</span></div>
      <span className={styles.tag}>{snapshot.scope.context} ACCOUNT VIEW</span>
    </div>
    {snapshot.connections.data?.filter(connection => connection.source.startsWith("Kotak ") && connection.source.includes("WebSocket")).map(connection => <div className={styles.footerRow} role="status" key={connection.source}><span>{connection.source}</span><span>Display refresh: 1 second · REST reconciliation retained</span></div>)}
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
      <Card title="Session P&L Breakdown" icon="account_balance" subtitle="Broker P&L · charges and reconciliation status" aside={<>Allocated capital: <Money value={pnl?.baseCapital.amountPaise} /></>}>
        <div className={styles.pnlBody}>
          <div><div className={styles.label}>{pnl?.netPaise == null ? "Gross position P&L · before charges" : "Net session P&L"}</div><div className={styles.headline}>{pnl == null ? <span className={styles.muted}>Unavailable</span> : <Money value={pnl.netPaise ?? pnl.grossPaise} signed />}</div>
            {pnl?.netPaise == null && <span className={styles.subtle}>Net P&L: Unavailable until charges are reconciled. Tick valuations are estimates.</span>}
            <span className={styles.tag}>{roi == null ? "ROI unavailable" : `${roi >= 0 ? "+" : ""}${roi.toFixed(2)}% ROI`}</span>
            <span className={styles.subtle}>{pnl?.reconciliationStatus ?? "Awaiting account data"}</span>
          </div>
          <div className={styles.pnlMetrics}>
            <div><span className={styles.label}>Gross P&L</span><strong><Money value={pnl?.grossPaise} signed /></strong></div>
            <div><span className={styles.label}>Charges:</span><strong className={styles.warning}>{pnl?.chargesPaise == null ? "Pending" : formatPaise(pnl.chargesPaise)}</strong></div>
            <div><span className={styles.label}>Unrealised MTM</span><strong><Money value={pnl?.unrealisedPaise} signed /></strong></div>
          </div>
        </div>
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
        <Provenance panel={snapshot.pnl} />
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
          <div className={styles.label}>Aggregate available margin</div><div className={styles.capitalValue}><Money value={holdings?.availableMarginPaise} /></div>
          <dl className={styles.values}><div><dt>Margin deployed</dt><dd><Money value={holdings?.usedMarginPaise} /></dd></div><div><dt>Collateral</dt><dd><Money value={holdings?.collateralPaise} /></dd></div></dl>
          <div className={styles.footerRow}><span>{holdings ? `${holdings.holdings.length} holding records` : "Holdings unavailable"}</span><span className={snapshot.holdings.status === "degraded" ? styles.warning : styles.muted}>{snapshot.holdings.status === "degraded" ? "Partial" : snapshot.holdings.status}</span></div>
        </div>
        {providers.map((provider) => {
          const connection = snapshot.connections.data?.find((item) => item.source.toLowerCase().includes(provider.toLowerCase()));
          const rows = holdings?.holdings.filter((row) => row.provider === provider);
          const balance = holdings?.brokerBalances?.find((item) => item.provider === provider);
          return <div className={styles.capitalCard} key={provider}>
            <div className={styles.brokerTitle}><strong>{provider === "zerodha" ? "Zerodha Kite Gateway" : provider === "kotak" ? "Kotak Neo Gateway" : provider}</strong><span className={styles.tag}>{connection?.status.replaceAll("_", " ") ?? "Unknown"}</span></div>
            <dl className={styles.values}><div><dt>Available margin</dt><dd><Money value={balance?.availableMarginPaise} /></dd></div><div><dt>Used margin</dt><dd><Money value={balance?.usedMarginPaise} /></dd></div><div><dt>Collateral</dt><dd><Money value={balance?.collateralPaise} /></dd></div><div><dt>Reported holding records</dt><dd>{balance ? rows?.length ?? 0 : "—"}</dd></div></dl>
            <div className={styles.footerRow}><span>{connection?.latencyMs != null ? `${connection.latencyMs} ms reported latency` : "Latency unavailable"}</span><Link href="/app/broker-connections">Manage →</Link></div>
          </div>;
        })}
      </div>
      {showAllocations && <div className={styles.detail}>
        <p>Strategy allocations are not supplied by the broker. Available margin is not allocated capital. Zerodha margins shown here cover its equity account.</p>
        {holdings?.holdings.map((holding) => <div className={styles.footerRow} key={`${holding.provider}:${holding.accountId}:${holding.symbol}`}><span>{holding.symbol} <span>({holding.provider})</span> · {holding.accountId}</span><span>{holding.quantity} units · <Money value={holding.marketValuePaise} /></span></div>)}
      </div>}
      <Provenance panel={snapshot.holdings} />
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
      <Card title="Live Open Positions" icon="candlestick_chart" aside={positions ? `${positions.length} broker positions · account-level, not strategy-owned` : "Position feed unavailable"} className={styles.positions}>
        <div className={styles.tableScroll}><table><thead><tr>{["Contract", "Qty", "Avg entry", "Current LTP", "Gross P&L", "Action"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>
          {positions?.length ? positions.map(row => <tr key={`${row.provider}:${row.accountId}:${row.exchange}:${row.symbol}:${row.product}`}><td><strong>{row.symbol}</strong><small>{row.exchange} · {row.product} · {row.provider} · {row.accountId}</small></td><td>{row.quantity > 0 ? "+" : ""}{row.quantity}</td><td><Money value={Math.round(row.averagePrice * 100)} /></td><td><Money value={Math.round(row.lastPrice * 100)} /><small className={row.fresh ? styles.positive : styles.warning}>{row.fresh ? "Live tick" : "Last reported"} · {formatTimestamp(row.asOf)}</small></td><td><Money value={row.pnlPaise} signed /></td><td><LockedAction danger>Exit</LockedAction></td></tr>) : <tr><td colSpan={6}><div className={styles.empty}><Icon name="candlestick_chart" /><strong>{positions ? "No open positions reported" : "Awaiting position-level data"}</strong><span>{positions ? "Only successfully reported broker accounts are included; check data status below." : "Position data is unavailable; exposure cannot be confirmed here."}</span></div></td></tr>}
        </tbody></table></div>
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

    {snapshot.brokerOrders ? <Card title="Recent Zerodha Orders" icon="list_alt" aside="Latest 50 same-day broker orders · not an immutable audit log">
      <div className={styles.tableScroll}><table><thead><tr>{["Order", "Contract", "Side", "Status", "Filled / Qty", "Average fill"].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{snapshot.brokerOrders.data?.map(order => <tr key={order.orderId}><td>{order.orderId}</td><td><strong>{order.symbol}</strong><small>{order.exchange} · {order.product}</small></td><td>{order.side}</td><td>{order.status}</td><td>{order.filledQuantity} / {order.quantity}</td><td><Money value={order.filledQuantity ? Math.round(order.averagePrice * 100) : null} /></td></tr>)}</tbody></table></div>
      {snapshot.brokerOrders.data?.length === 0 && <p className={styles.subtle}>No Zerodha orders reported today.</p>}
      <Provenance panel={snapshot.brokerOrders} />
    </Card> : <Card title="Live Audit Stream" icon="list_alt" aside="Snapshot activity · not a streaming subscription">
      {snapshot.activity.data?.events.length ? <ol className={styles.audit}>{snapshot.activity.data.events.map((event) => <li key={event.eventId}><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time><span className={styles.positive}>[{event.scope}]</span><span>{event.description}</span></li>)}</ol> : <div className={styles.empty}><Icon name="list_alt" /><strong>{snapshot.activity.data ? "No events in this snapshot" : "Audit activity unavailable"}</strong></div>}
      <Provenance panel={snapshot.activity} />
    </Card>}
    <footer className={styles.terminalFooter}><span>NRAIAlgo · {snapshot.scope.exchange} / {snapshot.scope.segment}</span><span>Snapshot received: {formatTimestamp(snapshot.generatedAt)} IST</span></footer>
  </div>;
}
