import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PortfolioTable } from "../../../../frontend/nextjs/app/app/overview/portfolio-table";

it("keeps the dashboard compact with a keyboard-scrollable table and detail link", () => {
  render(<PortfolioTable rows={[]} />);
  expect(screen.getByRole("region", { name: "Scrollable cash holdings" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("link", { name: /View detailed cash holdings/ })).toHaveAttribute("href", "/app/cash-holdings");
  expect(screen.queryByText("Total holdings value")).not.toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Avg cost" })).not.toBeInTheDocument();
});

it("groups and sorts holdings within broker groups without inventing pledge status", () => {
  render(<PortfolioTable detailed rows={[
    { provider: "zerodha", accountId: "Z1", symbol: "ALPHA", quantity: 20, pledgedQuantity: 0, marketValuePaise: 20000, dayPnlPaise: -100 },
    { provider: "kotak", accountId: "K1", symbol: "BETA", quantity: 5, pledgedQuantity: 2, marketValuePaise: 5000 },
    { provider: "zerodha", accountId: "Z2", symbol: "GAMMA", quantity: 3, marketValuePaise: 3000, dayPnlPaise: 200 },
  ]} />);
  const group = screen.getByRole("rowgroup", { name: "Zerodha holdings" });
  expect(within(group).queryByText("BETA")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Qty (Pldg/Free)" }));
  expect(within(group).getAllByRole("row")[1]).toHaveTextContent("GAMMA");
  expect(screen.getByRole("img", { name: "Not pledged" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Partly or fully pledged" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Pledge status unavailable" })).toBeInTheDocument();
  expect(screen.getByText("-₹1.00")).toHaveAttribute("data-tone", "negative");
  expect(screen.getByText("Price-change impact (est.)", { selector: "span" }).parentElement).toHaveTextContent("—*");
});

it("paginates holdings while keeping summary totals scoped to all filtered rows", () => {
  render(<PortfolioTable detailed available rows={Array.from({length: 26}, (_, i) => ({provider: "zerodha", accountId: "Z1", symbol: "SYM" + String(i).padStart(2,"0"), quantity: 1, marketValuePaise: 10000}))} />);
  expect(screen.getByText("SYM00")).toBeInTheDocument();
  expect(screen.queryByText("SYM25")).not.toBeInTheDocument();
  expect(screen.getByText("₹2,600.00")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Next"}));
  expect(screen.getByText("SYM25")).toBeInTheDocument();
  expect(screen.queryByText("SYM00")).not.toBeInTheDocument();
});

it("hides broker chips and broker grouping for an individual holdings view", () => {
  const { container } = render(<PortfolioTable detailed showBroker={false} rows={[
    { provider: "kotak", accountId: "K1", symbol: "BETA", quantity: 5, pledgedQuantity: 0, marketValuePaise: 5000 },
  ]} />);
  expect(container.querySelector("[data-broker]")).not.toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Account" })).toBeInTheDocument();
  expect(screen.queryByRole("rowgroup", { name: "Kotak holdings" })).not.toBeInTheDocument();
});

it("does not expose raw broker-field expanders in detailed holdings", () => {
  render(<PortfolioTable detailed rows={[
    { provider: "zerodha", accountId: "Z1", symbol: "ALPHA", quantity: 20, marketValuePaise: 20000 },
  ]} />);
  expect(screen.queryByText("View all broker fields")).not.toBeInTheDocument();
});
