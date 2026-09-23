import { describe, expect, it } from "vitest";
import { OverviewSnapshotSchema } from "../../shared/typescript/src/overview-snapshot.js";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../fixtures/overview";
import { PnlDataSchema, ReadinessDataSchema, ConnectionEntrySchema, HoldingsPanelSchema } from "../../shared/typescript/src/panels.js";
import type { MarketState } from "../../shared/typescript/src/common.js";

const MARKET_STATES = Object.keys(OVERVIEW_SNAPSHOT_FIXTURES) as MarketState[];

describe("OverviewSnapshotSchema", () => {
  it.each(MARKET_STATES)("accepts the %s fixture exactly", (state) => {
    const result = OverviewSnapshotSchema.safeParse(OVERVIEW_SNAPSHOT_FIXTURES[state]);
    expect(result.success).toBe(true);
  });

  it("rejects an available panel with no data", () => {
    const fixture = OVERVIEW_SNAPSHOT_FIXTURES["market-open"];
    const broken = {
      ...fixture,
      prices: { ...fixture.prices, status: "available", data: null },
    };
    expect(OverviewSnapshotSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unavailable panel with data but no reason", () => {
    const fixture = OVERVIEW_SNAPSHOT_FIXTURES["pre-open"];
    const broken = {
      ...fixture,
      pnl: {
        status: "unavailable",
        source: "portfolio-service",
        asOf: null,
        version: 0,
        data: fixture.session.data,
        reason: null,
      },
    };
    expect(OverviewSnapshotSchema.safeParse(broken).success).toBe(false);
  });
});

describe("PnlDataSchema", () => {
  it("rejects net that does not equal gross minus charges", () => {
    const result = PnlDataSchema.safeParse({
      period: "session",
      currency: "INR",
      baseCapital: { context: "paper", amountPaise: 100_000_00 },
      realisedPaise: 0,
      unrealisedPaise: 100_00,
      grossPaise: 200_00,
      chargesPaise: 50_00,
      netPaise: 200_00, // should be 150_00
      valuationAsOf: null,
      reconciliationStatus: "provisional",
    });
    expect(result.success).toBe(false);
  });

  it("allows chargesPaise/netPaise/baseCapital to be null -- unknown, never a fabricated zero", () => {
    const result = PnlDataSchema.safeParse({
      period: "session",
      currency: "INR",
      baseCapital: { context: "live", amountPaise: null },
      realisedPaise: 0,
      unrealisedPaise: 100_00,
      grossPaise: 200_00,
      chargesPaise: null,
      netPaise: null,
      valuationAsOf: null,
      reconciliationStatus: "provisional",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a known netPaise when chargesPaise is unknown -- net can't be computed without charges", () => {
    const result = PnlDataSchema.safeParse({
      period: "session",
      currency: "INR",
      baseCapital: { context: "live", amountPaise: null },
      realisedPaise: 0,
      unrealisedPaise: 100_00,
      grossPaise: 200_00,
      chargesPaise: null,
      netPaise: 200_00,
      valuationAsOf: null,
      reconciliationStatus: "provisional",
    });
    expect(result.success).toBe(false);
  });
});

describe("HoldingsPanelSchema", () => {
  it("accepts a degraded panel -- real data from the brokers that succeeded, plus a reason for what's missing", () => {
    const result = HoldingsPanelSchema.safeParse({
      status: "degraded",
      source: "zerodha",
      asOf: "2026-09-21T05:44:58Z",
      version: 1,
      reason: "Kotak: portfolio read failed; totals include only zerodha",
      data: {
        holdings: [
          { provider: "zerodha", accountId: "acct-1", symbol: "RELIANCE", quantity: 10, pledgedQuantity: 0, marketValuePaise: 100_00 },
        ],
        collateralPaise: 0,
        usedMarginPaise: 0,
        availableMarginPaise: 0,
        accountAsOf: "2026-09-21T05:44:58Z",
        valuationAsOf: "2026-09-21T05:44:58Z",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a degraded panel with no reason", () => {
    const result = HoldingsPanelSchema.safeParse({
      status: "degraded",
      source: "zerodha",
      asOf: "2026-09-21T05:44:58Z",
      version: 1,
      reason: "",
      data: {
        holdings: [],
        collateralPaise: 0,
        usedMarginPaise: 0,
        availableMarginPaise: 0,
        accountAsOf: null,
        valuationAsOf: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it("requires provider and accountId on every holding row, not just the symbol", () => {
    const result = HoldingsPanelSchema.safeParse({
      status: "available",
      source: "zerodha",
      asOf: "2026-09-21T05:44:58Z",
      version: 1,
      reason: null,
      data: {
        holdings: [{ symbol: "RELIANCE", quantity: 10, pledgedQuantity: 0, marketValuePaise: 100_00 }],
        collateralPaise: 0,
        usedMarginPaise: 0,
        availableMarginPaise: 0,
        accountAsOf: null,
        valuationAsOf: null,
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ReadinessDataSchema", () => {
  it("rejects liveTradeEligible=true when a check has not passed", () => {
    const result = ReadinessDataSchema.safeParse({
      checks: {
        totp: { status: "passed", reason: null },
        priceFeed: { status: "passed", reason: null },
        brokerSessions: { status: "passed", reason: null },
        riskLimits: { status: "failed", reason: "cap not set" },
      },
      liveTradeEligible: true,
    });
    expect(result.success).toBe(false);
  });

  it("allows liveTradeEligible=false even when all four checks passed -- e.g. deployment authorization or a kill-switch can still block trading", () => {
    const result = ReadinessDataSchema.safeParse({
      checks: {
        totp: { status: "passed", reason: null },
        priceFeed: { status: "passed", reason: null },
        brokerSessions: { status: "passed", reason: null },
        riskLimits: { status: "passed", reason: null },
      },
      liveTradeEligible: false,
    });
    expect(result.success).toBe(true);
  });
});

describe("ConnectionEntrySchema", () => {
  it("rejects a streaming connection with no latency", () => {
    const result = ConnectionEntrySchema.safeParse({
      source: "zerodha-price-stream",
      status: "streaming",
      latencyMs: null,
      asOf: "2026-09-21T05:44:58Z",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a merely-connected source with no latency", () => {
    const result = ConnectionEntrySchema.safeParse({
      source: "kotak-account-reads",
      status: "connected",
      latencyMs: null,
      asOf: "2026-09-21T05:44:58Z",
    });
    expect(result.success).toBe(true);
  });
});
