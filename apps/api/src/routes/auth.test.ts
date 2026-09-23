import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../database.js";
import { readLocalPostgresConfiguration } from "../local-database.js";
import { hashPassword } from "../auth.js";

let store: Store;

beforeAll(async () => {
  const local = readLocalPostgresConfiguration();
  const migrationStore = openDatabaseStore(process.env.DATABASE_URL ?? local?.adminUrl);
  try {
    await runDatabaseMigrations(migrationStore, {
      runtimePassword: process.env.DATABASE_URL ? undefined : local?.applicationPassword,
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
  await store.transaction((query) =>
    query(
      `INSERT INTO users (email, password_hash) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
      [email, hashPassword(password)],
    ),
  );
}

describe("POST /v1/auth/login", () => {
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
