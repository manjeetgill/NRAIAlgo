import { z } from "zod";

/** The five states the Overview screen's main layout can render as.
 * Mirrors apps/web's MarketState; that app will import this instead of
 * defining its own once the frontend is wired to this contract. */
export const MarketStateSchema = z.enum([
  "market-open",
  "pre-open",
  "after-close",
  "weekend-holiday",
  "unknown",
]);
export type MarketState = z.infer<typeof MarketStateSchema>;

export const ScopeSchema = z.object({
  workspaceId: z.string().min(1),
  accountId: z.string().min(1),
  exchange: z.string().min(1),
  segment: z.string().min(1),
  context: z.enum(["LIVE", "PAPER"]),
});
export type Scope = z.infer<typeof ScopeSchema>;

/** Plain TS mirror of panel()'s runtime shape, for typing props/params that
 * take an already-parsed panel without re-deriving it from a zod schema. */
export type Panel<T> =
  | { status: "available"; source: string; asOf: string; version: number; data: T; reason: null }
  | { status: "degraded"; source: string; asOf: string; version: number; data: T; reason: string }
  | { status: "unavailable"; source: string; asOf: string | null; version: number; data: null; reason: string }
  | { status: "error"; source: string; asOf: string | null; version: number; data: null; reason: string };

/** Available requires data and forbids a reason; unavailable/error forbid data and
 * require a reason. A missing value is never a fabricated zero -- see the guide's
 * "never replace an unavailable value with a fabricated zero" rule.
 *
 * "degraded" sits between the two: real data exists, but it's known to be
 * incomplete -- e.g. one of several connected brokers failed mid-refresh, so
 * the combined totals only cover the brokers that actually succeeded. It
 * requires both data (never drop what did succeed) and a reason (never let
 * the gap go unstated) -- see build-overview-snapshot.ts's buildPortfolioPanels. */
export function panel<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.discriminatedUnion("status", [
    z.object({
      status: z.literal("available"),
      source: z.string().min(1),
      asOf: z.iso.datetime(),
      version: z.number().int().nonnegative(),
      data: dataSchema,
      reason: z.null(),
    }),
    z.object({
      status: z.literal("degraded"),
      source: z.string().min(1),
      asOf: z.iso.datetime(),
      version: z.number().int().nonnegative(),
      data: dataSchema,
      reason: z.string().min(1),
    }),
    z.object({
      status: z.literal("unavailable"),
      source: z.string().min(1),
      asOf: z.iso.datetime().nullable(),
      version: z.number().int().nonnegative(),
      data: z.null(),
      reason: z.string().min(1),
    }),
    z.object({
      status: z.literal("error"),
      source: z.string().min(1),
      asOf: z.iso.datetime().nullable(),
      version: z.number().int().nonnegative(),
      data: z.null(),
      reason: z.string().min(1),
    }),
  ]);
}
