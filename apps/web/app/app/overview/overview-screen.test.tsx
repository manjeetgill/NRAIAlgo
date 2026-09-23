import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES, type OverviewSnapshot } from "@nraialgo/contracts";
import { OverviewScreen } from "./overview-screen";
import { TemporaryViewSelector } from "./temporary-view-selector";

// This is the shared Overview contract in practice: no hook, no switcher, no
// time dependency -- just a snapshot passed straight in as a prop. Any
// future caller (the production page's live fetch, the playground's
// fixtures, a future test) renders the exact same way.
describe("OverviewScreen", () => {
  it("renders real position quantities, freshness and broker orders without enabling exits", () => {
    const snapshot: OverviewSnapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.positions = { status: "available", source: "zerodha-positions", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ provider: "zerodha", accountId: "AB", instrumentToken: 1, exchange: "NFO", symbol: "TEST-FUT", product: "NRML", quantity: -25, multiplier: 1, averagePrice: 100, lastPrice: 98, pnlPaise: 5000, asOf: snapshot.generatedAt, fresh: true }] };
    snapshot.brokerOrders = { status: "available", source: "zerodha-order-book", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ orderId: "ORDER-123", symbol: "TEST-FUT", exchange: "NFO", product: "NRML", side: "SELL", status: "OPEN", quantity: 25, filledQuantity: 10, averagePrice: 100 }] };
    render(<OverviewScreen snapshot={snapshot} />);
    expect(screen.getByText("-25")).toBeInTheDocument();
    expect(screen.getByText(/Live tick/)).toBeInTheDocument();
    expect(screen.getByText("ORDER-123")).toBeInTheDocument();
    expect(screen.getByText("10 / 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit" })).toBeDisabled();
    expect(screen.queryByText("Awaiting position-level data")).not.toBeInTheDocument();
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
    expect(screen.getAllByText(/Gross/).length).toBeGreaterThan(0);
  });

  it("shows an honest reason for a panel with no data source, never a fabricated value", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["pre-open"]} />);

    expect(screen.getByText("BASELINE_UNAVAILABLE")).toBeInTheDocument();
  });

  it("shows 'Charges: Pending'/'Net: Unavailable' instead of a fabricated ₹0 when a provider hasn't reported charges", () => {
    const fixture = OVERVIEW_SNAPSHOT_FIXTURES["market-open"];
    const snapshot = {
      ...fixture,
      pnl: {
        ...fixture.pnl,
        data: fixture.pnl.data && { ...fixture.pnl.data, chargesPaise: null, netPaise: null },
      },
    } as OverviewSnapshot;

    render(<OverviewScreen snapshot={snapshot} />);

    expect(screen.getByText(/Charges:/)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/Net P&L: Unavailable/)).toBeInTheDocument();
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

    expect(screen.getByText(/totals include only zerodha/)).toBeInTheDocument();
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
  it("renders the after-close panel hierarchy and all three reference-price slots", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["after-close"]} />);
    for (const name of ["Session P&L Summary", "Demat Holdings", "Strategy Posture", "Since the Close", "Data & Broker Connections", "Next Session Pre-Flight", "NIFTY 50", "BANK NIFTY", "INDIA VIX"]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }
    expect(screen.getByText("Last observed")).toBeInTheDocument();
    expect(screen.queryByText("Official close")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Arm at next open" })).toBeDisabled();
  });

  it("uses the calendar's next trading day, not a hardcoded Monday", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["weekend-holiday"]} />);
    expect(screen.getByText("2026-09-22")).toBeInTheDocument();
    expect(screen.getByText("Weekly equity history unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Reported period: Last completed session/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weekend Optimizations" })).toBeInTheDocument();
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
    const { rerender } = render(<TemporaryViewSelector snapshot={snapshot} />);
    for (const name of ["Pre-open", "After close", "Weekend / holiday", "Market open"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByText("12,345.67")).toBeInTheDocument();
      expect(screen.getByText(/Actual server session: Market open/)).toBeInTheDocument();
      expect(screen.queryByText("Not applicable")).not.toBeInTheDocument();
    }
    expect(JSON.stringify(snapshot)).toBe(original);
    const refreshed = structuredClone(snapshot);
    refreshed.prices.data![0]!.value = 12346.78;
    rerender(<TemporaryViewSelector snapshot={refreshed} />);
    expect(screen.getByText("12,346.78")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Auto · actual session" }));
    expect(screen.getByText("12,346.78")).toBeInTheDocument();
  });
  it("never substitutes fixtures when a source is unavailable", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    snapshot.prices = { status: "unavailable", source: "zerodha", asOf: null, version: 0, reason: "NO_PRICE_SOURCE", data: null };
    render(<TemporaryViewSelector snapshot={snapshot} />);
    for (const name of ["Pre-open", "After close", "Weekend / holiday"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByText("NO_PRICE_SOURCE")).toBeInTheDocument();
      expect(screen.queryByText("25,098.60")).not.toBeInTheDocument();
    }
  });
});
