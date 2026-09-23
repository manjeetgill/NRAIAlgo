import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { MarketClosedScreen } from "../../../../apps/web/app/app/overview/market-closed-screen";

// Tested directly against MarketClosedScreen (not through OverviewScreen)
// because NonLiveDashboard's "All brokers" default view deliberately nulls
// pnl.data (a consolidated total can't include ICICI, so it's withheld) --
// unrelated to session-performance rendering, which is this component's
// own concern.
describe("MarketClosedScreen -- session performance stats", () => {
  it("shows an honest dash for every stat when no session history has been recorded yet", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.pnl.data!.performance = { sessionsRecorded: 0, sessionsRequiredForSharpe: 20, dayWinRatePct: null, maxDrawdownPaise: null, sharpe: null };

    render(<MarketClosedScreen snapshot={snapshot} />);

    expect(screen.getByText("Day win rate").nextElementSibling).toHaveTextContent("—");
    expect(screen.getByText("Max drawdown").nextElementSibling).toHaveTextContent("—");
    // Sharpe shows a "0/20 sessions" progress indicator rather than a bare
    // dash even at zero -- it confirms tracking has actually started.
    expect(screen.getByText("Sharpe").nextElementSibling).toHaveTextContent("0/20 sessions");
  });

  it("shows real day win rate, Sharpe and max drawdown once real history exists", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.pnl.data!.performance = { sessionsRecorded: 25, sessionsRequiredForSharpe: 20, dayWinRatePct: 64, maxDrawdownPaise: 12_345_00, sharpe: 1.23 };

    render(<MarketClosedScreen snapshot={snapshot} />);

    expect(screen.getByText("Day win rate").nextElementSibling).toHaveTextContent("64%");
    expect(screen.getByText("Sharpe").nextElementSibling).toHaveTextContent("1.23");
    expect(screen.getByText("Max drawdown").nextElementSibling).toHaveTextContent(/12,345|123,450|1,23,450/);
    // Profit factor stays honestly unavailable regardless -- it needs
    // trade-level fills, which session_pnl_history does not provide.
    expect(screen.getByText("Profit factor").nextElementSibling).toHaveTextContent("—");
  });

  it("shows a sessions-remaining progress indicator for Sharpe instead of guessing early", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.pnl.data!.performance = { sessionsRecorded: 7, sessionsRequiredForSharpe: 20, dayWinRatePct: 57.1, maxDrawdownPaise: 5_000_00, sharpe: null };

    render(<MarketClosedScreen snapshot={snapshot} />);

    expect(screen.getByText("Sharpe").nextElementSibling).toHaveTextContent("7/20 sessions");
  });

  it("never labels this 'Win ratio' -- it's day-level, not trade-level", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.pnl.data!.performance = { sessionsRecorded: 3, sessionsRequiredForSharpe: 20, dayWinRatePct: 33.3, maxDrawdownPaise: 1_000_00, sharpe: null };

    render(<MarketClosedScreen snapshot={snapshot} />);

    expect(screen.queryByText("Win ratio")).not.toBeInTheDocument();
    expect(screen.getByText("Day win rate")).toBeInTheDocument();
  });
});
