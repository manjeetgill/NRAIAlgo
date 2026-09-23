"use client";

import { useState } from "react";
import { OVERVIEW_SNAPSHOT_FIXTURES, type MarketState } from "@nraialgo/contracts";
import { OverviewScreen } from "@/app/app/overview/overview-screen";
import { STATE_LABEL } from "@/app/app/overview/session-labels";
import overviewStyles from "@/app/app/overview/overview.module.css";
import { Shell } from "@/app/components/shell/shell";
import shellStyles from "@/app/components/shell/shell.module.css";

const STATES = Object.keys(OVERVIEW_SNAPSHOT_FIXTURES) as MarketState[];

const STATE_DOT_COLOR: Record<MarketState, string> = {
  "market-open": "var(--color-success-emerald)",
  "pre-open": "var(--color-paper-amber)",
  "after-close": "var(--color-border-accent)",
  "weekend-holiday": "var(--color-state-purple)",
  unknown: "var(--color-live-crimson)",
};

/**
 * Design-review playground for every Overview market state.
 *
 * Deliberately lives outside /app/* (the canonical product-screen
 * registry) at /dev/overview-playground instead -- this is where the
 * state switcher the spec explicitly allows "for design review and
 * tests" actually lives, kept structurally separate from the real
 * production route (/app/overview, which fetches a live snapshot and has
 * no switcher).
 *
 * Renders OVERVIEW_SNAPSHOT_FIXTURES from @nraialgo/contracts -- the same
 * schema-validated fixtures the backend's own tests use -- instead of a
 * live fetch, so switching states here never depends on the API running
 * and never risks the two diverging silently.
 */
export function OverviewPlaygroundClient() {
  const [state, setState] = useState<MarketState>("market-open");
  const snapshot = OVERVIEW_SNAPSHOT_FIXTURES[state];

  return (
    <Shell
      extraHeaderBar={
        <div className={shellStyles.switcherBar}>
          <span className={shellStyles.switcherLabel} id="preview-state-label">
            Simulate state
          </span>
          <div
            className={shellStyles.switcherRow}
            role="radiogroup"
            aria-labelledby="preview-state-label"
          >
            {STATES.map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="radio"
                aria-checked={state === candidate}
                className={`${shellStyles.switcherButton} ${
                  state === candidate ? shellStyles.switcherButtonActive : ""
                }`}
                onClick={() => setState(candidate)}
              >
                <span
                  className={shellStyles.switcherDot}
                  style={{ color: STATE_DOT_COLOR[candidate] }}
                  aria-hidden="true"
                />
                {STATE_LABEL[candidate]}
              </button>
            ))}
          </div>
          <span className={shellStyles.switcherInfo}>
            <span className="material-symbols-outlined" aria-hidden="true">
              info
            </span>
            State demo switcher active
          </span>
        </div>
      }
    >
      <main className={overviewStyles.page}>
        <div className={overviewStyles.mockNotice} role="note" aria-label="Design review notice">
          <strong>Design review playground -- not the production screen.</strong>{" "}
          Switch states above to preview each one, rendered from fixed example
          data. None of this ships to production or calls the live API.
        </div>

        <OverviewScreen snapshot={snapshot} />
      </main>
    </Shell>
  );
}
