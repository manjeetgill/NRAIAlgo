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
import { calculateOpenPnl, completePositionPnl, effectivePositionPnl, type OpenPositionView } from "./open-positions";

const PROVIDER_LABELS: Record<string, string> = { zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" };
const providerName = (provider: string) => PROVIDER_LABELS[provider] ?? provider;
const tone = (value: number | null) => value == null || value === 0 ? "neutral" : value > 0 ? "positive" : "negative";

function Icon({ name }: { name: string }) {
  return <span className={`material-symbols-outlined ${styles.icon}`} aria-hidden="true">{name}</span>;
}

function DeskCard({ title, icon, aside, children, className = "", ariaLabel }: { title: string; icon: string; aside?: ReactNode; children: ReactNode; className?: string; ariaLabel?: string }) {
  return <section className={`${styles.deskCard} ${className}`} aria-label={ariaLabel ?? title}>
    <header className={styles.deskCardHeader}><div className={styles.deskCardTitle}><Icon name={icon} /><h2>{title}</h2></div>{aside && <div className={styles.deskCardAside}>{aside}</div>}</header>
    <div className={styles.deskCardBody}>{children}</div>
  </section>;
}

function Money({ value, signed = false, unavailable = "Unavailable" }: { value: number | null | undefined; signed?: boolean; unavailable?: string }) {
  const className = value == null ? styles.muted : value < 0 ? styles.negative : signed && value > 0 ? styles.positive : "";
  return <span className={className}>{value == null ? unavailable : `${signed && value > 0 ? "+" : ""}${formatPaise(value)}`}</span>;
}

function LockedAction({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <button type="button" className={`${styles.commandButton} ${danger ? styles.commandDanger : ""}`} disabled title="Execution command service is not connected">{children}</button>;
}

function Provenance({ panel }: { panel: Panel<unknown> }) {
  return <div className={styles.compactProvenance}>{panel.status !== "available" && <span className={styles.warning}>{panel.status === "degraded" ? "Partial · " : ""}{panel.reason}</span>}<span>Source: {panel.source} · As of {formatTimestamp(panel.asOf)}</span></div>;
}

function paise(value: unknown) {
  if (value == null || String(value).trim() === "" || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100);
}

export function resolvedOverallPnl(pnl: { netPaise: number | null; grossPaise: number } | null, positionFallback: number | null) {
  return pnl?.netPaise ?? pnl?.grossPaise ?? positionFallback;
}

function connectionState(snapshot: OverviewSnapshot, provider: string, iciciStatus: string) {
  if (provider === "icici") return iciciStatus;
  const rows = snapshot.connections.data?.filter(row => row.source.toLowerCase().includes(provider)) ?? [];
  if (!rows.length) return "Status unavailable";
  return rows.some(row => row.status === "connected") ? "Connected" : rows[0]!.status.replaceAll("_", " ");
}

function MarketIndexStrip({ snapshot }: { snapshot: OverviewSnapshot }) {
  const quotes = snapshot.prices.data ?? [];
  return <section className={styles.indexStrip} aria-label="Market indices">
    <div className={styles.indexRail}>
      {quotes.slice(0, 3).map(quote => {
        const state = quote.fresh ? "LIVE" : quote.priceBasis === "official-close" ? "CLOSE" : "LAST";
        return <div className={styles.indexQuote} key={quote.instrumentId}>
          <span className={`${styles.indexDot} ${quote.fresh ? styles.indexDotLive : styles.indexDotStale}`} aria-hidden="true" />
          <strong className={styles.indexName}>{quote.label.replace("BANK NIFTY", "BANKNIFTY").replace("FIN NIFTY", "FINNIFTY")}</strong>
          <span className={styles.indexValue}>{quote.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className={`${styles.indexState} ${quote.fresh ? styles.indexStateLive : styles.indexStateStale}`}>{state}</span>
          <span className={styles.indexMeta}>{quote.fresh ? "Updated" : quote.priceBasis === "official-close" ? "Official close" : "Last observed"} {formatTimestamp(quote.sourceAsOf)} IST</span>
        </div>;
      })}
      {!quotes.length && <div className={styles.indexUnavailable}><span className={`${styles.indexDot} ${styles.indexDotStale}`} aria-hidden="true" /><strong>MARKET INDICES</strong><span>{snapshot.prices.reason ?? "Market prices unavailable"}</span></div>}
    </div>
    {snapshot.prices.status === "degraded" && <span className={styles.indexNotice}>{snapshot.prices.reason}</span>}
  </section>;
}

export function MarketOpenScreen({ snapshot, layoutOnly = false }: { snapshot: OverviewSnapshot; layoutOnly?: boolean }) {
  const icici = useIciciAccount();
  return <MarketOpenView snapshot={snapshot} layoutOnly={layoutOnly} icici={icici} />;
}

/** Reference-matched monitoring desk. Reference-only sample values and actions are never copied into the real account view. */
export function MarketOpenView({ snapshot: originalSnapshot, layoutOnly = false, icici }: { snapshot: OverviewSnapshot; layoutOnly?: boolean; icici: ReturnType<typeof useIciciAccount> }) {
  const [selectedBroker, setSelectedBroker] = useState<BrokerView>("all");
  const [showDeployment, setShowDeployment] = useState(false);
  const [showAllocations, setShowAllocations] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const snapshot = brokerView(originalSnapshot, selectedBroker);
  const viewLabels = brokerViewLabels(originalSnapshot);
  const providers = selectedProviders(originalSnapshot, selectedBroker);
  const includeIcici = providers.includes("icici");
  const consolidated = selectedBroker === "all";
  const deskName = consolidated ? "Cross-Broker" : providerName(selectedBroker);
  const pnl = snapshot.pnl.status === "available" && !includeIcici ? snapshot.pnl.data : null;
  const holdings = snapshot.holdings.data;
  const holdingRows = [...(holdings?.holdings ?? []), ...(includeIcici ? iciciHoldings(icici.account) : [])];
  const positionRows: OpenPositionView[] = [
    ...(snapshot.positions?.data?.filter(row => row.quantity !== 0) ?? []).map(row => ({
      id: `${row.provider}:${row.accountId}:${row.exchange}:${row.symbol}:${row.product}`, provider: row.provider, symbol: row.symbol, account: row.accountId, exchange: row.exchange, product: row.product,
      quantity: row.quantity, average: row.averagePrice, ltp: row.lastPrice, previousClose: row.previousClose ?? null, pnlPaise: row.pnlPaise, mtmPaise: row.mtmPaise ?? null, side: row.quantity < 0 ? "SELL" as const : "BUY" as const,
      asOf: row.asOf, fresh: row.fresh, estimatedPnlPaise: calculateOpenPnl(row.quantity, row.averagePrice, row.lastPrice, row.multiplier),
    })),
    ...(includeIcici && icici.account ? iciciPositions(icici.account.sections.portfoliopositions?.rows ?? [], icici.account.accountId, icici.account.sections.portfoliopositions?.asOf ?? icici.account.asOf) : []),
  ];
  const holdingsComplete = hasCoreCoverage(snapshot, selectedBroker, "holdings") && (!includeIcici || (!icici.stale && icici.account?.sections.portfolioholdings?.status === "available"));
  const positionsComplete = hasCoreCoverage(snapshot, selectedBroker, "positions") && (!includeIcici || (!icici.stale && icici.account?.sections.portfoliopositions?.status === "available"));
  // MCX records are shown in the position table, but excluded from the
  // aggregate until a verified commodity multiplier/calculation basis exists.
  const pnlEligibleRows = positionRows.filter(row => row.exchange.toUpperCase() !== "MCX");
  const pnlCoveredCount = pnlEligibleRows.filter(row => effectivePositionPnl(row) != null).length;
  const unsupportedPnlCount = positionRows.length - pnlEligibleRows.length;
  const missingPnlCount = pnlEligibleRows.length - pnlCoveredCount;
  const pnlExclusions = [unsupportedPnlCount ? `${unsupportedPnlCount} MCX/unsupported` : null, missingPnlCount ? `${missingPnlCount} missing P&L` : null].filter(Boolean).join(" · ") || "No exclusions";
  const positionPnl = completePositionPnl(pnlEligibleRows, selectedBroker === "icici" ? icici.account?.sections.portfoliopositions?.status === "available" : positionsComplete);
  const dayMtmRows = includeIcici ? pnlEligibleRows : positionRows;
  const dayMtm = positionsComplete && dayMtmRows.every(row => row.mtmPaise != null) ? dayMtmRows.reduce((sum, row) => sum + row.mtmPaise!, 0) : null;
  const marginConfirmed = holdingsComplete && !includeIcici && snapshot.holdings.status === "available";
  const availableMargin = marginConfirmed ? holdings?.availableMarginPaise ?? null : null;
  const usedMargin = marginConfirmed ? holdings?.usedMarginPaise ?? null : null;
  const collateral = marginConfirmed ? holdings?.collateralPaise ?? null : null;
  const positionFallback = selectedBroker === "icici" || (snapshot.pnl.status === "available" && includeIcici) ? positionPnl : null;
  const overallPnl = resolvedOverallPnl(pnl, positionFallback);
  const grossPnl = pnl?.grossPaise ?? positionFallback;
  const roi = pnl?.netPaise != null && pnl.baseCapital.amountPaise != null && pnl.baseCapital.amountPaise > 0 ? pnl.netPaise / pnl.baseCapital.amountPaise * 100 : null;
  const holdingValue = holdingsComplete && holdingRows.every(row => row.marketValuePaise != null) ? holdingRows.reduce((sum, row) => sum + (row.marketValuePaise ?? 0), 0) : null;
  const deployment = snapshot.deployment.data;
  const checks = snapshot.readiness.data?.checks;
  const passed = checks ? Object.values(checks).filter(check => check.status === "passed").length : 0;
  const metricScope = JSON.stringify([snapshot.scope, selectedBroker, providers]);
  const iciciFunds = icici.account?.sections.funds?.rows[0];
  const bankBalance = selectedBroker === "icici" ? paise(iciciFunds?.total_bank_balance) : null;
  const capitalHeadline = selectedBroker === "icici" ? bankBalance : availableMargin;
  const capitalLabel = selectedBroker === "icici" ? "Bank balance (not margin)" : consolidated ? "Confirmed available margin" : "Available margin";

  function downloadSnapshot() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ overview: snapshot, brokerView: selectedBroker, icici: includeIcici ? icici.account : null }, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `nraialgo-overview-${snapshot.generatedAt.replaceAll(":", "-")}.json`; anchor.click(); URL.revokeObjectURL(url); setDownloaded(true);
  }

  const capitalTitle = consolidated ? "Cross-Broker Capital & Margin" : `${deskName} Capital & Margin`;
  const pnlTitle = consolidated ? "Consolidated Intraday P&L" : `${deskName} Intraday P&L`;
  const greekTitle = consolidated ? "Portfolio Greeks & Parity" : `${deskName} Desk Greeks & Controls`;
  const positionTitle = consolidated ? "Active F&O Positions" : `${deskName} Active Positions (F&O)`;
  const holdingTitle = consolidated ? "Demat Cash Holdings" : `${deskName} Demat Custody`;
  const engineTitle = consolidated ? "Active Execution Engines" : `${deskName} Dedicated Execution Engines`;
  const auditTitle = consolidated ? "Cross-Broker Surveillance Log" : `${deskName} Gateway Audit & Trace`;

  return <div className={styles.desk}>
    <h1 className={styles.srOnly}>Market open</h1>
    <section className={styles.deskToolbar} aria-label="Dashboard scope">
      <div className={styles.deskIdentity}><span className={styles.identityIcon}><Icon name={consolidated ? "hub" : "shield_person"} /></span><div><strong>{consolidated ? "Consolidated Portfolio Desk" : `${deskName} — Dedicated Account Desk`}</strong><small>{layoutOnly ? "Market-open layout preview" : "Live broker account monitoring"} · read only</small></div></div>
      <BrokerFilter value={selectedBroker} onChange={value => { setSelectedBroker(value); setDownloaded(false); }} />
      <div className={styles.toolbarStatus}><span className={styles.liveDot} /><span>{consolidated ? `${providers.length} broker routes` : connectionState(snapshot, selectedBroker, icici.status)}</span><span className={styles.toolbarDivider} /><strong>Execution locked</strong></div>
    </section>

    <MarketIndexStrip snapshot={snapshot} />

    <div className={styles.deskTopGrid}>
      <DeskCard title={capitalTitle} icon="account_balance_wallet" aside={<span className={styles.statusBadge}>{selectedBroker === "icici" && capitalHeadline != null ? "Bank balance" : capitalHeadline == null ? "Partial" : snapshot.holdings.status === "degraded" ? "Partial" : snapshot.holdings.status}</span>}>
        <div className={styles.primaryMetricLabel}>{capitalLabel}</div><div className={styles.primaryMetric}><SnapshotMetric value={capitalHeadline} scope={`${metricScope}:capital`} asOf={snapshot.holdings.asOf} /></div>
        <div className={styles.progressTrack}><span style={{ width: usedMargin != null && availableMargin != null && usedMargin + availableMargin > 0 ? `${Math.min(100, usedMargin / (usedMargin + availableMargin) * 100)}%` : "0%" }} /></div>
        <div className={styles.capitalSummary}><div><span>Margin blocked</span><Money value={usedMargin} /></div><div><span>Collateral</span><Money value={collateral} /></div></div>
        <div className={styles.accountBreakdown}>{providers.map(provider => { const balance = holdings?.brokerBalances?.find(row => row.provider === provider); const bank = provider === "icici" ? paise(iciciFunds?.total_bank_balance) : null; return <div key={provider}><span><i data-provider={provider} />{providerName(provider)}</span><strong><Money value={provider === "icici" ? bank : balance?.availableMarginPaise} /></strong><small>{provider === "icici" ? "Bank balance · not margin" : connectionState(snapshot, provider, icici.status)}</small></div>; })}</div>
      </DeskCard>

      <DeskCard title={pnlTitle} icon="trending_up" ariaLabel={includeIcici ? "Open-position P&L" : "Session P&L Breakdown"} aside={roi == null ? <span className={styles.statusBadge}>Before charges</span> : <span className={styles.successBadge}>{roi >= 0 ? "+" : ""}{roi.toFixed(2)}% ROI</span>}>
        <div className={styles.primaryMetricLabel}>Reported / estimated position P&amp;L · Excluding MCX</div><div className={`${styles.primaryMetric} ${grossPnl != null && grossPnl > 0 ? styles.positive : grossPnl != null && grossPnl < 0 ? styles.negative : ""}`}><SnapshotMetric value={grossPnl} scope={`${metricScope}:pnl`} asOf={snapshot.pnl.asOf} signed /></div>
        <div className={styles.pnlEquation}><span><Money value={grossPnl} signed /> gross</span><span>Charges: <Money value={pnl?.chargesPaise} unavailable="Pending" /></span><strong>Net: <Money value={pnl?.netPaise} signed /></strong></div>
        <div className={styles.pnlCoverage}><div><span>Positions included</span><strong>{pnlCoveredCount} of {positionRows.length} active</strong><small>{pnlExclusions}</small></div><div><span>Day MTM{includeIcici ? " · Ex-MCX" : ""}</span><strong><Money value={dayMtm} signed /></strong></div><div><span>Charges</span><strong>{pnl?.chargesPaise == null ? "Pending" : "Reported"}</strong></div></div>
        <details className={styles.inlineDetails}><summary>Metric details *</summary><p>Broker-reported values are preferred. Calculated open-position estimates exclude realized P&amp;L and charges; net P&amp;L requires reconciled charges. ICICI does not supply a comparable consolidated session total.</p></details>
      </DeskCard>

      <DeskCard title={greekTitle} icon="balance" aside={<span className={styles.statusBadge}>Read only</span>}>
        <div className={styles.greeksGrid}><div><span>Net Delta (Δ)</span><strong>—</strong><small>Not supplied</small></div><div><span>Gamma (Γ)</span><strong>—</strong><small>Not supplied</small></div><div><span>Daily Theta (Θ)</span><strong>—</strong><small>Not supplied</small></div></div>
        <div className={styles.controlNotice}><Icon name="info" /><span>Broker APIs do not currently provide verified portfolio Greeks.</span></div><div className={styles.controlButtons}><LockedAction>Place order</LockedAction><LockedAction danger>Flatten positions</LockedAction></div>
      </DeskCard>
    </div>

    <section className={styles.metricStrip} aria-label="Portfolio summary">
      <div><span>Open positions</span><strong>{positionsComplete || positionRows.length ? `${positionRows.length} Active` : "Unavailable"}</strong><small>{providers.map(provider => `${positionRows.filter(row => row.provider === provider).length} ${providerName(provider)}`).join(" · ")}</small></div>
      <div><span>Day&apos;s intraday MTM</span><strong data-tone={tone(dayMtm)}><Money value={dayMtm} signed /></strong><small>Previous close → current · open positions{includeIcici && " · Excluding MCX"}</small></div>
      <div><span>Total overall P&amp;L</span><strong data-tone={tone(overallPnl)}><Money value={overallPnl} signed /></strong><small>{pnl?.netPaise != null ? "Net after reported charges" : "Gross before charges"}</small></div>
      <div><span>Margin blocked</span><strong className={usedMargin == null ? styles.muted : styles.warning}><Money value={usedMargin} /></strong><small>{usedMargin == null ? "Not confirmed for full scope" : "Account-reported used margin"}</small></div>
      <div><span>Net exposure &amp; delta</span><strong>Unavailable</strong><small>Greeks source not connected</small></div>
    </section>

    <div className={styles.primaryWorkspace}>
      <DeskCard title={positionTitle} icon="layers" ariaLabel="Live Open Positions" aside={<><span>{positionRows.length} open</span><span className={styles.liveFeed}><i />{includeIcici ? "Broker streams + REST" : "Broker feed"}</span></>}>
        <div className={styles.compactTableWrap}><table className={styles.compactTable}><thead><tr><th>Instrument &amp; route</th><th>Side / Qty</th><th>Avg / LTP</th><th>Day MTM</th><th>Net P&amp;L</th><th>Action</th></tr></thead><tbody>
          {positionRows.slice(0, 5).map(row => { const rowPnl = effectivePositionPnl(row); return <tr key={row.id}><td><strong>{row.symbol}</strong><span className={styles.routeLine}>{consolidated && <span className={styles.brokerChip} data-broker={row.provider} aria-label={`Broker: ${providerName(row.provider)}`}>{providerName(row.provider)}</span>}{row.exchange} · {row.product}</span>{row.fresh && <small className={styles.positive}>Live tick</small>}</td><td><span className={row.side === "SELL" ? styles.sell : styles.buy} data-tone={row.side === "SELL" ? "negative" : "positive"}>{row.side ?? "—"}</span><strong data-tone={row.quantity != null && row.quantity < 0 ? "negative" : "positive"}>{row.quantity ?? "—"}</strong></td><td><span>{row.average == null ? "—" : formatPaise(Math.round(row.average * 100))}</span><strong>{row.ltp == null ? "—" : formatPaise(Math.round(row.ltp * 100))}</strong></td><td data-tone={tone(row.mtmPaise ?? null)}><Money value={row.mtmPaise} signed /></td><td data-tone={tone(rowPnl)}><Money value={rowPnl} signed />{row.pnlPaise == null && rowPnl != null && <sup title="Calculated from last price, average entry and signed quantity">*</sup>}</td><td><span className={styles.rowActions}>{!consolidated && <button type="button" className={styles.exitChip} disabled title="Execution command service is not connected" aria-label={`Exit ${row.symbol}`}>Exit</button>}<Link className={styles.rowAction} href="/app/live-positions">Inspect</Link></span></td></tr>; })}
          {!positionRows.length && <tr><td colSpan={6}><div className={styles.tableEmpty}><strong>{positionsComplete ? "No open positions" : "Awaiting position-level data"}</strong><span>{snapshot.positions?.reason ?? "No broker position records were returned for this view."}</span></div></td></tr>}
        </tbody></table></div><div className={styles.panelFooter}><span>Margin: <Money value={usedMargin} /> · Net Delta: Unavailable</span><Link href="/app/live-positions">Inspect all positions →</Link></div>
      </DeskCard>

      <DeskCard title={holdingTitle} icon="account_balance" ariaLabel="Demat Holdings" aside={<span className={styles.statusBadge}>{holdingRows.length} records</span>}>
        <div className={styles.holdingHeadline}><span>Total confirmed valuation</span><strong><Money value={holdingValue} /></strong><small>{holdingValue == null ? "Complete valuation unavailable" : `${holdingRows.length} broker-reported holdings`}</small></div>
        <div className={styles.holdingList}>{holdingRows.slice(0, 4).map((row, index) => <div key={`${row.provider}:${row.accountId}:${row.symbol}:${index}`}><div><strong>{row.symbol}</strong><small>{providerName(row.provider)} · {row.accountId}</small></div><div><strong>{row.quantity} units</strong><small><Money value={row.marketValuePaise} /></small></div></div>)}{!holdingRows.length && <div className={styles.tableEmpty}><strong>No holdings returned</strong><span>{snapshot.holdings.reason ?? "The selected broker did not return demat holdings."}</span></div>}</div>
        <div className={styles.panelFooter}><span>{holdingsComplete ? "Broker snapshot received" : "Incomplete account coverage"}</span><Link href="/app/cash-holdings">View detailed holdings →</Link></div>
      </DeskCard>
    </div>

    <div className={styles.secondaryWorkspace}>
      <DeskCard title={engineTitle} icon="smart_toy" ariaLabel="Active Execution Engines" aside={<span className={deployment?.workerStatus === "running" ? styles.successBadge : styles.statusBadge}>{deployment?.workerStatus === "running" ? "1 engine active" : "No active engine"}</span>}>
        {deployment?.deploymentId ? <div className={styles.engineRow}><span className={deployment.workerStatus === "running" ? styles.engineLive : styles.engineIdle} /><div><strong>{deployment.deploymentId}</strong><small>{deployment.scope ?? "Scope unavailable"}</small></div><div><span>Grant</span><strong>{deployment.grantStatus}</strong></div><button type="button" className={styles.rowAction} aria-expanded={showDeployment} onClick={() => setShowDeployment(!showDeployment)}>Inspect</button><LockedAction>Pause entries</LockedAction></div> : <div className={styles.tableEmpty}><strong>Execution engine data unavailable</strong><span>{snapshot.deployment.reason ?? "No deployment details supplied"}</span></div>}
        {showDeployment && deployment && <div className={styles.deploymentDetail}>Grant: {deployment.grantStatus} · Valid until: {formatTimestamp(deployment.armedUntil)} · {deployment.lastOutcome ?? "No outcome reported"}</div>}
        <div className={styles.panelFooter}><span>Order router: execution service not connected</span><span><LockedAction danger>Kill switches</LockedAction></span></div>
      </DeskCard>
      <DeskCard title={auditTitle} icon="terminal" aside={<span className={styles.liveFeed}><i />Snapshot activity</span>}>
        {snapshot.activity.data?.events.length ? <ol className={styles.compactAudit}>{snapshot.activity.data.events.slice(0, 5).map(event => <li key={event.eventId}><time dateTime={event.occurredAt}>{formatTimestamp(event.occurredAt)}</time><b>[{event.scope}]</b><span>{event.description}</span></li>)}</ol> : <div className={styles.tableEmpty}><strong>{snapshot.activity.data ? "No events in this snapshot" : "Audit activity unavailable"}</strong><span>{snapshot.activity.reason}</span></div>}
        <div className={styles.panelFooter}><span>Connections: {snapshot.connections.data?.length ?? 0} reported channels</span><Link href="/app/broker-connections">Configure gateways →</Link></div>
      </DeskCard>
    </div>

    <section className={styles.diagnostics} aria-label="Broker records and diagnostics"><details><summary>Broker records, order coverage &amp; data provenance</summary><div className={styles.diagnosticGrid}><div><h2>Broker data status</h2><BrokerDataStatus snapshot={snapshot} broker={selectedBroker} iciciStatus={icici.status} /><button type="button" className={styles.rowAction} aria-expanded={showAllocations} onClick={() => setShowAllocations(!showAllocations)}>Allocation details</button>{showAllocations && <div className={styles.orderRows}>{holdingRows.map((row, index) => <div key={`${row.provider}:${row.accountId}:${row.symbol}:${index}`}><span>{row.symbol} <b>({row.provider})</b></span><span>{row.quantity} units · <Money value={row.marketValuePaise} /></span></div>)}</div>}</div><section aria-label="Recent Broker Orders"><h2>Recent Broker Orders</h2><div className={styles.orderRows}>{snapshot.brokerOrders?.data?.slice(0, 3).map(order => <div key={order.orderId}><span><b>Zerodha</b> · <strong>{order.orderId}</strong> · {order.symbol}</span><span>{order.side} · {order.status} · <strong>{order.filledQuantity} / {order.quantity}</strong></span></div>)}{includeIcici && icici.account?.sections.order?.rows.slice(0, 3).map((order, index) => <div key={`${order.order_id}:${index}`}><span><b>ICICI</b> · <strong>{order.order_id ?? "Unavailable"}</strong> · {order.stock_code}</span><span>{order.action ?? "Unavailable"} · {order.status ?? "Unavailable"} · — / {order.quantity ?? "Unavailable"}</span></div>)}{!snapshot.brokerOrders?.data?.length && selectedBroker !== "icici" && <p className={styles.warning}>Zerodha: Order data unavailable</p>}{includeIcici && !icici.account?.sections.order?.rows.length && <p className={styles.warning}>ICICI: Order data unavailable</p>}</div><Link href="/app/orders-trades">View all broker orders →</Link></section></div><div className={styles.provenanceGrid}><Provenance panel={snapshot.holdings} /><Provenance panel={snapshot.positions ?? snapshot.holdings} /><Provenance panel={snapshot.activity} /></div></details></section>
    <footer className={styles.deskFooter}><span>NRAIAlgo · {snapshot.scope.exchange} / {snapshot.scope.segment} · {viewLabels[selectedBroker]}</span><span><strong>{passed}/4 PASSED</strong> · Snapshot {formatTimestamp(snapshot.generatedAt)} IST</span><button type="button" onClick={downloadSnapshot}><Icon name="download" />{downloaded ? "Downloaded" : "Download snapshot"}</button></footer>
  </div>;
}
