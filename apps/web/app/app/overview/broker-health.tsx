import Link from "next/link";
import type { OverviewSnapshot } from "@nraialgo/contracts";
import { BROKER_LABELS } from "./broker-view";
import { UpdatedAt } from "./updated-at";
import styles from "./market-open.module.css";

export function brokerHealth(snapshot: OverviewSnapshot | null, provider: "zerodha" | "kotak" | "icici", stale = false) {
  if (!snapshot) return "Checking";
  if (snapshot.configuredProviders && !snapshot.configuredProviders.includes(provider)) return "Not configured";
  if (stale) return "Degraded";
  const connection = snapshot.connections.data?.find(item => item.source.toLowerCase().startsWith(provider) && !item.source.includes("WebSocket"));
  const verified = provider !== "icici" && snapshot.brokerReconciliation?.[provider]?.status === "confirmed";
  if (connection?.status === "partially_connected") return "Partially connected";
  if (connection?.status === "degraded") return "Degraded";
  if (verified || connection?.status === "connected") {
    if (provider === "zerodha" && snapshot.brokerOrders?.status !== "available") return "Partially connected";
    return "Connected";
  }
  // Authorization and account-read health are different facts. An active
  // broker session without a completed REST read is not disconnected; this is
  // the normal short-lived state while ICICI's client-side account request is
  // loading, and can also represent an upstream account API outage.
  return snapshot.authorizedProviders?.includes(provider) ? "Authorized · awaiting data" : "Authorization required";
}
export function BrokerHealth({ snapshot, stale = false, compact = false }: { snapshot: OverviewSnapshot | null; stale?: boolean; compact?: boolean }) {
  return <div className={`${styles.positionToolbar} ${compact ? styles.compactHealth : ""}`} aria-label="Broker health">{(["zerodha", "kotak", "icici"] as const).map(provider => <Link key={provider} href={`/app/broker-connections#${provider}`} className={styles.healthChip} data-state={brokerHealth(snapshot,provider,stale)}>{BROKER_LABELS[provider]} · {brokerHealth(snapshot,provider,stale)}</Link>)}{!compact && <UpdatedAt value={snapshot?.generatedAt} />}</div>;
}
