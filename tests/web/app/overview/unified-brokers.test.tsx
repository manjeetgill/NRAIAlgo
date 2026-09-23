import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { MarketOpenScreen } from "../../../../apps/web/app/app/overview/market-open-screen";
import { OverviewScreen } from "../../../../apps/web/app/app/overview/overview-screen";

vi.mock("../../../../apps/web/app/app/overview/use-icici-account", async importOriginal => {
  const original = await importOriginal<typeof import("../../../../apps/web/app/app/overview/use-icici-account")>();
  return { ...original, useIciciAccount: () => ({ status: "ICICI REST snapshot", account: {
    accountId: "IC-TEST", asOf: "2026-09-22T10:00:00.000Z", sections: {
      portfolioholdings: { status: "available", rows: [{ stock_code: "IC-HOLD", quantity: 10, market_value: 1000 }] },
      portfoliopositions: { status: "available", rows: [{ stock_code: "IC-POS", quantity: 5, action: "Sell", pnl: 100 }, { stock_code: "GOLD", exchange_code: "MCX", quantity: 1, action: "Buy", pnl: null }] },
      order: { status: "available", rows: [{ order_id: "IC-ORDER", stock_code: "IC-CONTRACT", quantity: 5, action: "Sell" }] },
      funds: { status: "available", rows: [{ total_bank_balance: 123 }] },
    },
  } }) };
});

it("integrates ICICI in shared sections and filters it using the same dashboard selector", () => {
  render(<MarketOpenScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["market-open"]} />);
  expect(screen.queryByRole("region", { name: "ICICI account" })).not.toBeInTheDocument();
  expect(screen.queryByText("Bank balance (not margin)")).not.toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Demat Holdings" })).getByText("IC-HOLD")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Live Open Positions" })).getByText("IC-POS")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Recent Broker Orders" })).getByText("IC-ORDER")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zerodha" }));
  expect(screen.queryByText("IC-POS")).not.toBeInTheDocument();
  expect(screen.queryByText("IC-HOLD")).not.toBeInTheDocument();
  expect(screen.queryByText("IC-ORDER")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ICICI" }));
  expect(screen.getByText("IC-POS")).toBeInTheDocument();
  expect(screen.getByText("Bank balance (not margin)")).toBeInTheDocument();
  expect(screen.getByText("Reported / estimated position P&L · Excluding MCX")).toBeInTheDocument();
  expect(screen.getByText("GOLD")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Open-position P&L" })).getAllByText("+₹100.00").length).toBeGreaterThan(0);
  expect(screen.getByRole("region", { name: "Active Execution Engines" })).toBeInTheDocument();
});

it("uses ICICI holdings in the actual closed-session summary and scopes bank details", () => {
  render(<OverviewScreen snapshot={OVERVIEW_SNAPSHOT_FIXTURES["after-close"]} />);
  expect(screen.getByText("Session Closed")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Cash Holdings" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "ICICI" }));
  expect(within(screen.getByRole("region", { name: "Demat Holdings" })).getAllByText("₹1,000.00").length).toBeGreaterThan(0);
  expect(screen.getByText("Bank balance")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Zerodha" }));
  expect(screen.queryByText("Bank balance")).not.toBeInTheDocument();
  expect(screen.queryByText("IC-HOLD")).not.toBeInTheDocument();
});
