import type { OverviewSnapshot } from "@nraialgo/contracts";

export function accountIsStale(base: OverviewSnapshot, provider: "zerodha" | "kotak", accountId: string, now: number) {
  const evidence = base.brokerReconciliation?.[provider];
  if (base.brokerReconciliation && (!evidence || evidence.accountId !== accountId || evidence.status !== "confirmed")) return true;
  const asOf = Date.parse(evidence?.asOf ?? base.generatedAt);
  return !Number.isFinite(asOf) || now - asOf >= 30_000;
}

export function degradeAccountPanels(snapshot: OverviewSnapshot, provider: string) {
  const reason = `${provider} account reconciliation pending or stale; showing last confirmed account values`;
  for (const key of ["pnl", "holdings", "positions", "brokerOrders"] as const) {
    const panel = snapshot[key];
    if (panel?.data) {
      panel.status = "degraded";
      // Retain partial-provider failures rather than overwrite their provenance.
      panel.reason = panel.reason ? `${panel.reason}; ${reason}` : reason;
    }
  }
}
