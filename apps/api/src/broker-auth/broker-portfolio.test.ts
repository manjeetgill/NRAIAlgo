import { describe, expect, it } from "vitest";
import type { Connect } from "kiteconnect";
import { fetchKotakPortfolio } from "./kotak-portfolio.js";
import type { KotakSession } from "./kotak.js";
import { fetchZerodhaPortfolio, type PortfolioClient } from "./zerodha-portfolio.js";
import { fetchZerodhaOrders } from "./zerodha-orders.js";

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
  it("excludes long and short derivatives from demat holdings without changing position P&L", async () => {
    const fallback = fakeFetch();
    const reader = (async (url: string | URL | Request) => String(url).includes('/holdings')
      ? { ok: true, json: async () => ({ data: [
        { displaySymbol: 'TCS', quantity: 5, closingPrice: 3800, exchangeSegment: 'nse_cm', instrumentType: 'Equity' },
        ...[65, -65].map(quantity => ({ displaySymbol: 'NIFTY', quantity, closingPrice: 300, exchangeSegment: 'nse_fo', instrumentType: 'Options' })),
        { displaySymbol: 'TESTFUT', quantity: 10, closingPrice: 100, instrumentType: 'Futures' },
      ] }) } as Response : fallback(url)) as typeof fetch;
    const result = await fetchKotakPortfolio(SESSION, 'LIVE', new Date(), ACCOUNT_ID, reader);
    expect(result.holdings.holdings).toHaveLength(1);
    expect(result.holdings.holdings[0]).toMatchObject({ symbol: 'TCS', marketValuePaise: 1900000 });
    expect(result.pnl.grossPaise).toBe(22500);
  });

  it("rejects negative cash holdings rather than subtracting them from demat value", async () => {
    const fallback = fakeFetch();
    const reader = (async (url: string | URL | Request) => String(url).includes('/holdings')
      ? { ok: true, json: async () => ({ data: [{ displaySymbol: 'TCS', quantity: -5, closingPrice: 3800, exchangeSegment: 'nse_cm' }] }) } as Response
      : fallback(url)) as typeof fetch;
    await expect(fetchKotakPortfolio(SESSION, 'LIVE', new Date(), ACCOUNT_ID, reader)).rejects.toThrow('negative quantity or price');
  });
  it("maps native Neo positions and top-level limits, using unit quantities and matched quote tokens", async () => {
    const native = { cfBuyQty: '65', flBuyQty: '0', cfSellQty: '0', flSellQty: '0', cfBuyAmt: '6500', buyAmt: '0', cfSellAmt: '0', sellAmt: '0', multiplier: '1', genNum: '1', genDen: '1', prcNum: '1', prcDen: '1', lotSz: '65', tok: '123', exSeg: 'nse_fo', trdSym: 'TESTCE', prod: 'NRML' };
    const reader = (async (url: string | URL | Request) => {
      const href = String(url);
      const body = href.includes('/holdings') ? { data: [] } : href.includes('/positions') ? {data: [native, {...native, tok:'124', trdSym:'TESTPE', cfBuyQty:'0', cfSellQty:'65',cfBuyAmt:'0',cfSellAmt:'6500'}]} : href.includes('/quotes/') ? [{exchange:'nse_fo',exchange_token:'124',ltp:'90'}, {exchange:'nse_fo',exchange_token:'123',ltp:'110'}] : { Net:'10000', MarginUsed:'500', CollateralValue:'5000', RealizedMtomPrsnt:'0' };
      return {ok:true,json:async()=>body} as Response;
    }) as typeof fetch;
    const result = await fetchKotakPortfolio(SESSION, 'LIVE', new Date(), ACCOUNT_ID, reader, 8000, 'test-app-key');
    expect(result.positions).toHaveLength(2);
    expect(result.positions![0]).toMatchObject({provider:'kotak',quantity:65,averagePrice:100,lastPrice:110,pnlPaise:65000,fresh:false});
    expect(result.positions![1]).toMatchObject({quantity:-65,pnlPaise:65000});
    expect(result.pnl.grossPaise).toBe(130000);
    expect(result.holdings.brokerBalances![0]).toMatchObject({provider:'kotak',availableMarginPaise:1000000});
  });

  it("converts real holdings/positions/limits into the contract's paise-based shape, tagged with provider/account identity", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchKotakPortfolio(SESSION, "PAPER", now, ACCOUNT_ID, fakeFetch());

    expect(portfolio.holdings.holdings).toEqual([
      { details: {closingPrice:3800,displaySymbol:"TCS",quantity:5}, provider: "kotak", accountId: ACCOUNT_ID, symbol: "TCS", quantity: 5, pledgedQuantity: null, marketValuePaise: 3800 * 5 * 100 },
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
          { realised: 500, unrealised: -120, quantity: 10, instrument_token: 123, exchange: "NSE", tradingsymbol: "RELIANCE", product: "CNC", multiplier: 1, average_price: 100, last_price: 88 },
          { realised: 0, unrealised: 300, quantity: 0 },
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
  it("calculates daily MTM from previous close and current price, never from overall P&L", async () => {
    const client = fakeClient();
    const response = await client.getPositions();
    response.net[0]!.m2m = -125.5;
    response.net[0]!.close_price = 100;
    client.getPositions = async () => response;
    const result = await fetchZerodhaPortfolio("key", "token", "PAPER", new Date(), "AB1234", () => client);
    expect(result.positions![0]).toMatchObject({ previousClose: 100, mtmPaise: -12000, pnlPaise: 38000 });
    const missing = await fetchZerodhaPortfolio("key", "token", "PAPER", new Date(), "AB1234", () => fakeClient());
    expect(missing.positions![0]!.mtmPaise).toBeNull();
  });
  it("converts real holdings/positions/margins into the contract's paise-based shape, tagged with provider/account identity", async () => {
    const now = new Date("2026-09-21T10:00:00Z");
    const portfolio = await fetchZerodhaPortfolio("key", "token", "PAPER", now, "AB1234", () => fakeClient());

    expect(portfolio.holdings.holdings).toEqual([
      // Ten free and two pledged shares are twelve owned shares.
      { details: {collateral_quantity:2}, fresh: false, priceAsOf: now.toISOString(), provider: "zerodha", accountId: "AB1234", symbol: "RELIANCE", quantity: 12, pledgedQuantity: 2, marketValuePaise: 3_540_000, ltpPaise: 295000 },
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

describe("Zerodha order-book read model", () => {
  const credentials = { apiKey: "key", accessToken: "secret-token", accountId: "AB" };
  it("returns only public order fields, retaining partial fills and broker status", async () => {
    const panel = await fetchZerodhaOrders(credentials, () => ({ setAccessToken() {}, getOrders: async () => ([{
      order_id: "123", tradingsymbol: "TEST", exchange: "NSE", product: "MIS", transaction_type: "BUY", status: "OPEN", quantity: 10, filled_quantity: 4, average_price: 100,
      private_debug: "secret-token",
    }] as unknown as Awaited<ReturnType<Connect["getOrders"]>>) }));
    expect(panel.data?.[0]?.filledQuantity).toBe(4);
    expect(panel.data?.[0]?.status).toBe("OPEN");
    expect(JSON.stringify(panel)).not.toContain("secret-token");
  });
  it("redacts SDK error details and does not claim that failed reads mean no orders", async () => {
    const panel = await fetchZerodhaOrders(credentials, () => ({ setAccessToken() {}, getOrders: async () => { throw new Error("secret-token"); } }));
    expect(panel.status).toBe("unavailable");
    expect(panel.data).toBeNull();
    expect(JSON.stringify(panel)).not.toContain("secret-token");
  });
});
