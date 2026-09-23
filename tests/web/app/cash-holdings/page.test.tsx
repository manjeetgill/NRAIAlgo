import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CashHoldingsPage from "../../../../apps/web/app/app/cash-holdings/page";

vi.mock("../../../../apps/web/app/app/overview/use-overview-snapshot", () => ({ useOverviewSnapshot: () => ({ snapshot: null, error: null, stale: false }) }));
vi.mock("@/app/components/shell/overview-context", () => ({ useShellOverview: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("shows real ICICI holdings, filters them and keeps missing-source totals unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ accountId: "TEST", asOf: "2026-09-22T10:00:00.000Z", sections: { portfolioholdings: { status: "available", rows: [{ stock_code: "ALPHA", quantity: 10, market_value: 1000 }] } } }) })));
  render(<CashHoldingsPage />);
  expect(await screen.findByText("ALPHA")).toBeInTheDocument();
  expect(screen.getByText("Portfolio Value").parentElement).toHaveTextContent("—*");
  fireEvent.change(screen.getByLabelText("Broker"), { target: { value: "icici" } });
  expect(screen.getByText("Portfolio Value").parentElement).toHaveTextContent("₹1,000.00");
  fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "missing" } });
  expect(screen.queryByText("ALPHA")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search holdings"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Pledge status"), { target: { value: "free" } });
  expect(screen.queryByText("ALPHA")).not.toBeInTheDocument();
});
