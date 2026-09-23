export interface NavItem {
  label: string;
  href: string;
  /** Material Symbols Outlined icon name. */
  icon: string;
  /** Whether this screen's route actually exists yet. An unbuilt item
   * renders as an inert, visibly "not built" placeholder instead of a
   * real link -- clicking a nav item should never 404. */
  built: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Matches the approved Institutional Pro design system's grouping and
 * labels (Research Core / Options Desk / Execution & Capital /
 * Institutional Setup) -- a third variant, superseding both the
 * written spec's grouping and the earlier PDF mockup's. Algo Terminal
 * and Broker Gateways are real routes; every other item is a
 * placeholder until its own commit builds it.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: "Research Core",
    items: [
      { label: "Algo Terminal", href: "/app/overview", icon: "terminal", built: true },
      { label: "Strategy Matrix", href: "/app/strategy-matrix", icon: "schema", built: false },
      { label: "Backtests", href: "/app/backtest-studio", icon: "history_edu", built: false },
      { label: "Algo Lab", href: "/app/algo-lab", icon: "science", built: false },
    ],
  },
  {
    label: "Options Desk",
    items: [
      { label: "Option Chain", href: "/app/option-chain", icon: "table_chart", built: false },
      { label: "Spread Builder", href: "/app/spread-builder", icon: "multiline_chart", built: false },
    ],
  },
  {
    label: "Execution & Capital",
    items: [
      { label: "Orders & Trades", href: "/app/orders-trades", icon: "receipt_long", built: false },
      { label: "Live Positions", href: "/app/live-positions", icon: "candlestick_chart", built: false },
      { label: "Portfolio & PIS", href: "/app/portfolio", icon: "account_balance_wallet", built: false },
    ],
  },
  {
    label: "Institutional Setup",
    items: [
      { label: "Broker Gateways", href: "/app/broker-connections", icon: "hub", built: true },
      { label: "Account & Security", href: "/app/account-security", icon: "shield", built: false },
      { label: "Audit Log", href: "/app/audit-log", icon: "list_alt", built: false },
    ],
  },
];
