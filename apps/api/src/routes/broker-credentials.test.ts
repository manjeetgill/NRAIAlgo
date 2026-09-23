import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../database.js";
import { readLocalPostgresConfiguration } from "../local-database.js";
import { credentialVault } from "../credential-vault.js";
import { loginTestUser } from "../test-support/auth.js";

let store: Store;
const vault = credentialVault({ CREDENTIAL_VAULT_KEY: "c".repeat(64) } as NodeJS.ProcessEnv);

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

describe("POST /v1/broker-credentials/:provider", () => {
  it("rejects an anonymous caller -- never accepts or reveals credentials without a session", async () => {
    const app = buildServer(store, vault);

    const saveResponse = await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      payload: { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" },
    });
    const statusResponse = await app.inject({ method: "GET", url: "/v1/broker-credentials/status" });

    expect(saveResponse.statusCode).toBe(401);
    expect(statusResponse.statusCode).toBe(401);
  });

  it("saves valid Zerodha credentials and reports the provider as configured", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "credentials-zerodha@example.com");

    const saveResponse = await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      headers: { cookie },
      payload: { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" },
    });
    expect(saveResponse.statusCode).toBe(204);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/v1/broker-credentials/status",
      headers: { cookie },
    });
    const status = statusResponse.json();
    expect(status.zerodha).not.toBeNull();
    expect(status.kotak).toBeNull();
  });

  it("saves valid Kotak credentials", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "credentials-kotak@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/kotak",
      headers: { cookie },
      payload: { accessToken: "abcdefgh", mobileNumber: "+919876543210", ucc: "ABC123" },
    });

    expect(response.statusCode).toBe(204);
  });

  it("rejects an unknown provider", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "credentials-unknown-provider@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/upstox",
      headers: { cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("rejects a Kotak mobile number that isn't a valid +91 number", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "credentials-bad-mobile@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/kotak",
      headers: { cookie },
      payload: { accessToken: "abcdefgh", mobileNumber: "9876543210", ucc: "ABC123" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("never returns the saved secret back in any response", async () => {
    const app = buildServer(store, vault);
    const { cookie } = await loginTestUser(app, store, "credentials-no-leak@example.com");
    await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      headers: { cookie },
      payload: { apiKey: "my_api_key", apiSecret: "a_very_long_api_secret_value" },
    });

    const statusResponse = await app.inject({
      method: "GET",
      url: "/v1/broker-credentials/status",
      headers: { cookie },
    });

    expect(statusResponse.body).not.toContain("a_very_long_api_secret_value");
  });

  it("overwrites a previous save for the same provider rather than duplicating it", async () => {
    const app = buildServer(store, vault);
    const { cookie, workspaceId } = await loginTestUser(app, store, "credentials-overwrite@example.com");
    await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      headers: { cookie },
      payload: { apiKey: "first_key", apiSecret: "a_very_long_api_secret_value" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      headers: { cookie },
      payload: { apiKey: "second_key", apiSecret: "another_long_api_secret_value" },
    });

    const rows = await store.transaction((query) =>
      query("SELECT * FROM broker_app_credentials WHERE workspace_id=$1 AND provider='zerodha'", [
        workspaceId,
      ]),
    );
    expect(rows).toHaveLength(1);
  });

  it("one user's session can never read or write another user's credential status", async () => {
    const app = buildServer(store, vault);
    const alice = await loginTestUser(app, store, "credentials-alice@example.com");
    const bob = await loginTestUser(app, store, "credentials-bob@example.com");

    await app.inject({
      method: "POST",
      url: "/v1/broker-credentials/zerodha",
      headers: { cookie: alice.cookie },
      payload: { apiKey: "alices_key", apiSecret: "alices_very_long_api_secret" },
    });

    const bobStatus = (
      await app.inject({ method: "GET", url: "/v1/broker-credentials/status", headers: { cookie: bob.cookie } })
    ).json();

    expect(bobStatus.zerodha).toBeNull();
  });
});
