import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OverviewSnapshotSchema } from "@nraialgo/contracts";
import { buildServer } from "../../../backend/nodejs/src/server.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../../../backend/nodejs/src/database/database.js";
import { loginTestUser } from "../support/auth.js";

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

describe("GET /v1/overview", () => {
  it("requires an authenticated session -- an anonymous caller gets 401, never account data", async () => {
    const app = buildServer(store);

    const response = await app.inject({ method: "GET", url: "/v1/overview" });

    expect(response.statusCode).toBe(401);
  });

  it("returns a schema-valid snapshot scoped to the authenticated session's own workspace", async () => {
    const app = buildServer(store);
    const { cookie, workspaceId } = await loginTestUser(app, store, "overview-default@example.com");

    const response = await app.inject({ method: "GET", url: "/v1/overview", headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = OverviewSnapshotSchema.parse(response.json());
    expect(body.scope).toEqual({
      workspaceId,
      accountId: `acct-${workspaceId}`,
      exchange: "NSE",
      segment: "EQ",
      context: "LIVE",
    });
  });

  it("rejects a context of PAPER -- this endpoint has no simulated data source, only real broker reads", async () => {
    const app = buildServer(store);
    const { cookie } = await loginTestUser(app, store, "overview-paper@example.com");

    const response = await app.inject({ method: "GET", url: "/v1/overview?context=PAPER", headers: { cookie } });

    expect(response.statusCode).toBe(400);
  });

  it("reports the account-dependent panels honestly as unavailable -- no broker session exists for a fresh user", async () => {
    const app = buildServer(store);
    const { cookie } = await loginTestUser(app, store, "overview-unavailable@example.com");

    const response = await app.inject({ method: "GET", url: "/v1/overview", headers: { cookie } });
    const body = OverviewSnapshotSchema.parse(response.json());

    // session and prices depend only on the calendar/NSE archives, not an
    // account, so their exact status varies with real wall-clock time and
    // whatever the ambient "NSE"/"EQ" calendar happens to have seeded --
    // see build-overview-snapshot.test.ts for their deterministic coverage
    // against a controlled calendar and a fixed date.
    expect(body.readiness.status).toBe("available");
    expect(body.readiness.data?.liveTradeEligible).toBe(false);
    // Each panel is unavailable for its own distinct, real reason -- see
    // build-overview-snapshot.test.ts for per-panel coverage.
    for (const panel of [body.pnl, body.holdings, body.deployment, body.connections, body.activity]) {
      expect(panel.status).toBe("unavailable");
      expect(panel.data).toBeNull();
      expect(panel.reason).toBeTruthy();
    }
  });

  it("ignores a client-supplied workspaceId/accountId query parameter -- scope only ever comes from the session", async () => {
    const app = buildServer(store);
    const { cookie, workspaceId } = await loginTestUser(app, store, "overview-cross-workspace@example.com");

    const response = await app.inject({
      method: "GET",
      url: "/v1/overview?workspaceId=someone-elses-workspace&accountId=someone-elses-account",
      headers: { cookie },
    });

    const body = OverviewSnapshotSchema.parse(response.json());
    expect(body.scope.workspaceId).toBe(workspaceId);
    expect(body.scope.workspaceId).not.toBe("someone-elses-workspace");
  });

  it("two different users never resolve to the same workspace", async () => {
    const app = buildServer(store);
    const a = await loginTestUser(app, store, "overview-user-a@example.com");
    const b = await loginTestUser(app, store, "overview-user-b@example.com");

    expect(a.workspaceId).not.toBe(b.workspaceId);
  });

  it("never records session P&L history when there is no broker session to derive it from", async () => {
    const app = buildServer(store);
    const { cookie, workspaceId } = await loginTestUser(app, store, "overview-no-history@example.com");

    await app.inject({ method: "GET", url: "/v1/overview", headers: { cookie } });

    const rows = await store.transaction((query) =>
      query("SELECT 1 FROM session_pnl_history WHERE workspace_id=$1", [workspaceId]),
    );
    expect(rows).toHaveLength(0);
  });
});
