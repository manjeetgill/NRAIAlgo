import { UpdatedAt } from "./updated-at";
import Link from "next/link";
import type { ReactNode } from "react";
import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";
import { formatPaise, formatTimestamp } from "./format";
import shared from "./market-open.module.css";
import styles from "./pre-open.module.css";
import type { PortfolioRow } from "./portfolio-table";

function Card({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return <section className={shared.card} aria-label={title}><header className={shared.cardHeader}><div className={shared.cardHeading}><h2>{title}</h2></div>{badge && <span className={shared.tag}>{badge}</span>}</header>{children}</section>;
}
function Source({ panel }: { panel: Panel<unknown> }) {
  return <details className={shared.provenance}><summary>Source & refresh {panel.status !== "available" ? "*" : ""}</summary><UpdatedAt value={panel.asOf}/><p>Source: {panel.source}</p><span>{panel.reason}</span></details>;
}
const money = (value: number | null | undefined) => value == null ? "—" : formatPaise(value);
const CHECKS = { totp: "Platform MFA Sign-in", priceFeed: "Market-data Feed", brokerSessions: "Broker Gateways", riskLimits: "Risk Limit Guardrails" };
const STATUS: Record<string, string> = { passed: "Passed", failed: "Failed", unknown: "Unknown", not_applicable: "Not applicable" };

export function PreOpenScreen({ snapshot, layoutOnly = false, accountHoldings }: { snapshot: OverviewSnapshot; layoutOnly?: boolean; accountHoldings?: { rows: PortfolioRow[]; complete: boolean } }) {
  const holdings = snapshot.holdings.data;
  const holdingRows = accountHoldings?.rows ?? holdings?.holdings ?? [];
  const complete = accountHoldings?.complete ?? snapshot.holdings.status === "available";
  const holdingValue = complete && holdingRows.every(row => row.marketValuePaise != null) ? holdingRows.reduce((sum, row) => sum + row.marketValuePaise!, 0) : null;
  const deployment = snapshot.deployment.data;
  const expired = snapshot.connections.data?.some(connection => connection.status === "session_expired");
  const checks = Object.entries(CHECKS).map(([key, label]) => ({ label, check:
    key === "brokerSessions" && expired ? { status: "failed", reason: "A reported broker session has expired. Re-authentication required." }
      : snapshot.readiness.data?.checks[key as keyof typeof CHECKS] ?? { status: "unknown", reason: "No verification available" },
  }));
  const passed = checks.filter(({ check }) => check.status === "passed").length;
  return <div className={shared.terminal}>
    <h1 className={shared.srOnly}>Pre-open</h1>
    <div className={`${shared.sessionBar} ${styles.banner}`}><strong>{layoutOnly ? "PRE-OPEN LAYOUT · CURRENT ACCOUNT SNAPSHOT" : "PRE-OPEN SESSION"}</strong><span>Next calendar transition: {formatTimestamp(snapshot.session.data?.nextTransitionAt ?? null)} IST</span><span className={shared.tag}>Execution controls unavailable</span></div>

    <Card title="Mandatory Pre-Flight Guardrails" badge={`${passed} of 4 checks passed`}>
      <div className={styles.checks}>{checks.map(({ label, check }) => <div className={styles.check} key={label}><header><strong>{label}</strong><span className={check.status === "passed" ? shared.positive : check.status === "failed" ? shared.negative : shared.warning}>{STATUS[check.status]}</span></header><p>{check.reason ?? "Reported by the readiness service"}</p></div>)}</div>
      <p className={styles.note}>Passing checks does not authorize execution. Starting requires a valid deployment authorization and server-side admission.</p><Source panel={snapshot.readiness} />
    </Card>

    <div className={shared.twoColumns}>
      <Card title="Indicative Opening Equilibrium" badge="Auction data not connected">
        <div className={shared.tableScroll}><table><thead><tr>{["Index / underlying", "Reference price", "Indicative open", "Implied change", "Discovered volume", "Order bias"].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{[
          ["NSE:NIFTY50", "NIFTY 50"], ["NSE:BANKNIFTY", "BANK NIFTY"], ["NSE:FINNIFTY", "FIN NIFTY"], ["NSE:INDIAVIX", "INDIA VIX"],
        ].map(([id, label]) => {
          const quote = snapshot.prices.data?.find(item => item.instrumentId === id);
          return <tr key={id}><td><strong>{label}</strong></td><td>{quote ? quote.value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}<small>{quote ? `${quote.priceBasis}${quote.fresh ? "" : " · not fresh"}` : "Not received"}</small>{quote && <small>{formatTimestamp(quote.sourceAsOf)} IST</small>}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>;
        })}</tbody></table></div>
        <p className={styles.note}>Reference quotes are not indicative auction prices. Auction equilibrium, imbalance, volume and projected straddle analytics are unavailable in the current data contract.</p><Source panel={snapshot.prices} />
      </Card>
      <Card title="Capital & Float Audit" badge="Broker-reported snapshot">
        <div className={styles.capital}><span className={shared.label}>{complete ? "Reported holdings value" : "Total withheld — selected account data incomplete"}</span><strong>{money(holdingValue)}</strong></div>
        <div className={styles.metrics}><div><span>Available margin</span><strong className={shared.positive}>{money(holdings?.availableMarginPaise)}</strong></div><div><span>Used margin</span><strong className={shared.warning}>{money(holdings?.usedMarginPaise)}</strong></div></div>
        <dl className={shared.values}><div><dt>Collateral</dt><dd>{money(holdings?.collateralPaise)}</dd></div><div><dt>Strategy allocated capital</dt><dd>{money(snapshot.pnl.data?.baseCapital.amountPaise)}</dd></div><div><dt>Staged margin requirement</dt><dd>Unavailable</dd></div></dl>
        {holdings?.brokerBalances?.map(balance => <div className={styles.broker} key={`${balance.provider}:${balance.accountId}`}><strong>{balance.provider} · {balance.accountId}</strong><span>{money(balance.availableMarginPaise)} available</span><small>{formatTimestamp(balance.asOf)} IST</small></div>)}
        <p className={styles.note}>Balances remain account-specific; combined figures do not imply transferable buying power.</p><Source panel={snapshot.holdings} /><Source panel={snapshot.pnl} />
      </Card>
    </div>

    <Card title="Algorithmic Strategies Staging Status" badge="Server-reported deployment">
      <div className={styles.stagingActions}><span className={shared.muted}>Readiness does not arm strategies automatically.</span><button className={shared.button} disabled title="Deployment command service is not connected">Arm all engines</button></div>
      <div className={shared.tableScroll}><table><thead><tr>{["Strategy / deployment", "Trigger schedule", "Route & gateway", "Allocated margin", "Engine state", "Authorization"].map(title => <th key={title}>{title}</th>)}</tr></thead><tbody>{deployment ? <tr><td>{deployment.deploymentId ?? "No deployment assigned"}</td><td>{formatTimestamp(deployment.scheduledAt)}<small>Reported schedule · not an execution promise</small></td><td>Unavailable</td><td>—</td><td>{deployment.workerStatus}</td><td>{deployment.grantStatus}</td></tr> : <tr><td colSpan={6}>No strategy deployment data available</td></tr>}</tbody></table></div>
      <details className={shared.detail}><summary>Inspect deployment status</summary><p>Scope: {deployment?.scope ?? "Unavailable"}</p><p>Armed until: {formatTimestamp(deployment?.armedUntil ?? null)}</p><p>Last outcome: {deployment?.lastOutcome ?? "Unavailable"}</p></details><Source panel={snapshot.deployment} />
    </Card>

    <div className={styles.bottomGrid}>
      <Card title="Feed & Broker Telemetry" badge={snapshot.marketStream?.status ?? "Snapshot only"}>
        <div className={shared.telemetry}>{snapshot.connections.data?.map(connection => <div className={shared.telemetryRow} key={connection.source}><div><strong>{connection.source}</strong><small>{formatTimestamp(connection.asOf)} IST</small></div><span>{connection.status.replaceAll("_", " ")} · {connection.latencyMs == null ? "Latency unavailable" : `${connection.latencyMs} ms`}</span></div>)}</div>
        {!snapshot.connections.data?.length && <p className={styles.note}>No connection telemetry available.</p>}
        <p className={styles.note}>Last market tick: {formatTimestamp(snapshot.marketStream?.lastTickAt ?? null)} IST</p>
        <Source panel={snapshot.connections} />
        <details className={shared.detail}><summary>Recent platform activity</summary><ul className={shared.audit}>{snapshot.activity.data?.events.map(event => <li key={event.eventId}><time>{formatTimestamp(event.occurredAt)}</time><span>{event.description}</span></li>)}</ul>{!snapshot.activity.data?.events.length && <p>No events reported.</p>}<Source panel={snapshot.activity} /></details>
        <Link className={shared.configure} href="/app/broker-connections">Review broker connections →</Link>
      </Card>
      <Card title="NRI Regulatory & RBI Compliance" badge="Not verified">
        <div className={shared.telemetry}>{["Designated reporting bank", "Account / segment eligibility", "Repatriation & reporting status"].map(label => <div className={shared.telemetryRow} key={label}><span>{label}</span><strong className={shared.warning}>Unknown</strong></div>)}</div>
        <p className={styles.note}>No verified compliance data source is connected. Broker connectivity and market-data access do not establish regulatory eligibility.</p>
      </Card>
    </div>
    <footer className={shared.terminalFooter}><span>{snapshot.scope.exchange} / {snapshot.scope.segment} · Calendar: {snapshot.calendarVersion}</span><span>Snapshot: {formatTimestamp(snapshot.generatedAt)} IST</span></footer>
  </div>;
}
