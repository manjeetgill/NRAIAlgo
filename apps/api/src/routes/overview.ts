import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OverviewSnapshot, Scope } from "@nraialgo/contracts";
import type { Store } from "../database.js";
import type { credentialVault } from "../credential-vault.js";
import { buildOverviewSnapshot, loadOverviewInputs } from "../build-overview-snapshot.js";
import { requireAuth } from "./auth.js";

const scopeQuery = z.object({
  exchange: z.string().min(1).default("NSE"),
  segment: z.string().min(1).default("EQ"),
  // "PAPER" is deliberately not an accepted value here: pnl/holdings always
  // read a real broker session's real positions -- there is no simulated
  // data source behind this endpoint. Defaulting (or letting a caller pass)
  // context=PAPER would let live account data render as if simulated.
  // Paper trading, if built, needs its own data source and its own route.
  context: z.literal("LIVE").default("LIVE"),
});

const CACHE_TTL_MS = 10_000; // shorter than the frontend's 15s poll interval

/** GET /v1/overview: the whole Overview screen in one response.
 * workspaceId/accountId now come from the authenticated session
 * (request.auth, set by requireAuth) -- never from a client-supplied query
 * parameter, which would let any caller read any workspace's broker data.
 */
export function overviewRoutes(store: Store, vault: ReturnType<typeof credentialVault>) {
  // Keyed by workspaceId (not the whole scope -- exchange/segment/context
  // are effectively fixed today), so a short poll burst from several
  // browser tabs on the same workspace shares one upstream NSE/broker
  // refresh instead of each tab triggering its own. Deliberately in-process
  // only: correctness here just needs "don't hammer the broker every 15s
  // per tab," not cross-replica consistency.
  const cache = new Map<string, { expiresAt: number; promise: Promise<OverviewSnapshot> }>();

  async function buildCachedSnapshot(scope: Scope): Promise<OverviewSnapshot> {
    const cached = cache.get(scope.workspaceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }
    const promise = (async () => {
      // Short transaction: only PostgreSQL reads + in-memory decryption.
      // The connection is released back to the pool before any NSE/broker
      // network call happens below -- see build-overview-snapshot.ts's own
      // header comment for why this split exists.
      const inputs = await store.transaction((query) => loadOverviewInputs(query, vault, scope, new Date()));
      return buildOverviewSnapshot(inputs, new Date(), scope);
    })();
    cache.set(scope.workspaceId, { expiresAt: Date.now() + CACHE_TTL_MS, promise });
    // A failed attempt must not poison the cache for the next poll -- clear
    // it immediately so the next request tries again instead of replaying
    // the same rejection for the rest of the TTL window.
    promise.catch(() => cache.delete(scope.workspaceId));
    return promise;
  }

  return async function routes(app: FastifyInstance): Promise<void> {
    app.addHook("preHandler", requireAuth(store));

    app.get("/v1/overview", async (request, reply) => {
      const parsed = scopeQuery.safeParse(request.query);
      if (!parsed.success) {
        return reply.badRequest("Invalid scope parameters.");
      }
      const scope: Scope = {
        workspaceId: request.auth!.workspaceId,
        accountId: request.auth!.accountId,
        ...parsed.data,
      };
      return buildCachedSnapshot(scope);
    });
  };
}
