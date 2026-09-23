import type { OverviewSnapshot } from "@nraialgo/contracts";
import type { IciciAccount } from "./icici-model";

/** Merge verified ICICI read health into the shared overview status model.
 * Account rows stay in their existing broker-specific model because Breeze
 * bank balance is not interchangeable with Zerodha/Kotak trading margin. */
export function withIciciOverviewStatus(snapshot: OverviewSnapshot, account: IciciAccount | null, stale = false, live?: "connecting" | "streaming" | "reconnecting" | "unavailable"): OverviewSnapshot {
  if (!account) return snapshot;
  const next = structuredClone(snapshot);
  next.authorizedProviders = [...new Set([...(next.authorizedProviders ?? []), "icici" as const])];
  const coreHealthy = !stale && ["portfolioholdings", "portfoliopositions", "funds"].every(section => account.sections[section]?.status === "available");
  // Connection health represents the authenticated account path required by
  // the dashboards. Optional order-history degradation stays visible in its
  // own section and must not make a healthy portfolio connection look partial.
  const connection = { source: "ICICI account REST", status: coreHealthy ? "connected" as const : "degraded" as const, latencyMs: null, asOf: account.asOf };
  next.connections = {
    status: "available",
    source: next.connections.data?.length ? `${next.connections.source}+icici-account` : "icici-account",
    asOf: account.asOf,
    version: Math.max(1, next.connections.version),
    reason: null,
    data: [...(next.connections.data ?? []).filter(item => !item.source.toLowerCase().includes("icici")), connection,
      ...(live ? [{ source: `ICICI market WebSocket (${live})`, status: live === "streaming" ? "connected" as const : "session_ended" as const, latencyMs: null, asOf: account.asOf }] : [])],
  };
  if (coreHealthy && next.readiness.data?.checks.brokerSessions.status === "unknown" && next.configuredProviders?.includes("icici") && next.configuredProviders.every(provider => provider === "icici" || next.connections.data?.some(item => item.status === "connected" && item.source.toLowerCase().startsWith(`${provider} `)))) {
    next.readiness.data.checks.brokerSessions = { status: "passed", reason: null };
  }
  if (coreHealthy && next.pnl.reason === "NO_AUTHORIZED_BROKER_SESSION") {
    next.pnl.reason = "ICICI session verified; a comparable session P&L total is not supplied by the connected Breeze portfolio endpoints.";
  }
  if (coreHealthy && next.holdings.reason === "NO_AUTHORIZED_BROKER_SESSION") {
    next.holdings.reason = "Zerodha and Kotak are not connected; ICICI holdings are displayed from the verified Breeze account snapshot.";
  }
  return next;
}
