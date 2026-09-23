import { describe, expect, it } from "vitest";
import { calculateAndReconcilePortfolio } from "../../backend/nodejs/src/calculation-reconciliation.js";
import type { HoldingsData, PnlData, PositionRow } from "@nraialgo/contracts";

const asOf = "2026-09-23T10:00:00.000Z";
const pnl = (overrides: Partial<PnlData> = {}): PnlData => ({
  period: "session",
  currency: "INR",
  baseCapital: { context: "live", amountPaise: null },
  realisedPaise: 2_000,
  unrealisedPaise: 10_000,
  grossPaise: 12_000,
  chargesPaise: null,
  netPaise: null,
  valuationAsOf: asOf,
  reconciliationStatus: "provisional",
  ...overrides,
});
const positions: PositionRow[] = [{
  provider: "zerodha", accountId: "Z1", instrumentToken: 1, exchange: "NFO",
  symbol: "TEST", product: "NRML", quantity: 10, multiplier: 1,
  averagePrice: 100, lastPrice: 110, previousClose: 108,
  pnlPaise: 10_000, mtmPaise: 2_000, asOf, fresh: false,
}];
const holdings: HoldingsData = {
  holdings: [{
    provider: "zerodha", accountId: "Z1", symbol: "ABC", quantity: 5,
    pledgedQuantity: 0, marketValuePaise: 55_000, ltpPaise: 11_000,
    investedPaise: 50_000, unrealizedPaise: 5_000,
  }],
  collateralPaise: 0,
  usedMarginPaise: 25_000,
  availableMarginPaise: 75_000,
  accountAsOf: asOf,
  valuationAsOf: asOf,
  brokerBalances: [{ provider: "zerodha", accountId: "Z1", availableMarginPaise: 75_000, usedMarginPaise: 25_000, collateralPaise: 0, asOf }],
};

describe("calculation and reconciliation service", () => {
  it("calculates MTM, open P&L, holdings and margin coverage without inventing charges", () => {
    const result = calculateAndReconcilePortfolio({
      pnl: pnl(), holdings, positions,
      expectedProviders: ["zerodha"], receivedProviders: ["zerodha"],
    });
    expect(result.overallStatus).toBe("partial");
    expect(result.calculated).toMatchObject({
      dayMtmPaise: 2_000,
      openPositionPnlPaise: 10_000,
      holdingsMarketValuePaise: 55_000,
      holdingsInvestedPaise: 50_000,
      holdingsUnrealizedPaise: 5_000,
      usedMarginPaise: 25_000,
      availableMarginPaise: 75_000,
    });
    expect(result.checks.find((check) => check.id === "net-pnl-identity")?.status).toBe("not_evaluable");
    expect(result.checks.filter((check) => check.id !== "net-pnl-identity").every((check) => check.status === "matched")).toBe(true);
  });

  it("marks a broker arithmetic difference as a mismatch and preserves the delta", () => {
    const result = calculateAndReconcilePortfolio({
      pnl: pnl({ unrealisedPaise: 9_000, grossPaise: 11_000 }), holdings, positions,
      expectedProviders: ["zerodha"], receivedProviders: ["zerodha"],
    });
    expect(result.overallStatus).toBe("mismatch");
    expect(result.checks.find((check) => check.id === "position-unrealised-total")).toMatchObject({
      status: "mismatch", unit: "paise", expectedValue: 10_000, actualValue: 9_000, difference: -1_000,
    });
  });

  it("does not calculate a portfolio-wide daily MTM when any previous close is missing", () => {
    const incomplete = [{ ...positions[0]!, previousClose: null, mtmPaise: null }];
    const result = calculateAndReconcilePortfolio({
      pnl: pnl(), holdings, positions: incomplete,
      expectedProviders: ["zerodha", "icici"], receivedProviders: ["zerodha"],
    });
    expect(result.calculated.dayMtmPaise).toBeNull();
    expect(result.coverage.positionsWithDayMtm).toBe(0);
    expect(result.checks.find((check) => check.id === "provider-coverage")?.status).toBe("mismatch");
  });

  it("reports absent account data as partial rather than zero", () => {
    const result = calculateAndReconcilePortfolio({
      pnl: null, holdings: null, positions: null,
      expectedProviders: [], receivedProviders: [],
    });
    expect(result.overallStatus).toBe("partial");
    expect(result.calculated.dayMtmPaise).toBeNull();
    expect(result.calculated.holdingsMarketValuePaise).toBeNull();
    expect(result.calculated.availableMarginPaise).toBeNull();
  });
});
