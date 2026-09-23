import { z } from "zod";
import { MarketStateSchema, panel } from "./common.js";

/** Money travels as integer minor units (paise), never a float, so panel data can be
 * compared and summed exactly. */
const paise = () => z.number().int();

export const SessionDataSchema = z.object({
  state: MarketStateSchema,
  calendarValid: z.boolean(),
  sessionId: z.string().nullable(),
  lastCompletedSession: z.string().nullable(),
  nextSession: z.string().nullable(),
  nextTransitionAt: z.iso.datetime().nullable(),
});
export type SessionData = z.infer<typeof SessionDataSchema>;
export const SessionPanelSchema = panel(SessionDataSchema);

export const PriceQuoteSchema = z.object({
  instrumentId: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  // "official-close" is specifically NSE's own published end-of-day
  // closing value (e.g. the bhavcopy archive) -- distinct from
  // "last-observed", which means an ambiguous last-seen tick (a feed that
  // dropped mid-session, a stale cache) and should never be used for a
  // source that actually has a real, named "official close" concept.
  priceBasis: z.enum(["ltp", "bid", "ask", "official-close", "last-observed"]),
  sourceAsOf: z.iso.datetime(),
  receivedAt: z.iso.datetime(),
  fresh: z.boolean(),
  change: z.number().optional(),
  changePct: z.number().optional(),
});
export type PriceQuote = z.infer<typeof PriceQuoteSchema>;
export const PricesDataSchema = z.array(PriceQuoteSchema);
export const PricesPanelSchema = panel(PricesDataSchema);

export const EodIntelligenceDataSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  cashActivityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  participantOiDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sectorPerformanceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cashActivity: z.array(z.object({
    category: z.enum(["FII/FPI", "DII"]),
    buyCrore: z.number(),
    sellCrore: z.number(),
    netCrore: z.number(),
  })).nullable(),
  participantOi: z.array(z.object({
    category: z.enum(["Client", "DII", "FII", "Pro"]),
    futureIndexLong: z.number().int().nonnegative(),
    futureIndexShort: z.number().int().nonnegative(),
    optionIndexCallLong: z.number().int().nonnegative(),
    optionIndexPutLong: z.number().int().nonnegative(),
    optionIndexCallShort: z.number().int().nonnegative(),
    optionIndexPutShort: z.number().int().nonnegative(),
  })).nullable(),
  sectorPerformance: z.array(z.object({
    instrumentId: z.string().min(1),
    label: z.string().min(1),
    close: z.number().positive(),
    change: z.number(),
    changePct: z.number(),
  })).nullable(),
});
export type EodIntelligenceData = z.infer<typeof EodIntelligenceDataSchema>;
export const EodIntelligencePanelSchema = panel(EodIntelligenceDataSchema);

/** Gross minus charges must equal net exactly -- this is the "explicit accounting
 * math" requirement, enforced at parse time rather than trusted from the caller.
 * chargesPaise/netPaise are nullable: neither broker adapter has a real
 * per-trade charges source yet (holdings/positions/margins calls don't carry
 * one), so a true value is unknown, not zero -- rendering ₹0 would claim a
 * fully reconciled net that was never actually computed. Likewise
 * baseCapital.amountPaise is nullable: there is no strategy/deployment
 * capital configuration yet, so "base capital" has no real value to report
 * (the account's current available margin is a different concept and must
 * not stand in for it). */
export const PnlDataSchema = z
  .object({
    period: z.string().min(1),
    currency: z.literal("INR"),
    baseCapital: z.object({
      context: z.enum(["paper", "live"]),
      amountPaise: paise().nonnegative().nullable(),
    }),
    realisedPaise: paise(),
    unrealisedPaise: paise(),
    grossPaise: paise(),
    chargesPaise: paise().nonnegative().nullable(),
    netPaise: paise().nullable(),
    valuationAsOf: z.iso.datetime().nullable(),
    reconciliationStatus: z.enum(["provisional", "reconciled", "revised"]),
    // Multi-session performance stats (day win rate, max drawdown, Sharpe),
    // derived from a persisted history of prior sessions' gross P&L -- see
    // session-performance.ts. Optional: absent for a per-provider PnlData
    // before it's combined into the snapshot's final panel, and for any
    // test/fixture built before this existed.
    performance: z
      .object({
        sessionsRecorded: z.number().int().nonnegative(),
        sessionsRequiredForSharpe: z.number().int().positive(),
        // Day-level, not trade-level -- there is no per-trade win/loss data
        // in this app yet (see the UI's "Day win rate" label, chosen
        // deliberately so this never implies granularity it doesn't have).
        dayWinRatePct: z.number().min(0).max(100).nullable(),
        maxDrawdownPaise: paise().nonnegative().nullable(),
        sharpe: z.number().nullable(),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.chargesPaise === null || value.netPaise === null
        ? true
        : value.netPaise === value.grossPaise - value.chargesPaise,
    {
      message: "netPaise must equal grossPaise minus chargesPaise whenever both are known",
      path: ["netPaise"],
    },
  )
  .refine((value) => (value.chargesPaise === null ? value.netPaise === null : true), {
    message: "netPaise cannot be known when chargesPaise is unknown",
    path: ["netPaise"],
  });
export type PnlData = z.infer<typeof PnlDataSchema>;
export const PnlPanelSchema = panel(PnlDataSchema);

export const HoldingRowSchema = z.object({
  instrumentToken: z.number().int().positive().optional(),
  priceAsOf: z.iso.datetime().optional(),
  fresh: z.boolean().optional(),
  details: z.record(z.string(), z.union([z.string(),z.number().finite(),z.boolean(),z.null()])).optional(),
  provider: z.string().min(1),
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  quantity: z.number(),
  pledgedQuantity: z.number().nullable(),
  marketValuePaise: paise(),
  isin: z.string().nullable().optional(),
  exchange: z.string().nullable().optional(),
  averagePaise: paise().nullable().optional(),
  ltpPaise: paise().nullable().optional(),
  investedPaise: paise().nullable().optional(),
  dayPnlPaise: paise().nullable().optional(),
  unrealizedPaise: paise().nullable().optional(),
});
export const HoldingsDataSchema = z.object({
  holdings: z.array(HoldingRowSchema),
  collateralPaise: paise().nonnegative(),
  usedMarginPaise: paise().nonnegative(),
  availableMarginPaise: paise(),
  brokerBalances: z.array(z.object({
    provider: z.string(), accountId: z.string(), availableMarginPaise: paise(),
    usedMarginPaise: paise(), collateralPaise: paise(), asOf: z.iso.datetime(),
  })).optional(),
  accountAsOf: z.iso.datetime().nullable(),
  valuationAsOf: z.iso.datetime().nullable(),
});
export type HoldingsData = z.infer<typeof HoldingsDataSchema>;
export const HoldingsPanelSchema = panel(HoldingsDataSchema);

export const PositionRowSchema = z.object({
  details: z.record(z.string(), z.union([z.string(),z.number().finite(),z.boolean(),z.null()])).optional(),
  provider: z.string(), accountId: z.string(), instrumentToken: z.number().int().positive(),
  exchange: z.string(), symbol: z.string(), product: z.string(), quantity: z.number(),
  multiplier: z.number().positive(), averagePrice: z.number(), lastPrice: z.number(),
  previousClose: z.number().positive().nullable().optional(),
  pnlPaise: paise(), mtmPaise: paise().nullable().optional(), asOf: z.iso.datetime(), fresh: z.boolean(),
});
export type PositionRow = z.infer<typeof PositionRowSchema>;
export const PositionsPanelSchema = panel(z.array(PositionRowSchema));
export const BrokerOrdersPanelSchema = panel(z.array(z.object({
  details: z.record(z.string(), z.union([z.string(),z.number().finite(),z.boolean(),z.null()])).optional(),
  orderId: z.string(), symbol: z.string(), exchange: z.string(), product: z.string(),
  side: z.string(), status: z.string(), quantity: z.number(), filledQuantity: z.number(),
  averagePrice: z.number(),
})));

export const MarketStreamSchema = z.object({
  status: z.enum(["connecting", "streaming", "stale", "reconnecting", "unavailable"]),
  lastTickAt: z.iso.datetime().nullable(), displayIntervalMs: z.number(),
  accountIntervalMs: z.number(), reason: z.string().nullable(),
});

export const DeploymentDataSchema = z.object({
  deploymentId: z.string().nullable(),
  scope: z.string().nullable(),
  workerStatus: z.enum(["running", "stopped", "unknown"]),
  grantStatus: z.enum(["granted", "expired", "revoked", "none"]),
  armedUntil: z.iso.datetime().nullable(),
  scheduledAt: z.iso.datetime().nullable(),
  lastOutcome: z.string().nullable(),
});
export type DeploymentData = z.infer<typeof DeploymentDataSchema>;
export const DeploymentPanelSchema = panel(DeploymentDataSchema);

/** The four mandatory pre-trade checks. Fixed keys, not an array: every panel must
 * report on all four, an omission is not the same as "not applicable". */
const CheckResultSchema = z.object({
  status: z.enum(["passed", "failed", "not_applicable", "unknown"]),
  reason: z.string().nullable(),
});
export const ReadinessDataSchema = z
  .object({
    checks: z.object({
      totp: CheckResultSchema,
      priceFeed: CheckResultSchema,
      brokerSessions: CheckResultSchema,
      riskLimits: CheckResultSchema,
    }),
    liveTradeEligible: z.boolean(),
  })
  .refine(
    (value) => {
      // One-directional: all four checks passing is necessary for
      // liveTradeEligible=true, but not sufficient -- deployment
      // authorization, kill-switch state and risk admission are separate
      // concerns this schema doesn't model yet, and any of them can
      // legitimately keep eligibility false even with a clean checklist.
      // The reverse (forcing eligible=true whenever checks pass) is wrong:
      // it would reject the safe, common state of "technically ready, but
      // not authorized to trade."
      if (!value.liveTradeEligible) {
        return true;
      }
      return Object.values(value.checks).every((check) => check.status === "passed");
    },
    {
      message: "liveTradeEligible can only be true when all four checks have passed",
      path: ["liveTradeEligible"],
    },
  );
export type ReadinessData = z.infer<typeof ReadinessDataSchema>;
export const ReadinessPanelSchema = panel(ReadinessDataSchema);

/** Per-source feed diagnostics, replacing a single connected/disconnected pill.
 * A streaming source must report its own tick latency; a merely-connected
 * (poll-based) source has none to report. */
export const ConnectionEntrySchema = z
  .object({
    source: z.string().min(1),
    status: z.enum([
      "streaming",
      "connected",
      "degraded",
      "session_expired",
      "session_ended",
      "partially_connected",
    ]),
    latencyMs: z.number().int().nonnegative().nullable(),
    asOf: z.iso.datetime(),
  })
  .refine((value) => (value.status === "streaming" ? value.latencyMs !== null : true), {
    message: "a streaming connection must report a latency",
    path: ["latencyMs"],
  });
export type ConnectionEntry = z.infer<typeof ConnectionEntrySchema>;
export const ConnectionsDataSchema = z.array(ConnectionEntrySchema);
export const ConnectionsPanelSchema = panel(ConnectionsDataSchema);

export const ActivityEventSchema = z.object({
  eventId: z.string().min(1),
  occurredAt: z.iso.datetime(),
  scope: z.string().min(1),
  description: z.string().min(1),
});
export const ActivityDataSchema = z.object({
  events: z.array(ActivityEventSchema),
  allowedActions: z.array(z.string()),
  haltState: z.enum(["none", "halt-new-entries", "flatten", "full-freeze"]),
  residualExposure: z.boolean(),
});
export type ActivityData = z.infer<typeof ActivityDataSchema>;
export const ActivityPanelSchema = panel(ActivityDataSchema);
