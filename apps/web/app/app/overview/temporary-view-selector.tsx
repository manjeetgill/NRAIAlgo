"use client";

import { useState } from "react";
import type { MarketState, OverviewSnapshot } from "@nraialgo/contracts";
import { OverviewScreen } from "./overview-screen";
import { STATE_LABEL } from "./session-labels";
import styles from "./overview.module.css";
import shellStyles from "@/app/components/shell/shell.module.css";

const VIEWS = ["market-open", "pre-open", "after-close", "weekend-holiday"] as const;

/** Temporary presentation-only control. Never publish layout selections to the
 * shell or fetch hook; their session state and refresh cadence remain real.
 * Remove by replacing this component with OverviewScreen in page.tsx. */
export function TemporaryViewSelector({ snapshot }: { snapshot: OverviewSnapshot }) {
  const [preview, setPreview] = useState<MarketState | null>(null);
  return <>
    <div className={shellStyles.switcherBar} role="group" aria-label="Temporary dashboard view selector">
      <span className={shellStyles.switcherLabel}>Temporary view</span>
      <div className={shellStyles.switcherRow}>
        <button type="button" aria-pressed={preview === null} className={`${shellStyles.switcherButton} ${preview === null ? shellStyles.switcherButtonActive : ""}`} onClick={() => setPreview(null)}>Auto · actual session</button>
        {VIEWS.map(view => <button key={view} type="button" aria-pressed={preview === view} className={`${shellStyles.switcherButton} ${preview === view ? shellStyles.switcherButtonActive : ""}`} onClick={() => setPreview(view)}>{STATE_LABEL[view]}</button>)}
      </div>
    </div>
    {preview !== null && <div className={styles.mockNotice} role="status" aria-label="Layout preview notice"><strong>REAL ACCOUNT DATA · {STATE_LABEL[preview]} layout</strong><p>Actual server session: {STATE_LABEL[snapshot.session.data?.state ?? "unknown"]}. All views use the latest account snapshot, not historical results for the selected session. Missing data stays unavailable. Switching layouts does not change orders, workers, positions or execution permissions.</p></div>}
    <OverviewScreen snapshot={snapshot} layout={preview ?? undefined} />
  </>;
}
