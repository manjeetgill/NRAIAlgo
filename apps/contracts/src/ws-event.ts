import { z } from "zod";
import { ScopeSchema } from "./common.js";

/** WS /v1/events envelope. `streamEpoch` changing means resynchronise (refetch a
 * fresh snapshot) rather than trust further deltas; `sequence` within an epoch lets
 * the frontend detect gaps and deduplicate durable events. */
export const WsEventEnvelopeSchema = z.object({
  eventId: z.string().min(1),
  streamEpoch: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  eventType: z.enum([
    "panel-updated",
    "snapshot-invalidated",
    "scope-revoked",
  ]),
  scope: ScopeSchema,
  occurredAt: z.iso.datetime(),
  payload: z.unknown(),
});
export type WsEventEnvelope = z.infer<typeof WsEventEnvelopeSchema>;
