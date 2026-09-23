import type { OverviewSnapshot, Panel } from "@nraialgo/contracts";

export type BrokerView = "all" | "zerodha" | "kotak" | "icici";
export const BROKER_LABELS = { all: "All brokers · Consolidated", zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" };

export function selectedProviders(snapshot: OverviewSnapshot | null, broker: string): string[] {
  return broker === "all" ? snapshot?.configuredProviders ?? ["zerodha", "kotak", "icici"] : [broker];
}

export function hasCoreCoverage(snapshot: OverviewSnapshot | null, broker: string, section: "holdings" | "positions"): boolean {
  if (!selectedProviders(snapshot, broker).length) return false;
  const providers = selectedProviders(snapshot, broker).filter(provider => provider !== "icici");
  if (!providers.length) return true;
  if (!snapshot) return false;
  return providers.every(provider => {
    const evidence = snapshot.brokerReconciliation?.[provider as "zerodha" | "kotak"];
    const panel = snapshot[section];
    return evidence?.status === "confirmed" && panel?.data != null && !panel.reason?.includes("freshness expired");
  });
}

export function brokerViewLabels(snapshot: OverviewSnapshot): Record<BrokerView, string> {
  const sources = snapshot.connections.data?.filter(item => (item.status === "connected" || item.status === "partially_connected")).map(item => item.source.toLowerCase()) ?? [];
  const connected = (["zerodha", "kotak", "icici"] as const).filter(provider => sources.some(source => source.includes(provider)) || (provider !== "icici" && snapshot.brokerReconciliation?.[provider]?.status === "confirmed"));
  const expected = snapshot.configuredProviders ?? ["zerodha", "kotak", "icici"];
  const all = expected.length > 0 && expected.every(provider => connected.includes(provider))
    ? BROKER_LABELS.all
    : connected.length === 1
      ? `${BROKER_LABELS[connected[0]!]} only · Partial coverage`
      : `${connected.length} connected brokers · Partial coverage`;
  return { ...BROKER_LABELS, all: all === BROKER_LABELS.all ? all : BROKER_LABELS.all + " *" };
}

function unavailable<T>(panel: Panel<T>, reason: string): Panel<T> {
  return { status: "unavailable", source: panel.source, asOf: null, version: panel.version, data: null, reason };
}

/** Presentation filtering only. Never changes the server scope or execution route.
 * Unattributed aggregate panels cannot safely be relabelled as one broker's data. */
export function brokerView(snapshot: OverviewSnapshot, broker: BrokerView): OverviewSnapshot {
  if (broker === "all") return snapshot;
  const reason = `${BROKER_LABELS[broker]}: broker-specific data not supplied`;
  const result = { ...snapshot };
  const balance = snapshot.holdings.data?.brokerBalances?.filter(row => row.provider === broker);
  const evidence = broker === "icici" ? undefined : snapshot.brokerReconciliation?.[broker];
  if (snapshot.holdings.data && balance?.length) {
    result.holdings = { ...snapshot.holdings, data: {
      ...snapshot.holdings.data,
      holdings: snapshot.holdings.data.holdings.filter(row => row.provider === broker),
      brokerBalances: balance,
      availableMarginPaise: balance.reduce((sum, row) => sum + row.availableMarginPaise, 0),
      usedMarginPaise: balance.reduce((sum, row) => sum + row.usedMarginPaise, 0),
      collateralPaise: balance.reduce((sum, row) => sum + row.collateralPaise, 0),
    } };
  } else result.holdings = unavailable(snapshot.holdings, reason);
  // Only a single-provider P&L source can establish attribution. Never derive
  // session P&L from open positions (closed positions also contribute).
  const attributedPnl = broker === "icici" ? undefined : snapshot.brokerPnl?.[broker];
  if (attributedPnl) result.pnl = attributedPnl;
  else if (snapshot.pnl.source.replace(/\+(?:kotak-)?tick-estimate/g, "") !== broker) result.pnl = unavailable(snapshot.pnl, `${reason}; All brokers shows any available attributed P&L, not a guaranteed complete total`);
  if (snapshot.positions?.data) {
    const rows = snapshot.positions.data.filter(row => row.provider === broker && row.quantity !== 0);
    result.positions = rows.length || (evidence?.status === "confirmed" && snapshot.positions.source.split("+").includes(`${broker}-positions`))
      ? { ...snapshot.positions, data: rows }
      : unavailable(snapshot.positions, reason);
  }
  if (snapshot.brokerOrders && broker !== "zerodha") result.brokerOrders = unavailable(snapshot.brokerOrders, broker === "icici" ? "ICICI orders are shown in the ICICI account section" : "Kotak order data is not supplied by the current API");
  result.deployment = unavailable(snapshot.deployment, "Broker attribution for execution engines is not supplied; see All brokers for shared deployment data");
  result.activity = unavailable(snapshot.activity, "Broker attribution for activity is not supplied; see All brokers for shared activity");
  if (snapshot.connections.data) {
    const rows = snapshot.connections.data.filter(row => row.source.toLowerCase().startsWith(`${broker} `));
    result.connections = rows.length ? { ...snapshot.connections, data: rows } : unavailable(snapshot.connections, reason);
  }
  return result;
}
