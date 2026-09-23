import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../database.js";
import { readLocalPostgresConfiguration } from "../local-database.js";
import { hashPassword, verifyPassword, setUserPassword, createSession, resolveSession } from "../auth.js";
import type { Query } from "../database.js";

let store: Store;

describe("first-user setup", () => {
  it("requires the setup key, hashes the password, and closes after the first user", async () => {
    vi.stubEnv("INITIAL_SETUP_TOKEN", "a".repeat(64));
    let saved: { email: string; hash: string } | undefined;
    const statements: string[] = [];
    // Serialized transactions model the users-table lock without touching real accounts.
    let pending = Promise.resolve();
    const query: Query = async <T>(sql: string, params?: (string | number | boolean | null)[]) => {
      statements.push(sql);
      if (sql.startsWith("SELECT id FROM users")) return (saved ? [{ id: "first" }] : []) as T[];
      if (sql.startsWith("INSERT INTO users")) saved = { email: String(params![0]), hash: String(params![1]) };
      return [];
    };
    const fakeStore: Store = {
      transaction(fn) { const result = pending.then(() => fn(query)); pending = result.then(() => undefined, () => undefined); return result; },
      async close() {},
    };
    const app = buildServer(fakeStore);
    const payload = { email: " OWNER@example.com ", password: "a-long-secret-password", setupToken: "a".repeat(64) };
    try {
      expect((await app.inject({ method: "GET", url: "/v1/auth/setup" })).json()).toEqual({ needsSetup: true, setupEnabled: true });
      const badKey = await app.inject({ method: "POST", url: "/v1/auth/setup", payload: { ...payload, setupToken: "b".repeat(64) } });
      expect(badKey.statusCode).toBe(403);
      expect(saved).toBeUndefined();
      expect((await app.inject({ method: "POST", url: "/v1/auth/setup", payload: { ...payload, password: "short" } })).statusCode).toBe(400);
      const results = await Promise.all([1, 2].map(() => app.inject({ method: "POST", url: "/v1/auth/setup", payload })));
      expect(results.map(r => r.statusCode).sort()).toEqual([201, 409]);
      expect(saved?.email).toBe("owner@example.com");
      expect(await verifyPassword(payload.password, saved!.hash)).toBe(true);
      expect(statements.filter(sql => sql.startsWith("INSERT"))).toHaveLength(1);
      const lock = statements.indexOf("LOCK TABLE users IN EXCLUSIVE MODE");
      expect(statements[lock + 1]).toBe("SELECT id FROM users LIMIT 1");
      expect(statements[lock + 2]).toMatch(/^INSERT INTO users/);
      expect((await app.inject({ method: "GET", url: "/v1/auth/setup" })).json()).toEqual({ needsSetup: false, setupEnabled: false });
    } finally { await app.close(); vi.unstubAllEnvs(); }
  });

  it("disables setup without an operator key and rate limits attempts", async () => {
    vi.stubEnv("INITIAL_SETUP_TOKEN", "");
    const fakeStore: Store = { async transaction(fn) { return fn(async () => []); }, async close() {} };
    const app = buildServer(fakeStore);
    try {
      const status = await app.inject({ method: "GET", url: "/v1/auth/setup" });
      expect(status.headers["cache-control"]).toBe("no-store");
      expect(status.json()).toEqual({ needsSetup: true, setupEnabled: false });
      const results = [];
      for (let i = 0; i < 6; i++) results.push((await app.inject({ method: "POST", url: "/v1/auth/setup", payload: {} })).statusCode);
      expect(results).toEqual([403, 403, 403, 403, 403, 429]);
    } finally { await app.close(); vi.unstubAllEnvs(); }
  });
});

beforeAll(async () => {
  const local = readLocalPostgresConfiguration();
  const migrationStore = openDatabaseStore(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? local?.adminUrl);
  try {
    await runDatabaseMigrations(migrationStore, {
      runtimePassword: process.env.TEST_DATABASE_RUNTIME_PASSWORD ?? (process.env.DATABASE_URL ? undefined : local?.applicationPassword),
    });
  } finally {
    await migrationStore.close();
  }
  store = openDatabaseStore();
});

afterAll(async () => {
  await store.close();
});

async function createUser(email: string, password: string) {
  const hash = await hashPassword(password);
  await store.transaction((query) =>
    query(
      `INSERT INTO users (email, password_hash) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
      [email, hash],
    ),
  );
}

describe("POST /v1/auth/login", () => {
  it("revokes old sessions and prevents an in-flight old-password login after reset", async () => {
    const email = "reset-regression@example.com";
    await setUserPassword(store, email, "old-long-password");
    const [user] = await store.transaction(q => q<{id:string;password_hash:string}>("SELECT id,password_hash FROM users WHERE email=$1", [email]));
    const session = await createSession(store, user!.id, user!.password_hash);
    expect(await resolveSession(store, session.token)).not.toBeNull();
    await setUserPassword(store, email, "new-long-password");
    expect(await resolveSession(store, session.token)).toBeNull();
    await expect(createSession(store, user!.id, user!.password_hash)).rejects.toThrow("Sign in again");
  });
  it("bounds asynchronous password work without blocking the event loop", async () => {
    let timerRan = false;
    const timer = new Promise<void>(resolve => setTimeout(() => { timerRan = true; resolve(); }, 0));
    const jobs = Array.from({length:5}, () => hashPassword("test-long-password"));
    const results = await Promise.allSettled(jobs);
    expect(timerRan).toBe(true);
    await timer;
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(4);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await verifyPassword("test-long-password", await hashPassword("test-long-password"))).toBe(true);
  });
  it("limits account attempts even when callers change IP addresses", async () => {
    const app = buildServer(store);
    try {
      for (let i=0; i<11; i++) {
        const response = await app.inject({method:"POST",url:"/v1/auth/login",remoteAddress:`192.0.2.${i+1}`,payload:{email:"limited@example.com",password:"invalid-password"}});
        expect(response.statusCode).toBe(i<10 ? 401 : 429);
      }
    } finally { await app.close(); }
  });
  it("rejects an unknown email with a generic message, not 'no such user'", async () => {
    const app = buildServer(store);

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "nobody@example.com", password: "whatever12345" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Invalid email or password.");
  });

  it("rejects a wrong password with the same generic message", async () => {
    const app = buildServer(store);
    await createUser("login-wrong-password@example.com", "the-real-password-123");

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "login-wrong-password@example.com", password: "not-the-right-one" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().message).toBe("Invalid email or password.");
  });

  it("sets an HttpOnly session cookie on success and /v1/auth/me then resolves it", async () => {
    const app = buildServer(store);
    await createUser("login-success@example.com", "a-genuinely-good-password");

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "login-success@example.com", password: "a-genuinely-good-password" },
    });

    expect(login.statusCode).toBe(200);
    const sessionCookie = login.cookies.find((cookie) => cookie.name === "nraialgo_session");
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: `${sessionCookie!.name}=${sessionCookie!.value}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe("login-success@example.com");
  });

  it("is rate-limited -- repeated failed attempts eventually get a 429, not unlimited guesses", async () => {
    const app = buildServer(store);
    await createUser("login-rate-limited@example.com", "the-real-password-999");

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/auth/login",
          payload: { email: "login-rate-limited@example.com", password: "guess" },
        }),
      ),
    );

    expect(attempts.some((response) => response.statusCode === 429)).toBe(true);
  });
});

describe("GET /v1/auth/me", () => {
  it("rejects an anonymous caller", async () => {
    const app = buildServer(store);

    const response = await app.inject({ method: "GET", url: "/v1/auth/me" });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /v1/auth/logout", () => {
  it("invalidates the session so it can no longer authenticate anything", async () => {
    const app = buildServer(store);
    await createUser("logout@example.com", "a-genuinely-good-password");
    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "logout@example.com", password: "a-genuinely-good-password" },
    });
    const cookie = `nraialgo_session=${login.cookies.find((c) => c.name === "nraialgo_session")!.value}`;

    const logout = await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(204);

    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});
