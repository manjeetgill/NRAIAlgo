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
  calendarVersion: z.string().min(1),
  sourceWatermarks: z.object({
    accountVersion: z.number().int().nonnegative(),
    eventCursor: z.string().min(1),
  }),
  session: SessionPanelSchema,
  prices: PricesPanelSchema,
  pnl: PnlPanelSchema,
  holdings: HoldingsPanelSchema,
  deployment: DeploymentPanelSchema,
  readiness: ReadinessPanelSchema,
  connections: ConnectionsPanelSchema,
  activity: ActivityPanelSchema,
});
export type OverviewSnapshot = z.infer<typeof OverviewSnapshotSchema>;
