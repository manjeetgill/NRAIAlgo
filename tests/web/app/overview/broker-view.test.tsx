import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { OverviewSnapshotSchema } from "@nraialgo/contracts";
import { brokerView } from "../../../../frontend/nextjs/app/app/overview/broker-view";
import { MarketOpenScreen } from "../../../../frontend/nextjs/app/app/overview/market-open-screen";

function fixture() {
  const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
  snapshot.holdings = { status: "available", source: "zerodha+kotak", asOf: snapshot.generatedAt, version: 1, reason: null, data: {
    holdings: ["zerodha", "kotak"].map(provider => ({ provider, accountId: `${provider}-account`, symbol: "SHARED-STOCK", quantity: 10, pledgedQuantity: null, marketValuePaise: 10000 })),
    brokerBalances: ["zerodha", "kotak"].map(provider => ({ provider, accountId: `${provider}-account`, availableMarginPaise: 10000, usedMarginPaise: 0, collateralPaise: 0, asOf: snapshot.generatedAt })),
    availableMarginPaise: 20000, usedMarginPaise: 0, collateralPaise: 0, accountAsOf: snapshot.generatedAt, valuationAsOf: snapshot.generatedAt,
  } };
  snapshot.pnl.source = "zerodha+kotak";
  snapshot.brokerOrders = { status: "available", source: "zerodha-order-book", asOf: snapshot.generatedAt, version: 1, reason: null, data: [{ orderId: "Z-ORDER", symbol: "ORDER-STOCK", exchange: "NSE", product: "CNC", side: "BUY", status: "OPEN", quantity: 10, filledQuantity: 0, averagePrice: 0 }] };
  return snapshot;
}

describe("broker dashboard views", () => {
  it("preserves the consolidated snapshot and validates individual read models", () => {
    const snapshot = fixture();
    expect(brokerView(snapshot, "all")).toBe(snapshot);
    for (const broker of ["zerodha", "kotak"] as const) {
      const scoped = brokerView(snapshot, broker);
      expect(OverviewSnapshotSchema.safeParse(scoped).success).toBe(true);
      expect(scoped.holdings.data?.holdings.map(row => row.provider)).toEqual([broker]);
      expect(scoped.holdings.data?.availableMarginPaise).toBe(10000);
      expect(scoped.pnl.data).toBeNull();
      expect(scoped.prices).toBe(snapshot.prices);
      expect(scoped.deployment.data).toBeNull();
    }
    expect(snapshot.holdings.data?.holdings).toHaveLength(2);
  });

  it("switches from the consolidated desk to broker-specific headings without leaking another broker's orders", () => {
    render(<MarketOpenScreen snapshot={fixture()} />);
    expect(screen.getByRole("heading", { name: "Cross-Broker Capital & Margin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Consolidated Intraday P&L" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Demat Holdings" })).getAllByText("SHARED-STOCK")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Kotak" }));
    expect(screen.queryByText("Z-ORDER")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "ICICI account" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Demat Holdings" })).getAllByText("SHARED-STOCK")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Kotak Capital & Margin" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kotak Intraday P&L" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kotak Active Positions (F&O)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flatten positions" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "All Brokers" }));
    expect(screen.getByText("Z-ORDER")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ICICI" }));
    expect(screen.getByRole("button", { name: "ICICI" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ICICI" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("region", { name: "ICICI account" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Live Open Positions" })).toBeInTheDocument();
    expect(screen.queryByText("Z-ORDER")).not.toBeInTheDocument();
  });

  it("does not invent zero balances when selected broker data is missing", () => {
    const snapshot = fixture();
    snapshot.holdings.data!.brokerBalances = snapshot.holdings.data!.brokerBalances!.filter(row => row.provider === "zerodha");
    expect(brokerView(snapshot, "kotak").holdings.data).toBeNull();
  });

  it("filters positions and connections without changing shared market data", () => {
    const snapshot = fixture();
    snapshot.positions = { status: "available", source: "zerodha-positions+kotak-positions", asOf: snapshot.generatedAt, version: 1, reason: null, data: ["zerodha", "kotak"].flatMap(provider => [0, 5].map(quantity => ({ provider, accountId: `${provider}-account`, instrumentToken: 1, exchange: "NSE", symbol: `POSITION-${quantity}`, product: "CNC", quantity, multiplier: 1, averagePrice: 100, lastPrice: 101, pnlPaise: 100, asOf: snapshot.generatedAt, fresh: true }))) };
    snapshot.connections = { status: "available", source: "broker-account-reads", asOf: snapshot.generatedAt, version: 1, reason: null, data: ["zerodha", "kotak"].map(provider => ({ source: `${provider} account REST`, status: "connected", latencyMs: null, asOf: snapshot.generatedAt })) };
    const result = brokerView(snapshot, "kotak");
    expect(result.positions?.data).toHaveLength(1);
    expect(result.positions?.data?.[0]?.provider).toBe("kotak");
    expect(result.connections.data?.map(row => row.source)).toEqual(["kotak account REST"]);
    expect(result.prices).toBe(snapshot.prices);
    expect(result.readiness).toBe(snapshot.readiness);
  });

  it("retains a single-provider P&L but never substitutes it for another broker", () => {
    const snapshot = fixture();
    snapshot.pnl.source = "zerodha";
    expect(brokerView(snapshot, "zerodha").pnl).toBe(snapshot.pnl);
    expect(brokerView(snapshot, "kotak").pnl.data).toBeNull();
  });

  it("keeps selection across refreshes and removes unavailable rows", () => {
    const snapshot = fixture();
    const view = render(<MarketOpenScreen snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "Kotak" }));
    snapshot.holdings = { status: "unavailable", source: "brokers", asOf: null, version: 2, reason: "Disconnected", data: null };
    view.rerender(<MarketOpenScreen snapshot={snapshot} />);
    expect(screen.getByRole("button", { name: "Kotak" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("SHARED-STOCK")).not.toBeInTheDocument();
  });
});
