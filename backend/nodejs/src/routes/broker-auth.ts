import type { FastifyInstance } from "fastify";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "../database/database.js";
import type { credentialVault } from "../credential-vault.js";
import { createZerodhaLoginUrl, exchangeZerodhaRequestToken, nextKiteExpiry } from "../broker-auth/zerodha.js";
import { kotakDailyLogin, kotakSessionExpiry, KotakLoginError } from "../broker-auth/kotak.js";
import { requireAuth } from "./auth.js";
import { iciciCredentials, iciciSession, iciciLogin, iciciAccount } from "../broker-auth/icici.js";
import { IciciLiveMarket } from "../market-data/icici-live.js";
import { resolveSession, SESSION_COOKIE_NAME } from "../auth.js";

const zerodhaAppCredentials = z.object({ apiKey: z.string(), apiSecret: z.string() });
const kotakAppCredentials = z.object({ accessToken: z.string(), mobileNumber: z.string(), ucc: z.string() });
const kotakLoginBody = z
  .object({
    totp: z.string().trim().regex(/^\d{6}$/),
    mpin: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3010";
const API_PUBLIC_ORIGIN = process.env.API_PUBLIC_ORIGIN ?? "http://localhost:4000";
const ZERODHA_CALLBACK_PATH = "/v1/broker-auth/zerodha/callback";

/**
 * Step 2 (daily authorization). Setup (step 1, broker-credentials.ts) must
 * already have saved app-level credentials -- this only ever authenticates
 * against them, never accepts new credentials itself.
 *
 * workspaceId comes from the authenticated session (request.auth, set by
 * requireAuth) everywhere except the OAuth callback itself, which Zerodha
 * calls directly with no cookie of ours attached -- there the pending
 * state token (opaque, single-use, tied to the workspace at login-url time)
 * is what proves which workspace this callback belongs to.
 *
 * Honest limitation: this is built against the documented/proven protocol
 * (Kite Connect's own SDK; Kotak's two real endpoints, verified against
 * AlgoTrade's working client) but has not been exercised against a live
 * Zerodha or Kotak account in this environment -- there are no real broker
 * credentials available to test with here.
 */
export function brokerAuthRoutes(
  store: Store,
  vault: ReturnType<typeof credentialVault>,
  deps: {
    exchangeZerodhaRequestToken?: typeof exchangeZerodhaRequestToken;
    kotakDailyLogin?: typeof kotakDailyLogin;
    iciciLogin?: typeof iciciLogin;
    iciciAccount?: typeof iciciAccount;
    iciciLive?: IciciLiveMarket;
  } = {},
) {
  const exchangeZerodha = deps.exchangeZerodhaRequestToken ?? exchangeZerodhaRequestToken;
  const kotakLogin = deps.kotakDailyLogin ?? kotakDailyLogin;
  const iciciLive = deps.iciciLive ?? new IciciLiveMarket();

  function hashState(state: string): string {
    return createHash("sha256").update(state).digest("hex");
  }

  // CSRF-style state, scoped to workspace, not to an app-user session (none
  // exists yet). Stored in PostgreSQL (only the hash, like sessions'
  // token_hash), not an in-memory Map: a Map is process-local, so it's lost
  // on restart and a callback routed to a different replica than the one
  // that issued the state would be wrongly rejected as "never issued". A
  // login attempt has 10 minutes to complete.
  async function createPendingZerodhaLogin(workspaceId: string): Promise<string> {
    const state = randomBytes(32).toString("base64url");
    await store.transaction((query) =>
      query(
        `INSERT INTO zerodha_oauth_state (state_hash, workspace_id, expires_at) VALUES ($1,$2,$3)`,
        [hashState(state), workspaceId, new Date(Date.now() + 600_000).toISOString()],
      ),
    );
    return state;
  }

  /** Atomically deletes and returns the pending state row in one statement,
   * so two concurrent callbacks for the same state (a retried browser
   * request, a replayed URL) can never both succeed -- only the first
   * DELETE actually removes (and thus returns) the row. */
  async function consumePendingZerodhaLogin(state: string): Promise<{ workspaceId: string } | null> {
    const [row] = await store.transaction((query) =>
      query<{ workspace_id: string }>(
        `DELETE FROM zerodha_oauth_state WHERE state_hash=$1 AND expires_at > now() RETURNING workspace_id`,
        [hashState(state)],
      ),
    );
    return row ? { workspaceId: row.workspace_id } : null;
  }

  async function loadAppCredentials<T>(workspaceId: string, provider: string, schema: z.ZodType<T>): Promise<T | null> {
    const [row] = await store.transaction((query) =>
      query<{ ciphertext: string }>(
        "SELECT ciphertext FROM broker_app_credentials WHERE workspace_id=$1 AND provider=$2",
        [workspaceId, provider],
      ),
    );
    if (!row) {
      return null;
    }
    return schema.parse(vault.open(`${workspaceId}:${provider}`, row.ciphertext));
  }

  async function saveSession(workspaceId: string, provider: string, session: unknown, expiresAt: Date, expectedCredentials: unknown) {
    const ciphertext = vault.seal(`${workspaceId}:${provider}:session`, session);
    await store.transaction(async (query) => {
      const [current] = await query<{ ciphertext: string }>(
        "SELECT ciphertext FROM broker_app_credentials WHERE workspace_id=$1 AND provider=$2 FOR UPDATE", [workspaceId, provider]);
      // A credential rotation during the external login must not resurrect an
      // old session. The row lock serializes this check with credential updates.
      if (!current || JSON.stringify(vault.open(`${workspaceId}:${provider}`, current.ciphertext)) !== JSON.stringify(expectedCredentials)) {
        throw new Error("Broker credentials changed during authorization; retry");
      }
      await query(
        `INSERT INTO broker_sessions (workspace_id, provider, ciphertext, expires_at, updated_at)
         VALUES ($1,$2,$3,$4,now())
         ON CONFLICT (workspace_id, provider)
         DO UPDATE SET ciphertext=EXCLUDED.ciphertext, expires_at=EXCLUDED.expires_at, updated_at=now()`,
        [workspaceId, provider, ciphertext, expiresAt.toISOString()],
      );
    });
  }

  const accountReads = new Map<string, { key: string; until: number; pending: ReturnType<typeof iciciAccount> }>();
  return async function routes(app: FastifyInstance): Promise<void> {
    const liveConnections = new Set<() => void>();
    const pruneLive = setInterval(() => iciciLive.prune(), 10_000); pruneLive.unref();
    app.addHook("preClose", async () => { for (const close of [...liveConnections]) close(); });
    app.addHook("onClose", async () => { clearInterval(pruneLive); iciciLive.close(); });
    // The Zerodha OAuth callback is the one route in this group that must
    // stay public: Zerodha's own server calls it directly, with no session
    // cookie of ours. It authenticates itself via the pending `state` token
    // instead (see the route below), not via requireAuth.
    app.addHook("preHandler", async (request, reply) => {
      if (request.routeOptions.url === "/v1/broker-auth/zerodha/callback") {
        return;
      }
      await requireAuth(store)(request, reply);
    });

    app.get("/v1/broker-auth/zerodha/redirect-url", async () => ({
      url: new URL(ZERODHA_CALLBACK_PATH, API_PUBLIC_ORIGIN).href,
    }));

    app.get(
      "/v1/broker-auth/zerodha/login-url",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const workspaceId = request.auth!.workspaceId;
        const credentials = await loadAppCredentials(workspaceId, "zerodha", zerodhaAppCredentials);
        if (!credentials) {
          return reply.badRequest("Save Zerodha app credentials (step 1) before authorizing.");
        }
        const state = await createPendingZerodhaLogin(workspaceId);
        try {
          return { url: createZerodhaLoginUrl(credentials.apiKey, state) };
        } catch (error) {
          request.log.error({ err: error }, "Could not build the Zerodha login URL");
          return reply.internalServerError("Could not build the Zerodha login URL.");
        }
      },
    );

    app.get<{ Querystring: { request_token?: string; state?: string; status?: string } }>(
      "/v1/broker-auth/zerodha/callback",
      // Guessing/replaying `state` values is exactly the attack this limits.
      { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const { request_token: requestToken, state, status } = request.query;
        const pending = state ? await consumePendingZerodhaLogin(state) : null;
        if (!pending || status !== "success" || !requestToken) {
          return reply.redirect(`${FRONTEND_ORIGIN}/app/broker-connections?zerodha_auth=error`, 302);
        }
        const credentials = await loadAppCredentials(pending.workspaceId, "zerodha", zerodhaAppCredentials);
        if (!credentials) {
          return reply.redirect(`${FRONTEND_ORIGIN}/app/broker-connections?zerodha_auth=error`, 302);
        }
        try {
          const session = await exchangeZerodha(credentials.apiKey, credentials.apiSecret, requestToken);
          await saveSession(pending.workspaceId, "zerodha", session, nextKiteExpiry(new Date()), credentials);
          return reply.redirect(`${FRONTEND_ORIGIN}/app/broker-connections?zerodha_auth=success`, 302);
        } catch (error) {
          // The redirect never carries broker error detail (it could leak
          // into browser history/referrer headers) -- but silently
          // swallowing it server-side too makes a real failure
          // undiagnosable, so log it here.
          request.log.error({ err: error }, "Zerodha request_token exchange failed");
          return reply.redirect(`${FRONTEND_ORIGIN}/app/broker-connections?zerodha_auth=error`, 302);
        }
      },
    );

    app.post(
      "/v1/broker-auth/kotak/login",
      // MPIN/TOTP brute-force target -- the tightest limit in this file.
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = kotakLoginBody.safeParse(request.body);
        if (!body.success) {
          return reply.badRequest("Invalid request.");
        }
        const workspaceId = request.auth!.workspaceId;
        const credentials = await loadAppCredentials(workspaceId, "kotak", kotakAppCredentials);
        if (!credentials) {
          return reply.badRequest("Save Kotak app credentials (step 1) before authorizing.");
        }
        try {
          const session = await kotakLogin({ ...credentials, ...body.data });
          await saveSession(workspaceId, "kotak", session, kotakSessionExpiry(new Date()), credentials);
          return reply.code(204).send();
        } catch (error) {
          if (error instanceof KotakLoginError) {
            // A genuine credential rejection (wrong TOTP/MPIN) is the
            // caller's error -- 400 is right here.
            return reply.badRequest(error.message);
          }
          request.log.error({ err: error }, "Kotak authorization failed unexpectedly");
          // Everything else (a network error, a non-2xx from Kotak, a
          // timeout) is Kotak's outage, not something the caller did wrong
          // -- a 400 would wrongly suggest retrying with different input
          // fixes it. 504 for an explicit timeout, 502 for anything else
          // that reached (or failed to reach) the broker.
          const timedOut = error instanceof Error && /timed out|abort/i.test(error.message);
          return reply.code(timedOut ? 504 : 502).send({
            message: timedOut ? "Kotak did not respond in time. Try again shortly." : "Kotak is currently unreachable. Try again shortly.",
          });
        }
      },
    );

    app.get("/v1/broker-auth/icici/login-url", async (request, reply) => {
      const credentials = await loadAppCredentials(request.auth!.workspaceId, "icici", iciciCredentials);
      if (!credentials) return reply.badRequest("Save ICICI app credentials first.");
      const url = new URL("https://api.icicidirect.com/apiuser/login");
      url.searchParams.set("api_key", credentials.apiKey);
      return { url: url.href };
    });

    app.post("/v1/broker-auth/icici/login", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
      const body = z.object({ sessionToken: z.string().trim().min(1).max(4096) }).strict().safeParse(request.body);
      if (!body.success) return reply.badRequest("Enter the Breeze API session token.");
      const workspaceId = request.auth!.workspaceId;
      const credentials = await loadAppCredentials(workspaceId, "icici", iciciCredentials);
      if (!credentials) return reply.badRequest("Save ICICI app credentials first.");
      try {
        const session = await (deps.iciciLogin ?? iciciLogin)(credentials, body.data.sessionToken);
        // Conservative application cap; this is not a claim about broker token TTL.
        const now = new Date();
        const istDay = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
        const expiry = new Date(new Date(`${istDay}T00:00:00+05:30`).getTime() + 86_400_000);
        await saveSession(workspaceId, "icici", session, expiry, credentials);
        return reply.code(204).send();
      } catch {
        return reply.code(502).send({ message: "ICICI authorization failed. Check your app credentials and fresh API session token, then retry." });
      }
    });

    app.get("/v1/broker-auth/icici/account", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
      const workspaceId = request.auth!.workspaceId;
      const credentials = await loadAppCredentials(workspaceId, "icici", iciciCredentials);
      const [row] = await store.transaction((query) => query<{ ciphertext: string }>(
        "SELECT ciphertext FROM broker_sessions WHERE workspace_id=$1 AND provider=$2 AND expires_at > now()", [workspaceId, "icici"]));
      if (!credentials || !row) { iciciLive.disconnect(workspaceId); return reply.code(409).send({ message: "ICICI is not authorized. Connect it in Broker Gateways." }); }
      const session = iciciSession.parse(vault.open(`${workspaceId}:icici:session`, row.ciphertext));
      // Authorize on every request; coalesce tabs only within the same workspace/session.
      const key = createHash("sha256").update(row.ciphertext + JSON.stringify(credentials)).digest("hex");
      const cached = accountReads.get(workspaceId);
      if (cached && cached.key === key && cached.until > Date.now()) return cached.pending;
      if (accountReads.size >= 200) {
        for (const [id, entry] of accountReads) if (entry.until <= Date.now()) accountReads.delete(id);
      }
      const pending = (deps.iciciAccount ?? iciciAccount)(credentials, session).then(data => {
        const positions = data.sections.portfoliopositions?.rows ?? [];
        iciciLive.ensure(workspaceId, session, positions);
        return data;
      });
      if (accountReads.size < 200 || cached) {
        const entry = { key, until: Date.now() + 10000, pending };
        accountReads.set(workspaceId, entry);
        void pending.catch(() => { if (accountReads.get(workspaceId) === entry) accountReads.delete(workspaceId); });
      }
      return pending;
    });

    app.get("/v1/broker-auth/icici/stream", async (request, reply) => {
      if (liveConnections.size >= 100) return reply.code(503).send({ message: "ICICI live stream capacity reached." });
      const workspaceId = request.auth!.workspaceId;
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform, private", "X-Accel-Buffering": "no", Connection: "keep-alive" });
      raw.flushHeaders();
      let stopped = false; let busy = false; let scheduled: ReturnType<typeof setTimeout> | undefined;
      const send = async (validate = false) => {
        if (stopped || busy) return; busy = true;
        try {
          if (validate) {
            const token = request.cookies[SESSION_COOKIE_NAME];
            const auth = token ? await resolveSession(store, token) : null;
            if (!auth || auth.workspaceId !== workspaceId) { close(); return; }
          }
          const snapshot = iciciLive.snapshot(workspaceId);
          if (raw.writableLength > 256_000) close();
          else raw.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
        } catch { close(); }
        finally { busy = false; }
      };
      const schedule = () => { if (!scheduled) scheduled = setTimeout(() => { scheduled = undefined; void send(); }, 500); };
      const unsubscribe = iciciLive.subscribe(workspaceId, schedule);
      const heartbeat = setInterval(() => { void send(true); }, 15_000); heartbeat.unref();
      const close = () => { if (stopped) return; stopped = true; clearInterval(heartbeat); clearTimeout(scheduled); unsubscribe(); liveConnections.delete(close); raw.end(); };
      liveConnections.add(close); raw.on("close", close); raw.write("retry: 5000\n\n"); void send();
    });

    /** Whether each provider has a live, unexpired session -- never the session itself. */
    app.get("/v1/broker-auth/status", async (request) => {
      const workspaceId = request.auth!.workspaceId;
      const rows = await store.transaction((query) =>
        query<{ provider: string; expires_at: string }>(
          "SELECT provider, expires_at FROM broker_sessions WHERE workspace_id=$1 AND expires_at > now()",
          [workspaceId],
        ),
      );
      return {
        zerodha: rows.find((row) => row.provider === "zerodha")?.expires_at ?? null,
        kotak: rows.find((row) => row.provider === "kotak")?.expires_at ?? null,
        icici: rows.find((row) => row.provider === "icici")?.expires_at ?? null,
      };
    });
  };
}
