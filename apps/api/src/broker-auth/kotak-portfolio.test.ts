import { describe, expect, it } from "vitest";
import { fetchKotakPortfolio } from "./kotak-portfolio.js";
import type { KotakSession } from "./kotak.js";

const SESSION: KotakSession = { token: "t", sid: "s", baseUrl: "https://neo.example" };
const ACCOUNT_ID = "UCC001";

function fakeFetch(): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = typeof url === "string" ? url : url.toString();
    if (href.includes("/portfolio/v1/holdings")) {
      return {
        ok: true,
        json: async () => ({ data: [{ displaySymbol: "TCS", quantity: 5, closingPrice: 3800 }] }),
      } as Response;
    }
    if (href.includes("/quick/user/positions")) {
      return {
        ok: true,
        json: async () => ({ data: [{ realizedPL: 200, unrealizedPL: -50 }, { realizedPL: 0, unrealizedPL: 75 }] }),
      } as Response;
    }
    if (href.includes("/quick/user/limits")) {
      return {
        ok: true,
        json: async () => ({ data: { Net: 41000, MarginUsed: 9000, CollateralValue: 60000 } }),
      } as Response;
    }
    throw new Error(`Unexpected URL in test: ${href}`);
  }) as unknown as typeof fetch;
}

describe("fetchKotakPortfolio", () => {
  it("converts real holdings/positions/limits into the contract's paise-based shape, tagged with provider/account identity", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchKotakPortfolio(SESSION, "PAPER", now, ACCOUNT_ID, fakeFetch());

    expect(portfolio.holdings.holdings).toEqual([
      { provider: "kotak", accountId: ACCOUNT_ID, symbol: "TCS", quantity: 5, pledgedQuantity: null, marketValuePaise: 3800 * 5 * 100 },
    ]);
    expect(portfolio.holdings.availableMarginPaise).toBe(41_000_00);
    expect(portfolio.holdings.usedMarginPaise).toBe(9_000_00);
    expect(portfolio.holdings.collateralPaise).toBe(60_000_00);
  });

  it("sums realised/unrealised P&L across all position rows, but leaves charges/net unknown", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchKotakPortfolio(SESSION, "PAPER", now, ACCOUNT_ID, fakeFetch());

    expect(portfolio.pnl.realisedPaise).toBe(20_000);
    expect(portfolio.pnl.unrealisedPaise).toBe(2_500);
    expect(portfolio.pnl.chargesPaise).toBeNull();
    expect(portfolio.pnl.netPaise).toBeNull();
  });

  it("throws rather than silently returning an empty portfolio on an unexpected response shape", async () => {
    const brokenFetch = (async () => ({ ok: true, json: async () => ({ nope: true }) })) as unknown as typeof fetch;

    await expect(fetchKotakPortfolio(SESSION, "PAPER", new Date(), ACCOUNT_ID, brokenFetch)).rejects.toThrow();
  });

  it("rejects a required numeric field that is missing or malformed instead of silently defaulting to 0", async () => {
    const missingQuantityFetch = (async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/portfolio/v1/holdings")) {
        return { ok: true, json: async () => ({ data: [{ displaySymbol: "TCS", closingPrice: 3800 }] }) } as Response;
      }
      if (href.includes("/quick/user/positions")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ data: { Net: 0, MarginUsed: 0, CollateralValue: 0 } }) } as Response;
    }) as unknown as typeof fetch;

    await expect(fetchKotakPortfolio(SESSION, "PAPER", new Date(), ACCOUNT_ID, missingQuantityFetch)).rejects.toThrow(
      /quantity/,
    );
  });

  it("rejects a missing margin field (limits) instead of silently reporting ₹0", async () => {
    const missingLimitsFetch = (async (url: string | URL | Request) => {
      const href = typeof url === "string" ? url : url.toString();
      if (href.includes("/portfolio/v1/holdings")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      if (href.includes("/quick/user/positions")) {
        return { ok: true, json: async () => ({ data: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ data: { MarginUsed: 0, CollateralValue: 0 } }) } as Response;
    }) as unknown as typeof fetch;

    await expect(fetchKotakPortfolio(SESSION, "PAPER", new Date(), ACCOUNT_ID, missingLimitsFetch)).rejects.toThrow(
      /Net/,
    );
  });
});
