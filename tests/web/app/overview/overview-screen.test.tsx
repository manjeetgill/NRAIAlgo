import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { type OverviewSnapshot } from "@nraialgo/contracts";
import { OverviewScreen } from "../../../../frontend/nextjs/app/app/overview/overview-screen";

// This is the shared Overview contract in practice: no hook, no switcher, no
// time dependency -- just a snapshot passed straight in as a prop. Any
// future caller (the production page's live fetch, the playground's
// fixtures, a future test) renders the exact same way.
describe("OverviewScreen", () => {
  it("retains confirmed market-open P&L after a failed refresh without showing partial margin totals", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.configuredProviders = ["zerodha"];
    snapshot.pnl = { ...snapshot.pnl, status: "available", reason: null, asOf: snapshot.generatedAt, data: { ...snapshot.pnl.data!, grossPaise: 123456 } };
    const { rerender } = render(<OverviewScreen snapshot={snapshot} />);
    const card = screen.getByRole("region", { name: "Session P&L Breakdown" });
    expect(within(card).getAllByText("+₹1,234.56").length).toBeGreaterThan(0);
    rerender(<OverviewScreen snapshot={{ ...snapshot, pnl: { ...snapshot.pnl, status: "unavailable", data: null, reason: "Refresh failed" } }} />);
    expect(within(card).getAllByText("+₹1,234.56")[0]).toHaveTextContent("+₹1,234.56*");
    expect(within(card).getAllByText("+₹1,234.56")[0]).toHaveAttribute("data-tone", "positive");
    expect(screen.queryByText(/Known margin subtotal/)).not.toBeInTheDocument();
  });

  it("shows a locked Exit chip per position only on an individual broker dashboard", () => {
    const snapshot: OverviewSnapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.positions = { status: "available", source: "zerodha-positions", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ provider: "zerodha", accountId: "AB", instrumentToken: 1, exchange: "NFO", symbol: "TEST-FUT", product: "NRML", quantity: -25, multiplier: 1, averagePrice: 100, lastPrice: 98, pnlPaise: 5000, asOf: snapshot.generatedAt, fresh: true }] };
    snapshot.brokerOrders = { status: "available", source: "zerodha-order-book", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ orderId: "ORDER-123", symbol: "TEST-FUT", exchange: "NFO", product: "NRML", side: "SELL", status: "OPEN", quantity: 25, filledQuantity: 10, averagePrice: 100 }] };
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByText("-25")).toBeInTheDocument();
    expect(screen.getByText("-25")).toHaveAttribute("data-tone", "negative");
    expect(within(screen.getByRole("region", { name: "Live Open Positions" })).getByText("SELL")).toHaveAttribute("data-tone", "negative");
    expect(within(screen.getByRole("region", { name: "Live Open Positions" })).getByLabelText("Broker: Zerodha")).toHaveAttribute("data-broker", "zerodha");
    expect(screen.getByText(/Live tick/)).toBeInTheDocument();
    expect(screen.getByText("ORDER-123")).toBeInTheDocument();
    expect(screen.getByText("10 / 25")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exit" })).not.toBeInTheDocument();
    expect(screen.queryByText("Awaiting position-level data")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zerodha" }));
    expect(screen.getByText("-25")).toHaveAttribute("data-tone", "negative");
    expect(within(screen.getByRole("region", { name: "Live Open Positions" })).getByText("SELL")).toHaveAttribute("data-tone", "negative");
    expect(within(screen.getByRole("region", { name: "Live Open Positions" })).queryByLabelText("Broker: Zerodha")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit TEST-FUT" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "All Brokers" }));
    expect(screen.queryByRole("button", { name: "Exit TEST-FUT" })).not.toBeInTheDocument();
  });

  it("keeps execution commands locked even when all readiness checks pass", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);
    expect(screen.getByText("4/4 PASSED")).toBeInTheDocument();
    for (const name of ["Pause entries", "Kill switches", "Flatten positions"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Awaiting position-level data")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
    expect(screen.getByText(/Grant: granted/)).toBeInTheDocument();
  });

  it("renders the real state label from an available session panel", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["weekend-holiday"]} />);

    expect(screen.getByRole("heading", { name: "Weekend / holiday" })).toBeInTheDocument();
  });

  it("shows Unknown with the reason when the session panel itself is unavailable", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES.unknown} />);

    expect(screen.getByRole("heading", { name: "Unknown" })).toBeInTheDocument();
    // Several panels legitimately share this reason in the fixture (session,
    // prices, pnl and each readiness check all trace back to the same cause).
    expect(screen.getAllByText("CALENDAR_UNKNOWN").length).toBeGreaterThan(0);
  });

  it("renders an available panel's real data instead of a hardcoded number", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);

    expect(screen.getByText("NIFTY 50")).toBeInTheDocument();
    expect(screen.getByText("Reported / estimated position P&L · Excluding MCX")).toBeInTheDocument();
  });

  it("keeps the same market-index strip on consolidated and individual broker dashboards", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);

    for (const dashboard of ["All Brokers", "Zerodha", "Kotak", "ICICI"]) {
      fireEvent.click(screen.getByRole("button", { name: dashboard }));
      const indices = screen.getByRole("region", { name: "Market indices" });
      expect(within(indices).getByText("NIFTY 50")).toBeInTheDocument();
      expect(within(indices).getByText("BANKNIFTY")).toBeInTheDocument();
      expect(within(indices).getByText("INDIA VIX")).toBeInTheDocument();
      expect(within(indices).getAllByText("LIVE")).toHaveLength(3);
    }
  });

  it("shows an honest reason for a panel with no data source, never a fabricated value", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]} />);

    expect(screen.getByText("BASELINE_UNAVAILABLE")).toBeInTheDocument();
  });

  it("shows 'Charges: Pending'/'Net: Unavailable' instead of a fabricated ₹0 when a provider hasn't reported charges", () => {
    const fixture = OVERVIEW_SNAPSHOT_FIXTURES["market-open"];
    const snapshot = {
      ...fixture,
      configuredProviders: ["zerodha"],
      pnl: {
        ...fixture.pnl,
        data: fixture.pnl.data && { ...fixture.pnl.data, chargesPaise: null, netPaise: null },
      },
    } as OverviewSnapshot;

    render(<OverviewScreen snapshot={snapshot} />);

    expect(screen.getByText(/Charges:/)).toBeInTheDocument();
    expect(screen.getByText("Metric details *")).toBeInTheDocument();
    expect(screen.getByText(/net P&L requires reconciled charges/)).toBeInTheDocument();
  });

  it("keys each holding row by provider+account+symbol, and shows which provider it's from", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);

    fireEvent.click(screen.getByRole("button", { name: /Allocation details/ }));
    expect(screen.getByText("(zerodha)")).toBeInTheDocument();
  });

  it("renders a degraded panel's data plus its reason, not just one or the other", () => {
    const fixture = OVERVIEW_SNAPSHOT_FIXTURES["market-open"];
    const snapshot = {
      ...fixture,
      holdings: {
        ...fixture.holdings,
        status: "degraded" as const,
        reason: "Kotak: portfolio read failed; totals include only zerodha",
      },
    } as OverviewSnapshot;

    render(<OverviewScreen snapshot={snapshot} />);

    expect(screen.getAllByText(/totals include only zerodha/).length).toBeGreaterThan(0);
    expect(screen.getByText("Partial")).toBeInTheDocument();
    // The data that did succeed is still rendered, not hidden behind the warning.
    fireEvent.click(screen.getByRole("button", { name: /Allocation details/ }));
    expect(screen.getByText(/RELIANCE/, { selector: "div > span" })).toBeInTheDocument();
  });
});

describe("pre-open dashboard", () => {
  it("renders the reference layout without inventing auction prices or compliance", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]} />);
    for (const name of ["Mandatory Pre-Flight Guardrails", "Indicative Opening Equilibrium", "Capital & Float Audit", "Algorithmic Strategies Staging Status", "Feed & Broker Telemetry", "NRI Regulatory & RBI Compliance"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    const auction = within(screen.getByRole("region", { name: "Indicative Opening Equilibrium" }));
    expect(auction.getByText("25,098.60")).toBeInTheDocument();
    expect(auction.getByText("last-observed · not fresh")).toBeInTheDocument();
    expect(auction.getByText("Auction data not connected")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText("BASELINE_UNAVAILABLE")).toBeInTheDocument();
  });
  it("does not enable arming when all readiness checks pass", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]);
    snapshot.readiness.data!.checks.riskLimits = { status: "passed", reason: null };
    snapshot.readiness.data!.liveTradeEligible = true;
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByText("4 of 4 checks passed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arm all engines" })).toBeDisabled();
  });
  it("does not count an expired broker session as passed", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]);
    snapshot.connections.data![0]!.status = "session_expired";
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByText("2 of 4 checks passed")).toBeInTheDocument();
    expect(screen.getByText(/A reported broker session has expired/)).toBeInTheDocument();
  });
  it("only selects pre-open from a valid server calendar", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]);
    snapshot.session.data!.calendarValid = false;
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.queryByRole("heading", { name: "Indicative Opening Equilibrium" })).not.toBeInTheDocument();
  });
});

describe("closed market layouts", () => {
  it("renders the shared header and three distinct post-market tab states", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["after-close"]} />);
    for (const name of ["Session P&L Summary", "Demat Holdings", "Strategy Posture", "Next Session Pre-Flight", "Monte Carlo Overnight Gap & Volatility Stress HUD", "Carried-Forward Overnight Contract Matrix", "Intraday P&L Path"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole("heading", { name: "Realized P&L Ledger Audit" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Act 1: Settle & Reconcile/ }));
    expect(screen.getByRole("heading", { name: "Realized P&L Ledger Audit" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "NRI Broker Settlements" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "FEMA & RBI PIS Compliance" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Monte Carlo Overnight Gap & Volatility Stress HUD" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Act 3: Tomorrow's Edge/ }));
    expect(screen.getByRole("heading", { name: "Participant Flow Matrix (EOD)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "EOD Sector Index Performance" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Alpha Wire announcements" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arm at next open" })).toBeDisabled();
  });

  it("uses the calendar's next trading day, not a hardcoded Monday", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["weekend-holiday"]} />);
    expect(screen.getByText("2026-09-22")).toBeInTheDocument();
    expect(screen.getByText("Weekly equity history unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Reported period: Unavailable/)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(3);
  });

  it("does not call a provisional balance reconciled or unknown exposure flat", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.pnl.data!.netPaise = null;
    snapshot.pnl.data!.chargesPaise = null;
    snapshot.pnl.data!.reconciliationStatus = "provisional";
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByText("Provisional / pending")).toBeInTheDocument();
    expect(screen.getByText(/Overnight exposure unverified/)).toBeInTheDocument();
    expect(screen.queryByText("Reconciled", { exact: true })).not.toBeInTheDocument();
  });

  it("fills closed-market day MTM and open-position P&L from complete broker position data", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.configuredProviders = ["zerodha"];
    snapshot.brokerReconciliation = { zerodha: { accountId: "acct-demo", status: "confirmed", asOf: snapshot.generatedAt } };
    snapshot.positions = { status: "available", source: "zerodha-positions", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{
      provider: "zerodha", accountId: "acct-demo", instrumentToken: 1, exchange: "NFO", symbol: "NIFTY-FUT", product: "NRML",
      quantity: -25, multiplier: 1, averagePrice: 101, lastPrice: 98, previousClose: 100, pnlPaise: 8_000, mtmPaise: 5_000,
      asOf: snapshot.generatedAt, fresh: false,
    }] };
    render(<OverviewScreen snapshot={snapshot} />);
    const stress = within(screen.getByRole("region", { name: "Monte Carlo Overnight Gap & Volatility Stress HUD" }));
    expect(stress.getByText("₹50.00")).toBeInTheDocument();
    expect(stress.getByText("₹80.00")).toBeInTheDocument();
    expect(stress.getByText("Day MTM · open positions")).toBeInTheDocument();
  });

  it("shows official NSE cash activity, participant OI and sector performance", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.eodIntelligence = { status: "available", source: "nse-eod-reports", asOf: snapshot.generatedAt, version: 1, reason: null, data: {
      reportDate: "2026-09-22",
      cashActivity: [{ category: "FII/FPI", buyCrore: 9845.81, sellCrore: 13655.8, netCrore: -3809.99 }, { category: "DII", buyCrore: 14599.72, sellCrore: 10479.65, netCrore: 4120.07 }],
      participantOi: [{ category: "FII", futureIndexLong: 40257, futureIndexShort: 343165, optionIndexCallLong: 1, optionIndexPutLong: 1, optionIndexCallShort: 1, optionIndexPutShort: 1 }, { category: "DII", futureIndexLong: 40955, futureIndexShort: 27774, optionIndexCallLong: 1, optionIndexPutLong: 1, optionIndexCallShort: 1, optionIndexPutShort: 1 }],
      sectorPerformance: [{ instrumentId: "NSE:BANKNIFTY", label: "Banking & Finance", close: 56215.55, change: -255.1, changePct: -0.45 }],
    } };
    render(<OverviewScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("tab", { name: /Act 3: Tomorrow's Edge/ }));
    const flows = within(screen.getByRole("region", { name: "Participant Flow Matrix (EOD)" }));
    expect(flows.getByText("−₹3,809.99 Cr")).toBeInTheDocument();
    expect(flows.getByText("+₹4,120.07 Cr")).toBeInTheDocument();
    expect(flows.getByText("-3,02,908 contracts")).toBeInTheDocument();
    const sectors = within(screen.getByRole("region", { name: "EOD Sector Index Performance" }));
    expect(sectors.getByText("Close 56,215.55")).toBeInTheDocument();
    expect(sectors.getByText("-255.10 (-0.45%)")).toBeInTheDocument();
  });

  it("fails expired broker readiness and labels the closed live feed not applicable", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["weekend-holiday"]);
    snapshot.connections = { status: "available", source: "sessions", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ source: "Kotak", status: "session_expired", latencyMs: null, asOf: snapshot.generatedAt }] };
    snapshot.readiness.data!.checks.brokerSessions = { status: "passed", reason: null };
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Broker re-authentication required");
    const checks = within(screen.getByRole("region", { name: "Next Session Pre-Flight" }));
    expect(checks.getByText("Failed")).toBeInTheDocument();
    expect(checks.getAllByText("Not applicable").length).toBeGreaterThan(0);
  });

  it("does not choose the new closed layout when the calendar is invalid", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.session.data!.calendarValid = false;
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.queryByRole("heading", { name: "Session P&L Summary" })).not.toBeInTheDocument();
    expect(screen.getByText(/treat this state as Unknown/)).toBeInTheDocument();
  });
});

describe("real-data layout switching", () => {
  it("preserves supplied prices and actual state across every layout and refresh", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.prices.data![0]!.value = 12345.67;
    const original = JSON.stringify(snapshot);
    const { rerender } = render(<OverviewScreen snapshot={snapshot} />);
    for (const layout of ["pre-open", "after-close", "weekend-holiday", "market-open"] as const) {
      rerender(<OverviewScreen snapshot={snapshot} layout={layout} />);
      expect(screen.getAllByText("12,345.67").length).toBeGreaterThan(0);
      expect(screen.queryByText("Not applicable")).not.toBeInTheDocument();
    }
    expect(JSON.stringify(snapshot)).toBe(original);
    const refreshed = structuredClone(snapshot);
    refreshed.prices.data![0]!.value = 12346.78;
    rerender(<OverviewScreen snapshot={refreshed} />);
    expect(screen.getByText("12,346.78")).toBeInTheDocument();
  });
  it("never substitutes fixtures when a source is unavailable", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.prices = { status: "unavailable", source: "zerodha", asOf: null, version: 0, reason: "NO_PRICE_SOURCE", data: null };
    const { rerender } = render(<OverviewScreen snapshot={snapshot} />);
    for (const layout of ["pre-open", "after-close", "weekend-holiday"] as const) {
      rerender(<OverviewScreen snapshot={snapshot} layout={layout} />);
      expect(screen.getByText("NO_PRICE_SOURCE")).toBeInTheDocument();
      expect(screen.queryByText("25,098.60")).not.toBeInTheDocument();
    }
  });
});
