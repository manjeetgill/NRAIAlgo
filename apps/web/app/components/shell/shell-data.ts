export interface TickerItem {
  label: string;
  value: string;
  changePercent: string;
  direction: "up" | "down";
}

/**
 * Compact header-ticker fixture. Deliberately separate from
 * MarketOpenSection's own KPI card data even though the values are
 * similar -- this is the persistent header chrome (shown regardless of
 * which screen or market state is active), while the KPI cards are
 * Market-Open-specific content; once a real quote feed exists, each
 * would subscribe to it independently rather than one depending on
 * the other's local fixture.
 */
export const MOCK_INDEX_TICKER: readonly TickerItem[] = [
  { label: "NIFTY 50", value: "25,124.80", changePercent: "+0.45%", direction: "up" },
  { label: "BANKNIFTY", value: "51,842.15", changePercent: "+0.62%", direction: "up" },
  { label: "INDIA VIX", value: "13.82", changePercent: "-2.1%", direction: "down" },
];
