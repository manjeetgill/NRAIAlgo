"use client";

import { useState, useMemo } from "react";
import { FilterDrawer } from "../overview/filter-drawer";
import { BrokerHealth } from "../overview/broker-health";
import { UpdatedAt } from "../overview/updated-at";
import { withIciciOverviewStatus } from "../overview/icici-overview-status";
import { useOverviewSnapshot } from "../overview/use-overview-snapshot";
import { useShellOverview } from "@/app/components/shell/overview-context";
import { PortfolioTable } from "../overview/portfolio-table";
import { useIciciAccount, iciciHoldings } from "../overview/use-icici-account";
import { BROKER_LABELS, selectedProviders, hasCoreCoverage } from "../overview/broker-view";
import styles from "../overview/market-open.module.css";
import pageStyles from "../overview/overview.module.css";

export default function CashHoldingsPage() {
  const { snapshot, error, stale, refresh } = useOverviewSnapshot();

  const [broker, setBroker] = useState("all");
  const [search, setSearch] = useState("");
  const [pledge, setPledge] = useState("all");
  const iciciData = useIciciAccount();
  const shared = useMemo(() => snapshot ? withIciciOverviewStatus(snapshot,iciciData.account,iciciData.stale) : null,[snapshot,iciciData.account,iciciData.stale]);
  useShellOverview(shared, stale);
  const waitingForIcici = !!snapshot?.configuredProviders?.includes("icici") && (broker === "all" || broker === "icici") && iciciData.loading && !iciciData.account;
  if ((!shared && !iciciData.account) || waitingForIcici) return <main className={pageStyles.page}><h1>Cash Holdings</h1><BrokerHealth snapshot={shared}/><p role="status">{error ?? (waitingForIcici ? "Loading ICICI account snapshot…" : "Loading latest broker snapshot…")}</p></main>;
  const icici = iciciHoldings(iciciData.account);
  const iciciReady = !iciciData.stale && iciciData.account?.sections.portfolioholdings?.status === "available";

  const rows = [...(snapshot?.holdings.data?.holdings ?? []), ...icici].filter(row =>
    (broker === "all" || row.provider === broker) &&
    `${row.symbol} ${row.isin ?? ""} ${row.accountId} ${row.provider}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (pledge === "all" || (pledge === "pledged" ? (row.pledgedQuantity ?? 0) > 0 : pledge === "free" ? row.pledgedQuantity === 0 : row.pledgedQuantity == null))
  );
  const providers = selectedProviders(snapshot, broker);
  const complete = providers.length > 0 && !stale && hasCoreCoverage(snapshot, broker, "holdings") && (!providers.includes("icici") || iciciReady);
  return <main className={pageStyles.page}>
    <h1>Cash Holdings</h1><BrokerHealth snapshot={shared} stale={stale}/>
    <p>Cash-equity portfolio · Read-only · Holdings remain separate by broker and account.</p>
    <section className={styles.card}>
      <FilterDrawer><div className={styles.positionToolbar}>
        <label>Broker <select value={broker} onChange={event => setBroker(event.target.value)}>{Object.entries(BROKER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Search holdings <input type="search" placeholder="Instrument, ISIN or account…" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label>Pledge status <select value={pledge} onChange={event => setPledge(event.target.value)}><option value="all">All holdings</option><option value="pledged">Pledged / partly pledged</option><option value="free">Not pledged</option><option value="unknown">Unknown</option></select></label>
        <button className={styles.button} onClick={() => { if (broker !== "icici") refresh(); if (broker === "all" || broker === "icici") iciciData.refresh(); }}>Refresh selected accounts</button>
      </div></FilterDrawer>
      <details><summary>Coverage & refresh details *</summary><p>Selected scope: {providers.join(" + ") || "No configured brokers"}. Last-confirmed complete values carry * when current coverage is incomplete.</p><UpdatedAt value={snapshot?.holdings.asOf}/><p>{snapshot?.holdings.reason} {error}</p><p>{iciciData.status}</p></details>
      <PortfolioTable scope={`${snapshot?.scope.workspaceId ?? "current"}:${broker}:${search}:${pledge}`} rows={rows} available={complete} detailed showBroker={broker === "all"} />
    </section>
  </main>;
}
