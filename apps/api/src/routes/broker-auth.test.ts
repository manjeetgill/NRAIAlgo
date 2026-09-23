import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../database.js";
import { readLocalPostgresConfiguration } from "../local-database.js";
import { credentialVault } from "../credential-vault.js";
import { KotakLoginError } from "../broker-auth/kotak.js";
import { loginTestUser } from "../test-support/auth.js";

const vault = credentialVault({ CREDENTIAL_VAULT_KEY: "d".repeat(64) } as NodeJS.ProcessEnv);

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

async function saveAppCredentials(
  app: ReturnType<typeof buildServer>,
  cookie: string,
  provider: string,
  payload: Record<string, unknown>,
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/broker-credentials/${provider}`,
    headers: { cookie },
    payload,
  });
  expect(response.statusCode).toBe(204);
}

describe("GET /v1/broker-auth/zerodha/login-url", () => {
  it("rejects an anonymous caller", async () => {
    const app = buildServer(store, vault);

    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/zerodha/login-url" });

    expect(response.statusCode).toBe(401);
  });

  it("rejects when step 1 (app credentials) has not been saved", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "auth-login-url-no-creds@example.com");

    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/zerodha/login-url", headers: { cookie } });

    expect(response.statusCode).toBe(400);
  });

  it("returns a real kite.zerodha.com login URL once step 1 is saved", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "auth-login-url@example.com");
    await saveAppCredentials(app, cookie, "zerodha", { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" });

    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/zerodha/login-url", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const url = new URL(response.json().url);
    expect(url.hostname).toBe("kite.zerodha.com");
    expect(url.searchParams.get("api_key")).toBe("my_api_key");
  });
});

describe("GET /v1/broker-auth/zerodha/callback", () => {
  it("is reachable without a session -- Zerodha calls this directly, with no cookie of ours", async () => {
    const app = buildServer(store, vault);

    const response = await app.inject({
      method: "GET",
      url: "/v1/broker-auth/zerodha/callback?state=never-issued&status=success&request_token=x",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("zerodha_auth=error");
  });

  it("exchanges the request token and saves a session on a genuine callback", async () => {
    const app = buildServer(store, vault, {
      exchangeZerodhaRequestToken: async () => ({
        accessToken: "the-access-token",
        userId: "AB1234",
        userName: "Test User",
      }),
    });
    const { cookie } = await loginTestUser(app, store, "auth-callback-success@example.com");
    await saveAppCredentials(app, cookie, "zerodha", { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" });
    const loginUrlResponse = await app.inject({ method: "GET", url: "/v1/broker-auth/zerodha/login-url", headers: { cookie } });
    const state = new URL(loginUrlResponse.json().url).searchParams
      .get("redirect_params")!
      .replace("state=", "");

    const callback = await app.inject({
      method: "GET",
      url: `/v1/broker-auth/zerodha/callback?state=${state}&status=success&request_token=rt`,
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("zerodha_auth=success");

    const status = await app.inject({ method: "GET", url: "/v1/broker-auth/status", headers: { cookie } });
    expect(status.json().zerodha).not.toBeNull();
  });

  it("cannot replay the same state twice", async () => {
    const app = buildServer(store, vault, {
      exchangeZerodhaRequestToken: async () => ({ accessToken: "t", userId: "u", userName: "n" }),
    });
    const { cookie } = await loginTestUser(app, store, "auth-callback-replay@example.com");
    await saveAppCredentials(app, cookie, "zerodha", { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" });
    const loginUrlResponse = await app.inject({ method: "GET", url: "/v1/broker-auth/zerodha/login-url", headers: { cookie } });
    const state = new URL(loginUrlResponse.json().url).searchParams
      .get("redirect_params")!
      .replace("state=", "");
    await app.inject({
      method: "GET",
      url: `/v1/broker-auth/zerodha/callback?state=${state}&status=success&request_token=rt`,
    });

    const replay = await app.inject({
      method: "GET",
      url: `/v1/broker-auth/zerodha/callback?state=${state}&status=success&request_token=rt`,
    });

    expect(replay.headers.location).toContain("zerodha_auth=error");
  });

  it("a pending state issued by one server instance is still honored by a brand-new instance -- survives a restart/different replica", async () => {
    const issuingApp = buildServer(store, vault);
    const { cookie } = await loginTestUser(issuingApp, store, "auth-callback-restart@example.com");
    await saveAppCredentials(issuingApp, cookie, "zerodha", { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" });
    const loginUrlResponse = await issuingApp.inject({
      method: "GET",
      url: "/v1/broker-auth/zerodha/login-url",
      headers: { cookie },
    });
    const state = new URL(loginUrlResponse.json().url).searchParams
      .get("redirect_params")!
      .replace("state=", "");

    // A separate buildServer() call -- an in-memory Map would start empty
    // here and reject this as "never issued"; the state lives in
    // PostgreSQL, so a different process/replica can still consume it.
    const handlingApp = buildServer(store, vault, {
      exchangeZerodhaRequestToken: async () => ({ accessToken: "t", userId: "u", userName: "n" }),
    });
    const callback = await handlingApp.inject({
      method: "GET",
      url: `/v1/broker-auth/zerodha/callback?state=${state}&status=success&request_token=rt`,
    });

    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toContain("zerodha_auth=success");
  });
});

describe("POST /v1/broker-auth/kotak/login", () => {
  it("rejects an anonymous caller", async () => {
    const app = buildServer(store, vault);

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      payload: { totp: "123456", mpin: "654321" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("rejects when step 1 has not been saved", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "auth-kotak-no-creds@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "123456", mpin: "654321" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("saves a session on a successful two-step login", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => ({ token: "t", sid: "s", baseUrl: "https://neo.example" }),
    });
    const { cookie } = await loginTestUser(app, store, "auth-kotak-success@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "123456", mpin: "654321" },
    });

    expect(response.statusCode).toBe(204);
    const status = await app.inject({ method: "GET", url: "/v1/broker-auth/status", headers: { cookie } });
    expect(status.json().kotak).not.toBeNull();
  });

  it("surfaces the broker's rejection reason on a failed login, not a generic error", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => {
        throw new KotakLoginError("MPIN_VERIFY", "Kotak rejected the MPIN.");
      },
    });
    const { cookie } = await loginTestUser(app, store, "auth-kotak-rejected@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "123456", mpin: "000000" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Kotak rejected the MPIN.");
  });

  it("rejects a malformed TOTP/MPIN before ever calling the broker", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "auth-kotak-malformed@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "12", mpin: "654321" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 502 (not 400) when Kotak itself is unreachable -- the caller's input wasn't the problem", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => {
        throw new Error("fetch failed: ECONNREFUSED");
      },
    });
    const { cookie } = await loginTestUser(app, store, "auth-kotak-network-error@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "123456", mpin: "654321" },
    });

    expect(response.statusCode).toBe(502);
  });

  it("returns 504 (not 400) when the Kotak call times out", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => {
        throw new Error("Kotak request timed out after 8000ms");
      },
    });
    const { cookie } = await loginTestUser(app, store, "auth-kotak-timeout@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie },
      payload: { totp: "123456", mpin: "654321" },
    });

    expect(response.statusCode).toBe(504);
  });

  it("is rate-limited to 5/min -- repeated login attempts eventually get 429, not unlimited MPIN guesses", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => {
        throw new KotakLoginError("MPIN_VERIFY", "Kotak rejected the MPIN.");
      },
    });
    const { cookie } = await loginTestUser(app, store, "auth-kotak-rate-limited@example.com");
    await saveAppCredentials(app, cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.inject({
          method: "POST",
          url: "/v1/broker-auth/kotak/login",
          headers: { cookie },
          payload: { totp: "123456", mpin: "000000" },
        }),
      ),
    );

    expect(attempts.some((response) => response.statusCode === 429)).toBe(true);
  });
});

describe("GET /v1/broker-auth/status", () => {
  it("rejects an anonymous caller", async () => {
    const app = buildServer(store, vault);

    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/status" });

    expect(response.statusCode).toBe(401);
  });

  it("reports both providers as no-session for a fresh user with nothing authorized", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "auth-status-fresh@example.com");

    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/status", headers: { cookie } });

    expect(response.json()).toEqual({ zerodha: null, kotak: null });
  });

  it("one user's session never sees another user's broker session status", async () => {
    const app = buildServer(store, vault, {
      kotakDailyLogin: async () => ({ token: "t", sid: "s", baseUrl: "https://neo.example" }),
    });
    const alice = await loginTestUser(app, store, "auth-status-alice@example.com");
    const bob = await loginTestUser(app, store, "auth-status-bob@example.com");
    await saveAppCredentials(app, alice.cookie, "kotak", { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" });
    await app.inject({
      method: "POST",
      url: "/v1/broker-auth/kotak/login",
      headers: { cookie: alice.cookie },
      payload: { totp: "123456", mpin: "654321" },
    });

    const bobStatus = await app.inject({ method: "GET", url: "/v1/broker-auth/status", headers: { cookie: bob.cookie } });

    expect(bobStatus.json()).toEqual({ zerodha: null, kotak: null });
  });
});
