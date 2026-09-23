import sensible from "@fastify/sensible";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { healthRoutes, readinessRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { alphaWireRoutes } from "./routes/alpha-wire.js";
import { overviewRoutes } from "./routes/overview.js";
import { brokerCredentialsRoutes } from "./routes/broker-credentials.js";
import { brokerAuthRoutes } from "./routes/broker-auth.js";
import type { Store } from "./database/database.js";
import { credentialVault } from "./credential-vault.js";
import type { exchangeZerodhaRequestToken } from "./broker-auth/zerodha.js";
import type { kotakDailyLogin } from "./broker-auth/kotak.js";
import type { iciciLogin, iciciAccount } from "./broker-auth/icici.js";

/**
 * Builds a Fastify instance without binding a port.
 *
 * Kept separate from main.ts specifically so tests can exercise routes
 * through `.inject()` -- no listening socket, no port conflicts between
 * parallel test runs, and no risk of a test accidentally making a real
 * network call.
 *
 * Takes the database Store and credential vault as explicit dependencies
 * rather than opening its own connection/key, so tests can inject a real
 * store (integration) or a stub (routes that never touch it, like /health).
 */
export function buildServer(
  store: Store,
  vault = credentialVault(),
  brokerAuthDeps: {
    exchangeZerodhaRequestToken?: typeof exchangeZerodhaRequestToken;
    kotakDailyLogin?: typeof kotakDailyLogin;
    iciciLogin?: typeof iciciLogin;
    iciciAccount?: typeof iciciAccount;
  } = {},
): FastifyInstance {
  const app = Fastify({
    trustProxy: process.env.TRUST_PROXY === "1" ? (_address, hop) => hop === 0 : false,
    requestTimeout: 30_000,
    bodyLimit: 64 * 1024,
    logger: {
      serializers: {
        // OAuth callbacks contain single-use tokens: never log query strings,
        // authorization headers, cookies or request bodies.
        req: request => ({ method: request.method, url: request.url.split("?")[0] ?? "/", remoteAddress: request.ip }),
        ...(process.env.NODE_ENV === "production" ? { err: () => ({ type: "Error", stack: "", message: "Operation failed; sensitive error details withheld" }) } : {}),
      },
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"],
    },
  });

  app.register(sensible);
  app.register(cookie);
  // Cookie-authenticated mutations must not be triggered by another website.
  // Non-browser clients without Origin remain supported; browser cross-site
  // requests are rejected even when their body is otherwise valid JSON.
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    const origin = request.headers.origin;
    const expected = process.env.FRONTEND_ORIGIN ?? "http://localhost:3010";
    if (request.headers["sec-fetch-site"] === "cross-site" || (origin !== undefined && origin !== expected)) {
      return reply.code(403).send({ message: "Cross-origin request rejected." });
    }
  });
  // Global backstop, keyed by IP (no authenticated principal exists yet to
  // key on instead). Login/credential routes set their own much tighter
  // per-route limits below -- this default just caps ordinary polling/reads.
  app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  app.register(healthRoutes);
  app.register(readinessRoutes(store));
  app.register(authRoutes(store));
  app.register(alphaWireRoutes(store));
  app.register(overviewRoutes(store, vault));
  app.register(brokerCredentialsRoutes(store, vault));
  app.register(brokerAuthRoutes(store, vault, brokerAuthDeps));

  return app;
}
