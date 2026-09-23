import { z } from "zod";
import { ScopeSchema } from "./common.js";
import {
  ActivityPanelSchema,
  ConnectionsPanelSchema,
  DeploymentPanelSchema,
  HoldingsPanelSchema,
  PnlPanelSchema,
  PricesPanelSchema,
  ReadinessPanelSchema,
  SessionPanelSchema,
  PositionsPanelSchema,
  MarketStreamSchema,
  BrokerOrdersPanelSchema,
  EodIntelligencePanelSchema,
} from "./panels.js";

/** The Overview screen's whole state in one response. A database snapshot is not a
 * simultaneous observation across independent brokers -- serverTime/generatedAt and
 * each panel's own asOf are what the frontend actually renders, not a single "now". */
export const OverviewSnapshotSchema = z.object({
  schemaVersion: z.number().int().positive(),
  snapshotId: z.string().min(1),
  serverTime: z.iso.datetime(),
  generatedAt: z.iso.datetime(),
  scope: ScopeSchema,
  authorizedProviders: z.array(z.enum(["zerodha", "kotak", "icici"])).optional(),
  configuredProviders: z.array(z.enum(["zerodha", "kotak", "icici"])).optional(),
  calendarVersion: z.string().min(1),
  sourceWatermarks: z.object({
    accountVersion: z.number().int().nonnegative(),
    eventCursor: z.string().min(1),
  }),
  session: SessionPanelSchema,
  prices: PricesPanelSchema,
  pnl: PnlPanelSchema,
  brokerPnl: z.object({ zerodha: PnlPanelSchema.optional(), kotak: PnlPanelSchema.optional() }).optional(),
  holdings: HoldingsPanelSchema,
  deployment: DeploymentPanelSchema,
  readiness: ReadinessPanelSchema,
  connections: ConnectionsPanelSchema,
  activity: ActivityPanelSchema,
  positions: PositionsPanelSchema.optional(),
  marketStream: MarketStreamSchema.optional(),
  brokerOrders: BrokerOrdersPanelSchema.optional(),
  eodIntelligence: EodIntelligencePanelSchema.optional(),
  // Per-provider evidence: a partial aggregate must not block a healthy broker
  // or let a failed broker borrow another broker's reconciliation timestamp.
  brokerReconciliation: z.object({
    zerodha: z.object({ accountId: z.string(), status: z.enum(["confirmed", "failed"]), asOf: z.iso.datetime().nullable() }).optional(),
    kotak: z.object({ accountId: z.string(), status: z.enum(["confirmed", "failed"]), asOf: z.iso.datetime().nullable() }).optional(),
  }).optional(),
});
export type OverviewSnapshot = z.infer<typeof OverviewSnapshotSchema>;
