"use client";

import styles from "./overview.module.css";
import { OverviewScreen } from "./overview-screen";
import { useOverviewSnapshot } from "./use-overview-snapshot";
import { formatTimestamp } from "./format";

/** Operational overview: actual session only, retaining the last snapshot on refresh failure. */
export default function OverviewPage() {
  const { snapshot, loading, error, stale } = useOverviewSnapshot();

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
      <OverviewScreen snapshot={snapshot} stale={stale} />
    </main>
  );
}
