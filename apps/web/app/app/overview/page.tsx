"use client";

import styles from "./overview.module.css";
import { TemporaryViewSelector } from "./temporary-view-selector";
import { useOverviewSnapshot } from "./use-overview-snapshot";
import { formatTimestamp } from "./format";
import { useShellOverview } from "@/app/components/shell/overview-context";

/**
 * Overview screen (canonical route /app/overview) -- the production route.
 * Temporary layout previews use the same real account data. The real snapshot
 * still drives the shell and polling; previews never change server state.
 *
 * Fetches the real snapshot from GET /v1/overview. Most panels will
 * honestly read "Unavailable" until the broker adapter (build order step 4)
 * exists -- that is the accurate current state of the system, not a bug.
 *
 * A refresh failure after data is already showing never blanks the screen
 * back to a bare error notice -- the last valid snapshot (still real data)
 * stays visible with a stale/disconnected warning above it, timestamped, so
 * the trader can tell "this is old" from "this is wrong" at a glance.
 */
export default function OverviewPage() {
  const { snapshot, loading, error, stale } = useOverviewSnapshot();
  useShellOverview(snapshot, stale);

  if (error && !snapshot) {
    return (
      <main className={styles.page}>
        <div className={styles.mockNotice} role="alert" aria-label="Backend error notice">
          <strong>Could not load the Overview snapshot.</strong> {error}
        </div>
      </main>
    );
  }

  if (loading || !snapshot) {
    return (
      <main className={styles.page}>
        <p>Loading Overview&hellip;</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      {stale && (
        <div className={styles.mockNotice} role="status" aria-label="Stale data notice">
          <strong>Disconnected -- showing the last data received.</strong> Last updated{" "}
          {formatTimestamp(snapshot.generatedAt)}. {error}
        </div>
      )}
      <TemporaryViewSelector snapshot={snapshot} />
    </main>
  );
}
