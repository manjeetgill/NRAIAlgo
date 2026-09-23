import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../../apps/api/src/server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../../../apps/api/src/database.js";

/** /health must never touch the database, so a store that throws on any use
 * proves that -- if this test ever needs a working stub, that itself is a
 * regression in the health route's isolation guarantee. */
const unusedStore: Store = {
  transaction() {
    throw new Error("/health must not use the database store.");
  },
  async close() {},
};

describe("GET /health", () => {
  it("reports unavailable calendar coverage when storage cannot be read", async () => {
    const app = buildServer(unusedStore);
    try {
      const response = await app.inject({method:"GET",url:"/v1/calendar-health"});
      expect(response.statusCode).toBe(503);
      expect(response.headers["cache-control"]).toBe("no-store");
    } finally { await app.close(); }
  });
  it("returns ok without touching any dependency", async () => {
    const app = buildServer(unusedStore);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });
});

describe("GET /v1/readiness", () => {
  let store: Store;

  beforeAll(async () => {

    const migrationStore = openDatabaseStore(process.env.TEST_DATABASE_ADMIN_URL);
    try {
      await runDatabaseMigrations(migrationStore, {
        runtimePassword: process.env.TEST_DATABASE_RUNTIME_PASSWORD,
      });
    } finally {
      await migrationStore.close();
    }
    store = openDatabaseStore();
  });

  afterAll(async () => {
    await store.close();
  });

  it("reports the current schema_migrations version once migrations have run", async () => {
    const app = buildServer(store);
    const [expected] = await store.transaction((query) =>
      query<{ max: number }>("SELECT MAX(version) as max FROM schema_migrations"),
    );

    const response = await app.inject({ method: "GET", url: "/v1/readiness" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", schemaVersion: expected?.max });
  });

  it("reports 503 when the database is unreachable, instead of crashing or lying", async () => {
    const brokenStore: Store = {
      transaction() {
        throw new Error("connection refused");
      },
      async close() {},
    };
    const app = buildServer(brokenStore);

    const response = await app.inject({ method: "GET", url: "/v1/readiness" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", schemaVersion: null });
  });
});
