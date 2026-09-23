import type { MarketState } from "@nraialgo/contracts";

/** Static display vocabulary for the state enum -- not data, never varies
 * with what the backend returns. The actual state comes from the snapshot. */
export const STATE_LABEL: Record<MarketState, string> = {
  "market-open": "Market open",
  "pre-open": "Pre-open",
  "after-close": "After close",
  "weekend-holiday": "Weekend / holiday",
  unknown: "Unknown",
};
