import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "@nraialgo/contracts";
import { OverviewScreen } from "./overview-screen";
import { MarketOpenScreen } from "./market-open-screen";

vi.mock("./use-icici-account", async importOriginal => {
  const original = await importOriginal<typeof import("./use-icici-account")>();
  return { ...original, useIciciAccount: () => ({ status: "Not connected", account: null, stale: true, refresh: () => {} }) };
});

// AccountDetails backs the after-close/pre-open/weekend-holiday layouts
// (via NonLiveDashboard). The after-close fixture has no brokerBalances,
// brokerOrders or configuredProviders at all -- exactly the disconnected
// workspace manual QA found both tables silently blank in.
describe("AccountDetails (closed-market layouts) -- empty-state messages", () => {
  it("Broker Funds names which broker's data is missing instead of a silent blank table", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["after-close"]} />);

    expect(screen.getByText(/No broker funds data/)).toBeInTheDocument();
  });

  it("Recent Broker Orders names every attempted-and-missing source, not only ICICI", () => {
    render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["after-close"]} />);

    const message = screen.getByText(/Zerodha:.*ICICI:/);
    expect(message).toHaveTextContent("Zerodha:");
    expect(message).toHaveTextContent("ICICI:");
    // Never implies only ICICI is a problem -- the old, misleading wording.
    expect(screen.queryByText(/^ICICI order coverage:/)).not.toBeInTheDocument();
  });

  it("does not show the missing-sources message once real orders exist", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.brokerOrders = { status: "available", source: "zerodha-order-book", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ orderId: "Z-1", symbol: "RELIANCE", exchange: "NSE", product: "CNC", side: "BUY", status: "OPEN", quantity: 10, filledQuantity: 0, averagePrice: 0 }] };

    render(<OverviewScreen snapshot={snapshot} />);

    expect(screen.getByText("Z-1")).toBeInTheDocument();
    expect(screen.queryByText(/Zerodha:.*ICICI:/)).not.toBeInTheDocument();
  });

  it("does not show the funds message once real broker balances exist", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.holdings.data!.brokerBalances = [{ provider: "zerodha", accountId: "AB1234", availableMarginPaise: 100_00, usedMarginPaise: 0, collateralPaise: 0, asOf: snapshot.generatedAt }];

    render(<OverviewScreen snapshot={snapshot} />);

    expect(screen.getByText((_, node) => node?.textContent === "zerodha · AB1234")).toBeInTheDocument();
    expect(screen.queryByText(/No broker funds data/)).not.toBeInTheDocument();
  });
});

describe("MarketOpenScreen -- Recent Broker Orders empty-state message", () => {
  it("labels the Zerodha gap explicitly instead of an unlabeled 'Order data unavailable'", () => {
    render(<MarketOpenScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);

    const orders = within(screen.getByRole("region", { name: "Recent Broker Orders" }));
    expect(orders.getByText(/Zerodha: Order data unavailable/)).toBeInTheDocument();
  });
});
