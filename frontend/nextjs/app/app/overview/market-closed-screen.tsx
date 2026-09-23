"use client";

import { UpdatedAt } from "./updated-at";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";
import { formatPaise, formatTimestamp } from "./format";
import shared from "./market-open.module.css";
import styles from "./market-closed.module.css";
import { PortfolioTable, type PortfolioRow } from "./portfolio-table";
import { AlphaWire } from "@/app/components/shell/alpha-wire";
import { completePositionPnl, effectivePositionPnl, type OpenPositionView } from "./open-positions";

function Card({ title, badge, children, className = "" }: { title: string; badge?: string; children: ReactNode; className?: string | undefined }) {
  return <section className={`${styles.card} ${className}`} aria-label={title}><header className={styles.cardHeader}><h2>{title}</h2>{badge && <span className={shared.tag}>{badge}</span>}</header>{children}</section>;
}
function Source({ panel }: { panel: Panel<unknown> }) {
  return <details className={shared.provenance}><summary>Source & refresh {panel.status !== "available" ? "*" : ""}</summary><UpdatedAt value={panel.asOf}/><p>Source: {panel.source}</p><span>{panel.reason}</span></details>;
}
function Money({ value }: { value: number | null | undefined }) {
  return <span className={value == null ? shared.muted : value < 0 ? shared.negative : undefined}>{value == null ? "—" : formatPaise(value)}</span>;
}
function crore(value: number | null | undefined) {
  return value == null ? "Unavailable" : `${value >= 0 ? "+" : "−"}₹${Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
}
const CHECKS = { totp: "Platform MFA", priceFeed: "Regular-session live feed", brokerSessions: "Broker sessions", riskLimits: "Risk limits" };
const STATUS: Record<string, string> = { passed: "Passed", failed: "Failed", unknown: "Unknown", not_applicable: "Not applicable" };

/** Calendar selects this view; a closed exchange does not settle an account,
 * revoke a broker token, flatten exposure, or authorize the next deployment. */
export function MarketClosedScreen({ snapshot, layout, accountHoldings, accountPositions }: { snapshot: OverviewSnapshot; layout?: "after-close" | "weekend-holiday"; accountHoldings?: { rows: PortfolioRow[]; complete: boolean }; accountPositions?: { rows: OpenPositionView[]; complete: boolean; includesIcici: boolean } }) {
  const [act, setAct] = useState<"stress" | "settle" | "tomorrow">("stress");
  const weekend = (layout ?? snapshot.session.data?.state) === "weekend-holiday";
  const actuallyClosed = snapshot.session.data?.calendarValid && (snapshot.session.data.state === "after-close" || snapshot.session.data.state === "weekend-holiday");
  const session = snapshot.session.data;
  const pnl = snapshot.pnl.data;
  const perf = pnl?.performance;
  const holdings = snapshot.holdings.data;
  const expired = snapshot.connections.data?.filter(connection => connection.status === "session_expired") ?? [];
  const checks = Object.entries(CHECKS).map(([key, label]) => ({ label,
    check: key === "priceFeed" && actuallyClosed ? { status: "not_applicable", reason: "The regular market is closed; this does not verify the next session's feed." }
      : key === "brokerSessions" && expired.length ? { status: "failed", reason: "A reported broker session has expired." }
      : snapshot.readiness.data?.checks[key as keyof typeof CHECKS] ?? { status: "unknown", reason: "No verification available" },
  }));
  const passed = checks.filter(({ check }) => check.status === "passed").length;
  const holdingRows = accountHoldings?.rows ?? holdings?.holdings ?? [];
  const complete = accountHoldings?.complete ?? snapshot.holdings.status === "available";
  const holdingValue = holdingRows.length && holdingRows.every(row => row.marketValuePaise != null) ? holdingRows.reduce((sum, row) => sum + row.marketValuePaise!, 0) : null;
  const fallbackPositions: OpenPositionView[] = (snapshot.positions?.data ?? []).filter(position => position.quantity !== 0).map(position => ({
    id: `${position.provider}:${position.accountId}:${position.exchange}:${position.symbol}:${position.product}`,
    provider: position.provider, account: position.accountId, symbol: position.symbol, exchange: position.exchange, product: position.product,
    quantity: position.quantity, average: position.averagePrice, ltp: position.lastPrice, previousClose: position.previousClose ?? null,
    pnlPaise: position.pnlPaise, mtmPaise: position.mtmPaise ?? null, side: position.quantity < 0 ? "SELL" : "BUY", asOf: position.asOf, fresh: position.fresh,
  }));
  const reconciled = pnl?.reconciliationStatus === "reconciled" && pnl.netPaise !== null;
  const closeQuotes = snapshot.prices.data ?? [];
  const activePositions = accountPositions?.rows ?? fallbackPositions;
  const positionCoverageComplete = accountPositions?.complete ?? snapshot.positions?.status === "available";
  const reportedDayMtm = activePositions.filter(position => position.mtmPaise != null);
  const dayMtmComplete = positionCoverageComplete && reportedDayMtm.length === activePositions.length;
  const dayMtm = dayMtmComplete || reportedDayMtm.length
    ? reportedDayMtm.reduce((sum, position) => sum + position.mtmPaise!, 0)
    : null;
  const reportedOpenPnl = activePositions.map(effectivePositionPnl).filter((value): value is number => value !== null);
  const openPnlComplete = positionCoverageComplete && reportedOpenPnl.length === activePositions.length;
  const openPositionPnl = openPnlComplete
    ? completePositionPnl(activePositions, true)
    : reportedOpenPnl.length ? reportedOpenPnl.reduce((sum, value) => sum + value, 0) : null;
  const iciciMargins = activePositions.filter(position => position.provider === "icici").map(position => position.marginPaise ?? null);
  const reportedIciciMargins = iciciMargins.filter((value): value is number => value !== null);
  const iciciMarginComplete = !accountPositions?.includesIcici || positionCoverageComplete && reportedIciciMargins.length === iciciMargins.length;
  const iciciUsedMargin = reportedIciciMargins.reduce((sum, value) => sum + value, 0);
  const usedMargin = holdings ? holdings.usedMarginPaise + iciciUsedMargin : reportedIciciMargins.length ? iciciUsedMargin : null;
  const usedMarginComplete = snapshot.holdings.status === "available" && iciciMarginComplete;
  // Breeze does not expose a value equivalent to the other brokers' free
  // trading margin/collateral fields. Withhold those consolidated totals
  // instead of silently presenting the non-ICICI subtotal as complete.
  const availableMargin = accountPositions?.includesIcici ? null : holdings?.availableMarginPaise;
  const collateral = accountPositions?.includesIcici ? null : holdings?.collateralPaise;
  const totalMargin = availableMargin != null && usedMargin != null ? availableMargin + usedMargin : null;
  const usedMarginPct = totalMargin && totalMargin > 0 ? usedMargin! / totalMargin * 100 : null;
  const providerLabel = (provider: string) => ({ zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" }[provider] ?? provider);
  const nifty = closeQuotes.find(item => item.instrumentId === "NSE:NIFTY50");
  const officialCloseMatched = snapshot.prices.status === "available" && closeQuotes.length > 0 && closeQuotes.every(item => item.priceBasis === "official-close");
  const marketReferenceTiles = [
    { id: "NSE:NIFTY50", label: "NIFTY 50" },
    { id: "NSE:BANKNIFTY", label: "BANK NIFTY" },
    { id: "NSE:INDIAVIX", label: "INDIA VIX" },
    { id: "NSEIX:GIFTNIFTY", label: "GIFT NIFTY" },
  ].map(tile => ({ ...tile, quote: closeQuotes.find(item => item.instrumentId === tile.id) }));
  const intelligence = snapshot.eodIntelligence?.data;
  const fiiCash = intelligence?.cashActivity?.find(row => row.category === "FII/FPI");
  const diiCash = intelligence?.cashActivity?.find(row => row.category === "DII");
  const fiiOi = intelligence?.participantOi?.find(row => row.category === "FII");
  const diiOi = intelligence?.participantOi?.find(row => row.category === "DII");
  const indexNet = (row: typeof fiiOi) => row ? row.futureIndexLong - row.futureIndexShort : null;
  const providerRows = ["zerodha", "kotak", "icici"].map(provider => ({
    provider,
    positions: activePositions.filter(position => position.provider === provider).length,
    holdings: holdingRows.filter(row => row.provider === provider).length,
    connection: snapshot.connections.data?.find(connection => connection.source.toLowerCase().includes(provider)),
  }));

  return <div className={`${shared.terminal} ${styles.closed} ${weekend ? styles.weekend : ""}`}>
    <h1 className={shared.srOnly}>{weekend ? "Weekend / holiday" : "Session Closed"}</h1>
    {expired.length > 0 && <div className={styles.authNotice} role="alert"><span>Broker re-authentication required · {expired.map(connection => connection.source).join(", ")}</span><Link className={shared.button} href="/app/broker-connections">Review broker login</Link></div>}

    <section className={styles.executiveDeck} aria-label="Closed market status">
      <div className={styles.deckHeader}><div className={styles.deckMain}><div className={styles.certLine} data-state={officialCloseMatched ? "matched" : "pending"}><span>Official EOD reference reconciliation</span><small>Snapshot {snapshot.snapshotId}</small><b><i />{officialCloseMatched ? "Bhavcopy matched" : "Bhavcopy verification pending"}</b></div><div className={styles.marketRefs}><div><strong>EOD indices</strong><span>{officialCloseMatched ? "Official closes" : "Verified values only"}</span></div>{marketReferenceTiles.map(({id,label,quote}) => <section key={id}><h2>{label}</h2><strong>{quote ? quote.value.toLocaleString("en-IN", {minimumFractionDigits:2,maximumFractionDigits:2}) : "—"}</strong><span>{quote ? `${quote.change == null ? "" : `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)}${quote.changePct == null ? "" : ` (${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%)`} · `}${quote.priceBasis.replaceAll("-", " ")} · ${formatTimestamp(quote.sourceAsOf)} IST` : "Source unavailable"}</span></section>)}</div><h2>Post-Market Surveillance &amp; Scenario Deck</h2><p>NRI Institutional Pro-Desk · Multi-broker aggregate risk, overnight exposure &amp; next-session pre-flight</p></div><div className={styles.deckActions}><button type="button" disabled>Export EOD Audit Pack</button><Link href="/app/broker-connections">Re-authenticate brokers</Link><button type="button" className={styles.dangerAction} disabled>Trigger Kill-Switch</button></div></div>
      <div className={styles.metricDeck}>
        <section><h2 className={shared.srOnly}>{weekend ? "Accumulated Performance" : "Session P&L Summary"}</h2><header><span>{reconciled ? "Realized net P&L" : "Broker-reported gross P&L"}</span><b>{reconciled ? "Reconciled" : snapshot.pnl.status === "degraded" ? "Partial coverage" : "Provisional / pending"}</b></header><div className={(pnl?.netPaise ?? pnl?.grossPaise ?? 0) < 0 ? shared.negative : shared.positive}><Money value={pnl?.netPaise ?? pnl?.grossPaise} /></div><small>Reported period: {pnl?.period ?? "Unavailable"}</small><small><Money value={pnl?.grossPaise} /> gross · {pnl?.chargesPaise == null ? "charges pending" : `${formatPaise(pnl.chargesPaise)} charges`}</small><div className={styles.metricProgress}><i style={{width:pnl ? "82%":"0%"}} /></div><details><summary>Performance evidence</summary><div className={styles.statistics}><div><span>Day win rate</span><strong>{perf?.dayWinRatePct != null ? `${perf.dayWinRatePct}%` : "—"}</strong></div><div><span>Profit factor</span><strong>—</strong></div><div><span>Sharpe</span><strong>{perf?.sharpe != null ? perf.sharpe.toFixed(2) : perf ? `${perf.sessionsRecorded}/${perf.sessionsRequiredForSharpe} sessions` : "—"}</strong></div><div><span>Max drawdown</span><strong>{perf?.maxDrawdownPaise != null ? formatPaise(perf.maxDrawdownPaise) : "—"}</strong></div></div>{weekend && <p>Weekly equity history unavailable</p>}<Source panel={snapshot.pnl} /></details></section>
        <section role="region" aria-label={weekend ? "Securities & Demat" : "Demat Holdings"}><h2 className={shared.srOnly}>{weekend ? "Securities & Demat" : "Demat Holdings"}</h2><header><span>{complete ? "Demat valuation" : "Known demat-value subtotal"}</span><b>{holdingRows.length ? `${holdingRows.length} holdings${complete ? "" : " · partial"}` : "Partial"}</b></header><div><Money value={holdingValue} /></div><small>{complete ? "Selected NRE/NRO custody accounts" : "Received accounts only; missing brokers are excluded"}</small><div className={styles.metricProgress}><i style={{width:complete ? "74%":holdingRows.length ? "38%":"0%"}} /></div><details><summary>Holdings evidence</summary><PortfolioTable rows={holdingRows} available={complete} /></details></section>
        <section><h2 className={shared.srOnly}>Margin Utilized / Free</h2><header><span>{usedMarginComplete ? "Broker-reported margin used" : "Known margin-used subtotal"}</span><b>{usedMarginPct == null ? "Partial account coverage" : `${usedMarginPct.toFixed(1)}% used`}</b></header><div><Money value={usedMargin} /></div><small>Free <Money value={availableMargin} /> · Collateral <Money value={collateral} /></small><div className={`${styles.metricProgress} ${styles.blueProgress}`}><i style={{width:`${Math.min(100,usedMarginPct ?? 0)}%`}} /></div></section>
        <section><h2 className={shared.srOnly}>{weekend ? "Execution Engines" : "Strategy Posture"}</h2><header><span>Theta accrual</span><b>Analytics required</b></header><div className={shared.muted}>Unavailable</div><small>Projected overnight decay is not supplied.</small><div className={styles.metricProgress}><i style={{width:"0%"}} /></div><p className={styles.exposure}>{activePositions.length ? `${activePositions.length} positions reported; unreported exposure is not inferred.` : "Overnight exposure unverified. Market close does not flatten positions."}</p><button className={shared.button} disabled title="Deployment command service is not connected">Arm at next open</button></section>
        <section role="region" aria-label="Next Session Pre-Flight"><h2 className={shared.srOnly}>Next Session Pre-Flight</h2><header><span>Pre-flight gateways</span><b>Action required</b></header><div className={passed === 4 ? shared.positive : shared.warning}>{passed} / 4 Ready</div><small>Revalidate before <span>{session?.nextSession ?? "the next session"}</span>.</small><div className={`${styles.metricProgress} ${styles.amberProgress}`}><i style={{width:`${passed/4*100}%`}} /></div><details><summary>Readiness evidence</summary><div className={styles.checks}>{checks.map(({label,check}) => <div key={label}><span>{label}<small>{check.reason}</small></span><strong className={check.status === "passed" ? shared.positive : check.status === "failed" ? shared.negative : shared.warning}>{STATUS[check.status]}</strong></div>)}</div></details></section>
      </div>
    </section>

    <nav className={styles.actNav} aria-label="Post-market workflow" role="tablist">
      <button type="button" role="tab" aria-selected={act === "stress"} className={act === "stress" ? styles.activeAct : ""} onClick={() => setAct("stress")}>◉ Act 2: Stress &amp; Shield <span>{activePositions.length} carried legs</span></button>
      <button type="button" role="tab" aria-selected={act === "settle"} className={act === "settle" ? styles.activeAct : ""} onClick={() => setAct("settle")}>▤ Act 1: Settle &amp; Reconcile <span>{reconciled ? "Matched" : "Pending"}</span></button>
      <button type="button" role="tab" aria-selected={act === "tomorrow"} className={act === "tomorrow" ? styles.activeAct : ""} onClick={() => setAct("tomorrow")}>☀ Act 3: Tomorrow&apos;s Edge <span>{passed === 4 ? "Ready" : `${4-passed} alerts`}</span></button>
      <small>Display mode: Selected act</small>
    </nav>

    {act === "stress" && <div className={styles.actPanel} role="tabpanel" aria-label="Stress & Shield">
    <Card className={styles.stressHud} title="Monte Carlo Overnight Gap & Volatility Stress HUD" badge="Analytics not connected">
      <div id="overnight-stress" className={styles.stressTop}><div><span>NSE NIFTY 50 settlement: <strong>{nifty ? nifty.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "Unavailable"}</strong></span><span>GIFT NIFTY (NSE IX): <strong>Unavailable</strong></span><p>No verified scenario engine, portfolio Greeks, or GIFT NIFTY source is connected.</p><Source panel={snapshot.prices} /></div><div className={styles.presetButtons}><button disabled>Shock −2.5%</button><button disabled>Gap Down −1.0%</button><button disabled>Base Flat</button><button disabled>Gap Up +1.0%</button><button disabled>Rally +2.5%</button></div></div>
      <div className={styles.stressRange}><div><span>−300 pts Extreme Bear</span><strong>Assumed open: unavailable</strong><span>+300 pts Extreme Bull</span></div><input type="range" min="-300" max="300" value="0" disabled readOnly aria-label="Overnight gap scenario"/><footer><span>−300 pt</span><span>−150 pt</span><b>0 Flat Baseline</b><span>+150 pt</span><span>+300 pt</span></footer></div>
      <div className={styles.stressMetrics}><div><span>{dayMtmComplete ? "Day MTM · open positions" : "Known day MTM subtotal"}</span><strong><Money value={dayMtm} /></strong><small>Previous close → last price · {reportedDayMtm.length}/{activePositions.length} positions</small></div><div><span>{openPnlComplete ? "Open-position P&L" : "Known open-P&L subtotal"}</span><strong><Money value={openPositionPnl} /></strong><small>Broker-reported/estimated · {reportedOpenPnl.length}/{activePositions.length} positions · before charges</small></div><div><span>{usedMarginComplete ? "Broker-reported margin used" : "Known margin-used subtotal"}</span><strong><Money value={usedMargin} /></strong><small>Account value; partial coverage is not a portfolio total</small></div><div><span>Aggregate Net Delta (Δ)</span><strong>Unavailable</strong><small>Verified Greeks engine required</small></div></div>
    </Card>

    <div className={styles.matrixWorkspace}>
    <Card className={styles.positionCard} title="Carried-Forward Overnight Contract Matrix" badge={`${activePositions.length} active positions`}>
      <div className={styles.positionTable} role="region" aria-label="Carried-forward positions"><table><thead><tr><th>Contract spec</th><th>Route / entity</th><th>Qty</th><th>Avg entry</th><th>EOD close</th><th>Unrealized MTM</th><th>Status</th></tr></thead><tbody>
        {activePositions.slice(0, 8).map(position => <tr key={position.id}><td><i data-side={(position.quantity ?? 0) < 0 ? "short" : "long"} />{position.symbol}<small>{position.exchange} · {position.product}</small></td><td>{providerLabel(position.provider)}<small>{position.account}</small></td><td className={(position.quantity ?? 0) < 0 ? shared.negative : shared.positive}>{(position.quantity ?? 0) < 0 ? "SHORT" : "LONG"} · {position.quantity == null ? "—" : Math.abs(position.quantity)} units</td><td>{position.average == null ? "—" : formatPaise(Math.round(position.average * 100))}</td><td>{position.ltp == null ? "—" : formatPaise(Math.round(position.ltp * 100))}</td><td><Money value={effectivePositionPnl(position)} /><small>Day MTM <Money value={position.mtmPaise} /></small></td><td><span className={styles.safeStatus}>{position.fresh ? "Live tick" : "Reported"}</span></td></tr>)}
        {!activePositions.length && <tr><td colSpan={7}>No open positions reported. This does not prove zero exposure when account coverage is incomplete.</td></tr>}
      </tbody></table></div>
      <div className={styles.positionFooter}><span>Positions remain separated by broker and account.</span><Link href="/app/live-positions">Inspect all positions →</Link></div>
    </Card>
    <Card className={styles.pathCard} title="Intraday P&L Path" badge="Time-series unavailable"><p className={styles.sectionHint}>Normalized session trajectory requires stored intraday P&amp;L observations.</p><div className={styles.pathChart}><svg viewBox="0 0 340 120" role="img" aria-label="Intraday P&L history unavailable"><line x1="0" x2="340" y1="20" y2="20"/><line x1="0" x2="340" y1="60" y2="60"/><line x1="0" x2="340" y1="100" y2="100"/><text x="170" y="64" textAnchor="middle">No verified time series</text></svg><footer><span>09:15 Open</span><span>11:30</span><span>13:42</span><span>15:30 EOD</span></footer></div><div className={styles.greekStrip}><div><span>Delta (Δ)</span><strong>—</strong></div><div><span>Theta (θ)</span><strong>—</strong></div><div><span>Vega (ν)</span><strong>—</strong></div></div></Card>
    </div>
    </div>}

    {act === "settle" && <div className={styles.actPanel} role="tabpanel" aria-label="Settle & Reconcile">
      <div className={styles.settlementGrid}>
        <Card title="Realized P&L Ledger Audit" badge={reconciled ? "Reconciled" : "Pending"}>
          <p className={styles.sectionHint}>Broker-reported totals are shown without inventing a statutory charge decomposition.</p>
          <dl className={styles.ledger}><div><dt>Gross reported P&amp;L</dt><dd><Money value={pnl?.grossPaise} /></dd></div><div><dt>Broker charges</dt><dd><Money value={pnl?.chargesPaise} /></dd></div><div><dt>Net realized payoff</dt><dd><Money value={pnl?.netPaise} /></dd></div></dl>
          <div className={styles.auditFooter}><span>EOD reconciliation status</span><strong>{pnl?.reconciliationStatus ?? "Unknown"}</strong></div><Source panel={snapshot.pnl} />
        </Card>
        <Card title="NRI Broker Settlements" badge={`${snapshot.connections.data?.length ?? 0} gateways reported`}>
          <p className={styles.sectionHint}>Account coverage and connection state by broker; cash settlement credits are not supplied.</p>
          <div className={styles.settlementList}>{providerRows.map(row => <div key={row.provider}><span><strong>{providerLabel(row.provider)}</strong><small>{row.holdings} holdings · {row.positions} open positions</small></span><b className={row.connection?.status === "connected" ? shared.positive : shared.warning}>{row.connection?.status?.replaceAll("_", " ") ?? "Not reported"}</b></div>)}</div>
          <Link className={shared.configure} href="/app/broker-connections">Manage gateway authentication →</Link>
        </Card>
        <Card title="FEMA & RBI PIS Compliance" badge="Not verified">
          <p className={styles.sectionHint}>No statutory-compliance or remittance-certification source is connected.</p>
          <div className={styles.complianceList}><div><span>RBI individual NRI equity cap</span><strong>Unavailable</strong></div><div><span>Form 15CA / 15CB clearance</span><strong>Unavailable</strong></div><div><span>Designated PIS bank node</span><strong>Unavailable</strong></div><div><span>NRO capital-gains withholding</span><strong>Unavailable</strong></div></div>
          <p className={styles.caption}>This screen does not establish FEMA, RBI, tax, or PIS compliance.</p>
        </Card>
      </div>
      <Card title="Demat Long Cash Holdings & Pledged Collateral Haircut" badge={complete ? `${Math.min(3, holdingRows.length)} of ${holdingRows.length} shown` : "Partial coverage"}><PortfolioTable rows={holdingRows.slice(0, 3)} available={complete} /><Link className={shared.configure} href="/app/cash-holdings">View detailed cash holdings →</Link></Card>
    </div>}

    {act === "tomorrow" && <div className={styles.actPanel} role="tabpanel" aria-label="Tomorrow's Edge">
      <div className={styles.tomorrowGrid}>
        <Card title="Participant Flow Matrix (EOD)" badge={snapshot.eodIntelligence?.status === "available" ? "Official NSE reports" : snapshot.eodIntelligence?.status === "degraded" ? "Partial NSE coverage" : "Source unavailable"}><p className={styles.sectionHint}>Official NSE cash activity ({intelligence?.cashActivityDate ?? "unavailable"}) and equity-derivatives participant OI ({intelligence?.participantOiDate ?? "unavailable"}).</p><div className={styles.flowRows}><div><span>FII / FPI cash net</span><strong className={(fiiCash?.netCrore ?? 0) < 0 ? shared.negative : shared.positive}>{crore(fiiCash?.netCrore)}</strong></div><div><span>DII cash net</span><strong className={(diiCash?.netCrore ?? 0) < 0 ? shared.negative : shared.positive}>{crore(diiCash?.netCrore)}</strong></div><div><span>FII index futures net</span><strong className={(indexNet(fiiOi) ?? 0) < 0 ? shared.negative : shared.positive}>{indexNet(fiiOi)?.toLocaleString("en-IN") ?? "Unavailable"} contracts</strong></div><div><span>DII index futures net</span><strong className={(indexNet(diiOi) ?? 0) < 0 ? shared.negative : shared.positive}>{indexNet(diiOi)?.toLocaleString("en-IN") ?? "Unavailable"} contracts</strong></div></div>{snapshot.eodIntelligence && <Source panel={snapshot.eodIntelligence} />}</Card>
        <Card title="EOD Sector Index Performance" badge={intelligence?.sectorPerformance ? `NSE · ${intelligence.reportDate}` : "Source unavailable"}><p className={styles.sectionHint}>Official index change, not estimated capital inflow.</p><div className={styles.flowRows}>{(intelligence?.sectorPerformance ?? ["Banking & Finance","Technology & IT","Auto & EV","Consumer Goods"].map(label => ({label,close:null,change:null,changePct:null}))).map(row => <div key={row.label}><span>{row.label}<small>{row.close == null ? "Official close unavailable" : `Close ${row.close.toLocaleString("en-IN", {maximumFractionDigits:2})}`}</small></span><strong className={(row.changePct ?? 0) < 0 ? shared.negative : shared.positive}>{row.change == null || row.changePct == null ? "Unavailable" : `${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)} (${row.changePct >= 0 ? "+" : ""}${row.changePct.toFixed(2)}%)`}</strong></div>)}</div></Card>
        <Card title="Tomorrow Pre-Flight Checklist" badge={`${passed} of 4 ready`}><p className={styles.sectionHint}>Revalidate before {session?.nextSession ?? "the next session"}.</p><div className={styles.preflightList}>{checks.map(({label,check}) => <div key={label}><span><strong>{label}</strong><small>{check.reason}</small></span><b className={check.status === "passed" ? shared.positive : check.status === "failed" ? shared.negative : shared.warning}>{STATUS[check.status]}</b></div>)}</div><button className={shared.button} disabled>Pre-flight locked</button></Card>
      </div>
      <div className={styles.embeddedWire}><AlphaWire enabled embedded initiallyCollapsed={false} /></div>
    </div>}

    <footer className={shared.terminalFooter}><span>{snapshot.scope.exchange} / {snapshot.scope.segment} · Calendar: {snapshot.calendarVersion}</span><span>Account snapshot: {formatTimestamp(snapshot.generatedAt)} IST</span></footer>
  </div>;
}
