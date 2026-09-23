import type { ReactNode } from "react";
import type { Panel } from "@nraialgo/contracts";
import { StatusBadge, type StatusBadgeKind } from "@/app/components/status-badge/status-badge";
import { formatTimestamp } from "./format";
import styles from "./overview.module.css";

const STATUS_BADGE: Record<"available" | "degraded" | "unavailable" | "error", { kind: StatusBadgeKind; label: string }> = {
  available: { kind: "positive", label: "Available" },
  // Real data, known to be incomplete (e.g. one of several connected
  // brokers failed mid-refresh) -- distinct from both a clean success and a
  // total unavailability, so it gets its own warning-colored badge rather
  // than being folded into either.
  degraded: { kind: "warning", label: "Partial" },
  unavailable: { kind: "neutral", label: "Unavailable" },
  error: { kind: "negative", label: "Error" },
};

/**
 * Generic panel renderer: every Overview panel goes through this so
 * "unavailable" always looks the same (a clear reason, not a blank or a
 * fabricated zero) no matter which panel it is. `render` is only ever
 * called with real data, when status is "available".
 */
export function PanelCard<T>({
  title,
  panel,
  render,
}: {
  title: string;
  panel: Panel<T>;
  render: (data: T) => ReactNode;
}) {
  const badge = STATUS_BADGE[panel.status];
  return (
    <div className={styles.panelCard}>
      <div className={styles.panelHeader}>
        <h3 className={styles.panelTitle}>{title}</h3>
        <StatusBadge kind={badge.kind} label={badge.label} />
      </div>
      {panel.status === "available" || panel.status === "degraded" ? (
        <div className={styles.panelBody}>
          {panel.status === "degraded" && <p className={styles.panelReason}>{panel.reason}</p>}
          {render(panel.data)}
        </div>
      ) : (
        <p className={styles.panelReason}>{panel.reason}</p>
      )}
      <p className={styles.panelMeta}>
        Source: {panel.source} &middot; As of {formatTimestamp(panel.asOf)}
      </p>
    </div>
  );
}
