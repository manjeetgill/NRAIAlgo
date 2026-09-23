import { describe, expect, it } from "vitest";
import { fetchZerodhaPortfolio, type PortfolioClient } from "./zerodha-portfolio.js";

function fakeClient(): PortfolioClient {
  return {
    setAccessToken: () => {},
    getHoldings: async () =>
      [
        {
          tradingsymbol: "RELIANCE",
          quantity: 10,
          collateral_quantity: 2,
          last_price: 2950,
        },
      ] as unknown as Awaited<ReturnType<PortfolioClient["getHoldings"]>>,
    getPositions: async () =>
      ({
        net: [
          { realised: 500, unrealised: -120 },
          { realised: 0, unrealised: 300 },
        ],
        day: [],
      }) as unknown as Awaited<ReturnType<PortfolioClient["getPositions"]>>,
    getMargins: async () =>
      ({
        equity: {
          net: 38000,
          available: { collateral: 50000 },
          utilised: { debits: 12000 },
        },
      }) as unknown as Awaited<ReturnType<PortfolioClient["getMargins"]>>,
  };
}

describe("fetchZerodhaPortfolio", () => {
  it("converts real holdings/positions/margins into the contract's paise-based shape, tagged with provider/account identity", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchZerodhaPortfolio("key", "token", "PAPER", now, "AB1234", () => fakeClient());

    expect(portfolio.holdings.holdings).toEqual([
      // last_price (2950) * quantity (10) = 29,500 rupees = 2,950,000 paise.
      { provider: "zerodha", accountId: "AB1234", symbol: "RELIANCE", quantity: 10, pledgedQuantity: 2, marketValuePaise: 2_950_000 },
    ]);
    expect(portfolio.holdings.availableMarginPaise).toBe(38_000_00);
    expect(portfolio.holdings.usedMarginPaise).toBe(12_000_00);
    expect(portfolio.holdings.collateralPaise).toBe(50_000_00);
  });

  it("sums realised/unrealised P&L across all net positions, but leaves charges/net unknown", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchZerodhaPortfolio("key", "token", "PAPER", now, "AB1234", () => fakeClient());

    expect(portfolio.pnl.realisedPaise).toBe(50_000); // (500+0) rupees -> paise
    expect(portfolio.pnl.unrealisedPaise).toBe(18_000); // (-120+300) rupees -> paise
    expect(portfolio.pnl.grossPaise).toBe(portfolio.pnl.realisedPaise + portfolio.pnl.unrealisedPaise);
    // Kite's calls carry no per-trade charges breakdown -- unknown, not a
    // fabricated 0/gross.
    expect(portfolio.pnl.chargesPaise).toBeNull();
    expect(portfolio.pnl.netPaise).toBeNull();
  });

  it("leaves baseCapital unknown (null) -- available margin is a different concept and must not stand in for it", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchZerodhaPortfolio("key", "token", "LIVE", now, "AB1234", () => fakeClient());

    expect(portfolio.pnl.baseCapital).toEqual({ context: "live", amountPaise: null });
  });

  it("times out rather than hanging forever against an unresponsive broker call", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const hangingClient: PortfolioClient = {
      setAccessToken: () => {},
      getHoldings: () => new Promise(() => {}),
      getPositions: () => new Promise(() => {}),
      getMargins: () => new Promise(() => {}),
    };

    await expect(
      fetchZerodhaPortfolio("key", "token", "LIVE", now, "AB1234", () => hangingClient, 10),
    ).rejects.toThrow(/timed out/);
  });
});
