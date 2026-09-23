"use client";

import { useState, useMemo } from "react";
import type { MarketState, OverviewSnapshot } from "@nraialgo/contracts";
import { BrokerFilter } from "./broker-filter";
import { PanelCard } from "./panel-card";
import { formatPaise, formatTimestamp } from "./format";
import { STATE_LABEL } from "./session-labels";
import styles from "./overview.module.css";
import { MarketOpenView } from "./market-open-screen";
import { MarketClosedScreen } from "./market-closed-screen";
import { PreOpenScreen } from "./pre-open-screen";
import { AccountDetails } from "./account-details";
import { brokerView, selectedProviders, hasCoreCoverage, type BrokerView } from "./broker-view";
import { useIciciAccount, iciciHoldings } from "./use-icici-account";
import { withIciciOverviewStatus } from "./icici-overview-status";
import { useShellOverview } from "@/app/components/shell/overview-context";

function NonLiveDashboard({ snapshot, layout, layoutOnly = false, icici }: { snapshot: OverviewSnapshot; layout: "pre-open" | "after-close" | "weekend-holiday"; layoutOnly?: boolean; icici: ReturnType<typeof useIciciAccount> }) {
  const [selectedBroker, setSelectedBroker] = useState<BrokerView>("all");
  const scoped = { ...brokerView(snapshot, selectedBroker) };
  const includeIcici = selectedProviders(snapshot, selectedBroker).includes("icici");
  if (includeIcici) scoped.pnl = { ...scoped.pnl, status: "unavailable", data: null, reason: scoped.pnl.reason ?? "Consolidated session P&L withheld: a comparable ICICI session total is not supplied." };
  const accountHoldings = {
    rows: [...(scoped.holdings.data?.holdings ?? []), ...(includeIcici ? iciciHoldings(icici.account) : [])],
    complete: hasCoreCoverage(snapshot, selectedBroker, "holdings") && (!includeIcici || (!icici.stale && icici.account?.sections.portfolioholdings?.status === "available")),
  };
  return <>
    <BrokerFilter value={selectedBroker} onChange={setSelectedBroker} />
    {layout === "pre-open" ? <PreOpenScreen snapshot={scoped} layoutOnly={layoutOnly} accountHoldings={accountHoldings} /> : <MarketClosedScreen snapshot={scoped} {...(layoutOnly ? { layout } : {})} accountHoldings={accountHoldings} />}
    <AccountDetails iciciStale={icici.stale} snapshot={scoped} broker={selectedBroker} account={icici.account} status={icici.status} />
  </>;
}

export interface OverviewScreenProps {
  snapshot: OverviewSnapshot;
  layout?: MarketState | undefined;
}

/**
 * Pure presentational Overview content, driven entirely by a real
 * OverviewSnapshot -- no hardcoded per-state numbers baked into JSX. Every
 * panel renders its own real data when available, or an honest
 * "Unavailable: <reason>" otherwise (see PanelCard). The exact same
 * component renders identically whether it's fed by the production page's
 * live fetch or the dev playground's labeled fixtures.
 */
export function OverviewScreen({ snapshot: baseSnapshot, layout, stale = false }: OverviewScreenProps & { stale?: boolean }) {
  const icici = useIciciAccount();
  const snapshot = useMemo(() => withIciciOverviewStatus(baseSnapshot, icici.account, icici.stale, icici.live),[baseSnapshot,icici.account,icici.stale,icici.live]);
  useShellOverview(snapshot, stale);
  const session = snapshot.session;
  // Select presentation without modifying the authoritative session or data.
  if (layout === "pre-open") return <NonLiveDashboard snapshot={snapshot} layout="pre-open" layoutOnly icici={icici} />;
  if (layout === "market-open") return <MarketOpenView snapshot={snapshot} layoutOnly icici={icici} />;
  if (layout === "after-close" || layout === "weekend-holiday") return <NonLiveDashboard snapshot={snapshot} layout={layout} layoutOnly icici={icici} />;
  if (session.data?.state === "pre-open" && session.data.calendarValid) {
    return <NonLiveDashboard snapshot={snapshot} layout="pre-open" icici={icici} />;
  }

  if (session.data?.state === "market-open" && session.data.calendarValid) {
    return <MarketOpenView snapshot={snapshot} icici={icici} />;
  }
  if (session.data?.calendarValid && (session.data.state === "after-close" || session.data.state === "weekend-holiday")) {
    return <NonLiveDashboard snapshot={snapshot} layout={session.data.state} icici={icici} />;
  }

  return (
    <>
      <h1>Overview</h1>

      <section className={styles.stateSection} aria-label="Market state">
        {session.status === "available" ? (
          <>
            <h2>{STATE_LABEL[session.data.state]}</h2>
            <p className={styles.countdown}>
              {session.data.nextTransitionAt
                ? `Next transition: ${formatTimestamp(session.data.nextTransitionAt)}`
                : "No upcoming transition on record"}
            </p>
            {!session.data.calendarValid && (
              <p className={styles.countdown}>
                Calendar has no entry for today -- treat this state as Unknown.
              </p>
            )}
          </>
        ) : (
          <>
            <h2>Unknown</h2>
            <p className={styles.countdown}>{session.reason}</p>
          </>
        )}
      </section>

      <div className={styles.panelGrid}>
        <PanelCard
          title="Prices"
          panel={snapshot.prices}
          render={(quotes) => (
            <ul className={styles.dataList}>
              {quotes.map((quote) => (
                <li key={quote.instrumentId}>
                  <span>{quote.label}</span>
                  <span>
                    {quote.value.toLocaleString("en-IN")} ({quote.priceBasis})
                  </span>
                </li>
              ))}
            </ul>
          )}
        />

        <PanelCard
          title="P&amp;L"
          panel={snapshot.pnl}
          render={(pnl) => (
            <div>
              <p>{pnl.period}</p>
              <p>
                Gross {formatPaise(pnl.grossPaise)} &minus; Charges:{" "}
                {pnl.chargesPaise === null ? "Pending" : formatPaise(pnl.chargesPaise)} = Net:{" "}
                {pnl.netPaise === null ? "Unavailable" : formatPaise(pnl.netPaise)}
              </p>
              <p>{pnl.reconciliationStatus}</p>
            </div>
          )}
        />

        <PanelCard
          title="Holdings &amp; margin"
          panel={snapshot.holdings}
          render={(holdings) => (
            <div>
              <ul className={styles.dataList}>
                {holdings.holdings.map((holding) => (
                  <li key={`${holding.provider}:${holding.accountId}:${holding.symbol}`}>
                    <span>
                      {holding.symbol} <span className={styles.countdown}>({holding.provider})</span>
                    </span>
                    <span>{holding.quantity}</span>
                  </li>
                ))}
              </ul>
              <p>Available margin: {formatPaise(holdings.availableMarginPaise)}</p>
            </div>
          )}
        />

        <PanelCard
          title="Deployment"
          panel={snapshot.deployment}
          render={(deployment) => (
            <div>
              <p>{deployment.deploymentId ?? "No active deployment"}</p>
              <p>
                Worker: {deployment.workerStatus} &middot; Grant: {deployment.grantStatus}
              </p>
            </div>
          )}
        />

        <PanelCard
          title="Readiness"
          panel={snapshot.readiness}
          render={(readiness) => (
            <ul className={styles.dataList}>
              {Object.entries(readiness.checks).map(([name, check]) => (
                <li key={name}>
                  <span>{name}</span>
                  <span>{check.status}</span>
                </li>
              ))}
            </ul>
          )}
        />

        <PanelCard
          title="Connections"
          panel={snapshot.connections}
          render={(connections) => (
            <ul className={styles.dataList}>
              {connections.map((connection) => (
                <li key={connection.source}>
                  <span>{connection.source}</span>
                  <span>{connection.status}</span>
                </li>
              ))}
            </ul>
          )}
        />

        <PanelCard
          title="Activity"
          panel={snapshot.activity}
          render={(activity) => (
            <ul className={styles.dataList}>
              {activity.events.length === 0 ? (
                <li>No events recorded.</li>
              ) : (
                activity.events.map((event) => <li key={event.eventId}>{event.description}</li>)
              )}
            </ul>
          )}
        />
      </div>
    </>
  );
}
