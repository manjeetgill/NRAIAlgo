import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES, type OverviewSnapshot } from "@nraialgo/contracts";
import { OverviewScreen } from "./overview-screen";

// This is the shared Overview contract in practice: no hook, no switcher, no
// time dependency -- just a snapshot passed straight in as a prop. Any
// future caller (the production page's live fetch, the playground's
// fixtures, a future test) renders the exact same way.
describe("OverviewScreen", () => {
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
    expect(screen.getByText(/Gross/)).toBeInTheDocument();
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
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
  });

  it("keys each holding row by provider+account+symbol, and shows which provider it's from", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);

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
    expect(screen.getByText("RELIANCE")).toBeInTheDocument();
  });
});
