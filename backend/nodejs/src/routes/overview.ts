import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { OverviewSnapshot, Scope } from "@nraialgo/contracts";
import type { Store } from "../database/database.js";
import type { credentialVault } from "../credential-vault.js";
import { buildOverviewSnapshot, loadOverviewInputs } from "../build-overview-snapshot.js";
import { requireAuth } from "./auth.js";
import { LiveOverview } from "../market-data/live-overview.js";
import { KotakLiveOverview } from "../market-data/kotak-live-overview.js";
import { recordSessionGrossPnl } from "../session-performance.js";

const scopeQuery = z.object({
  exchange: z.literal("NSE").default("NSE"),
  segment: z.literal("EQ").default("EQ"),
  // "PAPER" is deliberately not an accepted value here: pnl/holdings always
  // read a real broker session's real positions -- there is no simulated
  // data source behind this endpoint. Defaulting (or letting a caller pass)
  // context=PAPER would let live account data render as if simulated.
  // Paper trading, if built, needs its own data source and its own route.
  context: z.literal("LIVE").default("LIVE"),
});

const CACHE_TTL_MS = 10_000; // account REST reconciliation, not tick cadence

export function isFullyReconciledForPerformance(snapshot: OverviewSnapshot): boolean {
  const configuredProviders = snapshot.configuredProviders ?? [];
  return snapshot.pnl.status === "available" && configuredProviders.length > 0 && configuredProviders.every(provider =>
    provider !== "icici" && snapshot.brokerReconciliation?.[provider]?.status === "confirmed",
  );
}

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
  // only: correctness here just needs "don't hammer the broker every second
  // per tab," not cross-replica consistency. Deploy one API feed owner.
  const live = new LiveOverview();
  const kotakLive = new KotakLiveOverview();
  const cache = new Map<string, { expiresAt: number; usedAt: number; retryAt?: number; snapshot?: OverviewSnapshot; promise?: Promise<OverviewSnapshot> }>();

  async function buildCachedSnapshot(scope: Scope): Promise<OverviewSnapshot> {
    const now = Date.now();
    let cached = cache.get(scope.workspaceId);
    if (!cached) {
      cached = { expiresAt: 0, usedAt: now };
      cache.set(scope.workspaceId, cached);
    }
    cached.usedAt = now;
    const entry = cached;
    if (!entry.promise && (entry.retryAt === undefined || entry.retryAt <= now) && (entry.expiresAt <= now || ((live.needsReconciliation(scope.workspaceId) || kotakLive.needsReconciliation(scope.workspaceId)) && entry.expiresAt - now < CACHE_TTL_MS - 2000))) {
      delete entry.retryAt;
      entry.promise = (async () => {
      // Short transaction: only PostgreSQL reads + in-memory decryption.
      // The connection is released back to the pool before any NSE/broker
      // network call happens below -- see build-overview-snapshot.ts's own
      // header comment for why this split exists.
      const inputs = await store.transaction((query) => loadOverviewInputs(query, vault, scope, new Date()));
      live.ensure(scope.workspaceId, inputs.zerodha);
      kotakLive.ensure(scope.workspaceId, inputs.kotak);
      const zerodhaVersion = live.reconciliationVersion(scope.workspaceId);
      const kotakVersion = kotakLive.reconciliationVersion(scope.workspaceId);
      const snapshot = await buildOverviewSnapshot(inputs, new Date(), scope);
      if (snapshot.brokerReconciliation?.zerodha?.status === 'confirmed' && snapshot.brokerReconciliation.zerodha.accountId === inputs.zerodha?.accountId) live.reconciled(scope.workspaceId, zerodhaVersion);
      if (snapshot.brokerReconciliation?.kotak?.status === 'confirmed' && snapshot.brokerReconciliation.kotak.accountId === inputs.kotak?.accountId) kotakLive.reconciled(scope.workspaceId, kotakVersion);
      // Record today's gross P&L against its trading day once the session
      // has actually closed -- never mid-day, which would freeze a partial
      // figure. Upserts, so it keeps refining as evening reconciliation
      // continues (see market-closed-screen's own "reconciliation
      // continues after market close"). Never blocks the response.
      const closedState = snapshot.session.data?.state === "after-close" || snapshot.session.data?.state === "weekend-holiday";
      const tradingDay = snapshot.session.data?.lastCompletedSession;
      if (closedState && tradingDay && snapshot.pnl.data && isFullyReconciledForPerformance(snapshot)) {
        const grossPaise = snapshot.pnl.data.grossPaise;
        await store
          .transaction((query) => recordSessionGrossPnl(query, scope.workspaceId, tradingDay, grossPaise))
          .catch(() => {});
      }
      entry.snapshot = snapshot;
      entry.expiresAt = Date.now() + CACHE_TTL_MS;
      return snapshot;
      })().finally(() => { delete entry.promise; });
      // Initial request observes the error; background refresh retains the
      // previous snapshot (with its original timestamps), never an unhandled rejection.
      void entry.promise.catch(() => { entry.retryAt = entry.expiresAt = Date.now() + 2000; });
    }
    const unavailable = () => Object.assign(new Error('Overview temporarily unavailable; retry shortly.'), {statusCode:503});
    // A cold-cache failure leaves a retry cooldown but no snapshot/promise.
    // Return a controlled unavailable response; never pass undefined to overlays.
    const base = entry.snapshot ?? (entry.promise ? await entry.promise.catch(() => { throw unavailable(); }) : undefined);
    if (!base) throw unavailable();
    return kotakLive.overlay(live.overlay(base));
  }

  return async function routes(app: FastifyInstance): Promise<void> {
    const cleanup = setInterval(() => {
      live.prune();
      kotakLive.prune();
      for (const [key, entry] of cache) if (Date.now() - entry.usedAt > 60_000 && !entry.promise) cache.delete(key);
    }, 10_000);
    cleanup.unref();
    app.addHook("onClose", async () => { clearInterval(cleanup); live.close(); kotakLive.close(); cache.clear(); });
    app.addHook("preHandler", requireAuth(store));

    app.get("/v1/overview", async (request, reply) => {
      reply.header("Cache-Control", "no-store, private");
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
