import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "../database/database.js";
import { redeemAccessCode } from "../account-access.js";
import {
  createSession,
  destroySession,
  hashPassword,
  resolveSession,
  verifyPassword,
  SESSION_COOKIE_NAME,
  type AuthIdentity,
} from "../auth.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthIdentity;
  }
}

const loginBody = z.object({ email: z.string().trim().toLowerCase().min(1).max(320), password: z.string().min(1).max(1024) }).strict();
const setupBody = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(256),
  setupToken: z.string().min(32).max(256),
}).strict();

function setupKey() {
  const key = process.env.INITIAL_SETUP_TOKEN;
  return key && key.length >= 32 && key.length <= 256 ? key : undefined;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/** Public-only routes: logging in is how a session is created in the first
 * place, so this cannot itself require one. Rate-limited tightly since it's
 * the one endpoint an attacker could use to guess a password. */
export function authRoutes(store: Store) {
  return async function routes(app: FastifyInstance): Promise<void> {
    const attempts = new Map<string, { count: number; until: number }>();
    // Per-account bound supplements the existing IP limiter, including unknown users.
    function accountAllowed(email: string) {
      const now = Date.now();
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
      const key = createHash("sha256").update(email).digest("hex");
      const value = attempts.get(key);
      if (!value) {
        if (attempts.size >= 10_000) return false;
        attempts.set(key, {count: 1, until: now + 60_000}); return true;
      }
      return ++value.count <= 10;
    }
    app.get("/v1/auth/setup", async (_request, reply) => {
      reply.header("Cache-Control", "no-store");
      const users = await store.transaction(query => query("SELECT id FROM users LIMIT 1"));
      return { needsSetup: users.length === 0, setupEnabled: users.length === 0 && !!setupKey() };
    });

    app.post("/v1/auth/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const key = setupKey();
      if (!key) return reply.forbidden("First-user setup is disabled. Contact your deployment administrator.");
      const body = setupBody.safeParse(request.body);
      if (!body.success) return reply.badRequest("Provide a valid email, a 12–256 character password and the setup key.");
      const digest = (value: string) => createHash("sha256").update(value).digest();
      if (!timingSafeEqual(digest(key), digest(body.data.setupToken))) return reply.forbidden("Invalid setup key.");
      const passwordHash = await hashPassword(body.data.password);
      const created = await store.transaction(async query => {
        // Serializes first-user creation across API processes AND CLI inserts.
        // READ COMMITTED sees a competing committed insert after acquiring this lock.
        await query("LOCK TABLE users IN EXCLUSIVE MODE");
        if ((await query("SELECT id FROM users LIMIT 1")).length) return false;
        await query("INSERT INTO users (email, password_hash) VALUES ($1,$2)", [body.data.email, passwordHash]);
        return true;
      });
      if (!created) return reply.conflict("Setup is already complete. Sign in with your existing account.");
      // Separate sign-in keeps a failed session write from leaving ambiguous setup state.
      return reply.code(201).send({ created: true });
    });

    app.post(
      "/v1/auth/login",
      { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const body = loginBody.safeParse(request.body);
        if (!body.success) {
          return reply.badRequest("Email and password are required.");
        }
        if (!accountAllowed(body.data.email)) return reply.code(429).header("Retry-After", "60").send({ message: "Too many login attempts; retry later." });
        const rows = await store.transaction((query) =>
          query<{ id: string; password_hash: string }>(
            "SELECT id, password_hash FROM users WHERE email=$1",
            [body.data.email],
          ),
        );
        const user = rows[0];
        // Same generic message either way -- never reveal whether the email
        // itself is registered.
        const valid = await verifyPassword(body.data.password, user?.password_hash ?? `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`);
        if (!user || !valid) {
          return reply.unauthorized("Invalid email or password.");
        }
        const { token, expiresAt } = await createSession(store, user.id, user.password_hash);
        reply.setCookie(SESSION_COOKIE_NAME, token, { ...cookieOptions(), expires: expiresAt });
        return { email: body.data.email };
      },
    );

    for (const purpose of ["invite", "reset"] as const) {
      app.post(`/v1/auth/${purpose === "invite" ? "register" : "reset-password"}`, { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
        reply.header("Cache-Control", "no-store");
        const body = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(12).max(256), code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().safeParse(request.body);
        if (!body.success) return reply.badRequest("Provide an email, a 12–256 character password and a valid access code.");
        if (!accountAllowed(body.data.email)) return reply.code(429).header("Retry-After", "60").send({ message: "Too many attempts; retry later." });
        const redeemed = await redeemAccessCode(store, body.data.email, purpose, body.data.code, body.data.password);
        if (!redeemed) return reply.badRequest("Invalid or expired code. Ask the owner for a new code for this email and action.");
        reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
        return reply.code(purpose === "invite" ? 201 : 200).send({ completed: true });
      });
    }

    app.post("/v1/auth/logout", async (request, reply) => {
      const token = request.cookies[SESSION_COOKIE_NAME];
      if (token) {
        await destroySession(store, token);
      }
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.code(204).send();
    });

    app.get("/v1/auth/me", { preHandler: requireAuth(store) }, async (request) => ({
      email: request.auth!.email,
    }));
  };
}

/** Attach to any route group's encapsulated context (Fastify scopes
 * addHook/preHandler to the plugin it's registered in) to require a valid
 * session before every route in that group runs. Sets request.auth so
 * handlers derive workspaceId/accountId from the authenticated identity,
 * never from a client-supplied query parameter. */
export function requireAuth(store: Store) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.header("Cache-Control", "no-store");
    const token = request.cookies[SESSION_COOKIE_NAME];
    const identity = token ? await resolveSession(store, token) : null;
    if (!identity) {
      return reply.unauthorized("Sign in required.");
    }
    request.auth = identity;
  };
}

export { hashPassword };
