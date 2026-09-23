import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Store } from "../database.js";
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

const loginBody = z.object({ email: z.string().trim().toLowerCase().min(1), password: z.string().min(1) }).strict();
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
      const passwordHash = hashPassword(body.data.password);
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
        const rows = await store.transaction((query) =>
          query<{ id: string; password_hash: string }>(
            "SELECT id, password_hash FROM users WHERE email=$1",
            [body.data.email],
          ),
        );
        const user = rows[0];
        // Same generic message either way -- never reveal whether the email
        // itself is registered.
        if (!user || !verifyPassword(body.data.password, user.password_hash)) {
          return reply.unauthorized("Invalid email or password.");
        }
        const { token, expiresAt } = await createSession(store, user.id);
        reply.setCookie(SESSION_COOKIE_NAME, token, { ...cookieOptions(), expires: expiresAt });
        return { email: body.data.email };
      },
    );

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
    const token = request.cookies[SESSION_COOKIE_NAME];
    const identity = token ? await resolveSession(store, token) : null;
    if (!identity) {
      return reply.unauthorized("Sign in required.");
    }
    request.auth = identity;
  };
}

export { hashPassword };
