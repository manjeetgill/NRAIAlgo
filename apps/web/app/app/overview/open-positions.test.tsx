import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { calculateDailyMtm, OpenPositions, type OpenPositionView } from "./open-positions";

const row: OpenPositionView = { id: "one", provider: "zerodha", symbol: "NIFTY TEST", account: "test", exchange: "NFO", product: "NRML", quantity: -10, side: "SELL", average: 100, ltp: 90, pnlPaise: 10000, marginPaise: 25000 };

it("calculates signed daily MTM from previous close and current price", () => {
  expect(calculateDailyMtm(10, 100, 105)).toBe(5000);
  expect(calculateDailyMtm(-10, 100, 105)).toBe(-5000);
  expect(calculateDailyMtm(10, null, 105)).toBeNull();
});
describe("reference-style positions layout", () => {
  it("hides redundant broker chips only when the caller supplies individual broker context", () => {
    const { rerender } = render(<OpenPositions rows={[row]} showBroker={false} />);
    expect(screen.queryByLabelText("Broker: Zerodha")).not.toBeInTheDocument();
    expect(screen.getByText("NIFTY TEST")).toBeInTheDocument();
    rerender(<OpenPositions rows={[row]} showBroker />);
    expect(screen.getByLabelText("Broker: Zerodha")).toBeInTheDocument();
  });
  it("does not expose raw broker-field expanders in detailed live positions", () => {
    render(<OpenPositions rows={[row]} detailed />);
    expect(screen.queryByText("View all broker fields")).not.toBeInTheDocument();
  });
  it("filters equity and MCX rows and isolates their metric snapshots", () => {
    render(<OpenPositions excludeMcx rows={[row, { ...row, id: "mcx", symbol: "GOLD", exchange: "MCX", pnlPaise: null }, { ...row, id: "other", symbol: "UNKNOWN", exchange: "UNKNOWN", pnlPaise: null }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Equity & F&O" }));
    expect(screen.getByText("NIFTY TEST")).toBeInTheDocument();
    expect(screen.queryByText("GOLD")).not.toBeInTheDocument();
    expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("+₹100.00");
    fireEvent.click(screen.getByRole("button", { name: "MCX" }));
    expect(screen.getByText("GOLD")).toBeInTheDocument();
    expect(screen.queryByText("NIFTY TEST")).not.toBeInTheDocument();
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
    expect(screen.getByRole("button", { name: "MCX" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument();
    expect(screen.getByText("3 displayed positions")).toBeInTheDocument();
  });
  it("excludes MCX only when requested, keeps its rows, and still rejects missing non-MCX P&L", () => {
    const mcx = { ...row, id: "mcx", symbol: "GOLD", exchange: " mcx ", pnlPaise: null };
    const { rerender } = render(<OpenPositions rows={[row, mcx]} excludeMcx />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("+₹100.00");
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("Excluding MCX");
    expect(screen.getByText("GOLD")).toBeInTheDocument();
    rerender(<OpenPositions rows={[row, mcx]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
    rerender(<OpenPositions rows={[{ ...row, pnlPaise: null }, mcx]} excludeMcx scope="Other" />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
  });
  it("totals reported and estimated values and refreshes with new estimates", () => {
    const estimated = { ...row, id: "estimate", pnlPaise: null, estimatedPnlPaise: -2500 };
    const { rerender } = render(<OpenPositions rows={[row, estimated]} />);
    const summary = () => screen.getByText("Open-position P&L").parentElement;
    expect(summary()).toHaveTextContent("+₹75.00");
    expect(summary()).toHaveTextContent("may include estimates");
    expect(screen.getByText("-₹25.00")).toHaveAttribute("data-tone", "negative");
    rerender(<OpenPositions rows={[row, { ...estimated, estimatedPnlPaise: 5000 }]} />);
    expect(summary()).toHaveTextContent("+₹150.00");
    rerender(<OpenPositions rows={[row, { ...estimated, estimatedPnlPaise: null }]} />);
    expect(summary()).toHaveTextContent("+₹150.00*");
    rerender(<OpenPositions rows={[row, estimated]} available={false} />);
    expect(summary()).toHaveTextContent("+₹150.00*");
  });
  it("sorts by displayed estimates and preserves broker-reported zero", () => {
    render(<OpenPositions rows={[{ ...row, pnlPaise: 0, estimatedPnlPaise: 90000 }, { ...row, id: "estimate", symbol: "ESTIMATED", pnlPaise: null, estimatedPnlPaise: -2500 }]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("-₹25.00");
    fireEvent.click(screen.getByRole("button", { name: "Position P&L (gross)" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")[1]).toHaveTextContent("ESTIMATED");
  });
  it("does not sum invalid values or an incomplete estimated set", () => {
    const { rerender } = render(<OpenPositions rows={[row, { ...row, id: "missing", pnlPaise: null }]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
    rerender(<OpenPositions rows={[{ ...row, pnlPaise: null, estimatedPnlPaise: NaN }]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
  });
  it("shows broker MTM separately from position P&L and withholds incomplete MTM", () => {
    const { rerender } = render(<OpenPositions rows={[{ ...row, mtmPaise: -12500 }]} />);
    expect(screen.getByText("Day MTM · open positions").parentElement).toHaveTextContent("-₹125.00");
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("+₹100.00");
    rerender(<OpenPositions rows={[{ ...row, mtmPaise: -12500 }]} available={false} />);
    expect(screen.getByText("Day MTM · open positions").parentElement).toHaveTextContent("-₹125.00*");
  });
  it("shows zero only for a confirmed empty position response", () => {
    const { rerender } = render(<OpenPositions rows={[]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("₹0.00");
    rerender(<OpenPositions rows={[]} available={false} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("₹0.00*");
  });
  it("keeps broker P&L distinct from unavailable intraday MTM and keeps exits locked", () => {
    render(<OpenPositions rows={[row]} marginPaise={200000} scope="Consolidated" />);
    expect(screen.getByText("Day MTM · open positions").parentElement).toHaveTextContent("—*");
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("+₹100.00");
    expect(screen.getByText("Account used margin").parentElement).toHaveTextContent("₹2,000.00");
    expect(screen.queryByRole("columnheader", { name: "Greeks (Δ / Γ)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Exit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Margin required" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Broker: Zerodha")).toHaveAttribute("data-broker", "zerodha");
  });
  it("does not report a complete total for missing P&L and sorts numeric values", () => {
    render(<OpenPositions rows={[{ ...row, id: "two", symbol: "ALPHA", pnlPaise: null, quantity: 20 }, row]} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
    fireEvent.click(screen.getByRole("button", { name: "Qty (units)" }));
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("NIFTY TEST");
    expect(rows[1]).toHaveTextContent("ALPHA");
  });
  it("withholds totals when selected broker coverage is incomplete", () => {
    render(<OpenPositions rows={[row]} available={false} />);
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("—*");
    expect(screen.getByText("Open-position P&L").parentElement).toHaveTextContent("Before charges");
  });
});
