import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { recordSessionGrossPnl, loadSessionPerformance, SHARPE_MIN_SESSIONS } from "./session-performance.js";

const WORKSPACE = "ws-session-performance-test";

let store: Store;

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

afterEach(async () => {
  await store.transaction((query) => query("DELETE FROM session_pnl_history WHERE workspace_id=$1", [WORKSPACE]));
});

afterAll(async () => {
  await store.close();
});

describe("loadSessionPerformance -- no history", () => {
  it("reports zero sessions and every stat null, never a fabricated number", async () => {
    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance).toEqual({
      sessionsRecorded: 0,
      sessionsRequiredForSharpe: SHARPE_MIN_SESSIONS,
      dayWinRatePct: null,
      maxDrawdownPaise: null,
      sharpe: null,
    });
  });

  it("preserves but excludes legacy rows that have no verified coverage marker", async () => {
    await store.transaction((query) => query(
      "INSERT INTO session_pnl_history (workspace_id, trading_day, gross_paise) VALUES ($1,$2,$3)",
      [WORKSPACE, "2026-09-20", 99_000],
    ));

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sessionsRecorded).toBe(0);
  });
});

describe("recordSessionGrossPnl", () => {
  it("is idempotent per (workspace, trading_day) -- a later read updates, not duplicates", async () => {
    await store.transaction((query) => recordSessionGrossPnl(query, WORKSPACE, "2026-09-21", 10_000));
    await store.transaction((query) => recordSessionGrossPnl(query, WORKSPACE, "2026-09-21", 25_000));

    const rows = await store.transaction((query) =>
      query<{ gross_paise: string }>("SELECT gross_paise::text FROM session_pnl_history WHERE workspace_id=$1", [WORKSPACE]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gross_paise).toBe("25000");
  });
});

describe("loadSessionPerformance -- with history", () => {
  it("computes a day win rate from a mix of winning/losing sessions", async () => {
    for (const [day, gross] of [
      ["2026-09-15", 5_000],
      ["2026-09-16", -2_000],
      ["2026-09-17", 3_000],
      ["2026-09-18", -1_000],
    ] as const) {
      await store.transaction((query) => recordSessionGrossPnl(query, WORKSPACE, day, gross));
    }

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sessionsRecorded).toBe(4);
    expect(performance.dayWinRatePct).toBe(50);
  });

  it("does not report a max drawdown with only one recorded session", async () => {
    await store.transaction((query) => recordSessionGrossPnl(query, WORKSPACE, "2026-09-21", 5_000));

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sessionsRecorded).toBe(1);
    expect(performance.maxDrawdownPaise).toBeNull();
  });

  it("computes max drawdown as the largest peak-to-trough decline in cumulative gross P&L", async () => {
    // Cumulative: 10000, 16000, 6000 (peak 16000, trough 6000 -> drawdown 10000), 11000
    for (const [day, gross] of [
      ["2026-09-01", 10_000],
      ["2026-09-02", 6_000],
      ["2026-09-03", -10_000],
      ["2026-09-04", 5_000],
    ] as const) {
      await store.transaction((query) => recordSessionGrossPnl(query, WORKSPACE, day, gross));
    }

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.maxDrawdownPaise).toBe(10_000);
  });

  it("withholds Sharpe below the minimum session count and reports the gap instead of guessing", async () => {
    for (let day = 1; day <= SHARPE_MIN_SESSIONS - 1; day++) {
      await store.transaction((query) =>
        recordSessionGrossPnl(query, WORKSPACE, `2026-08-${String(day).padStart(2, "0")}`, 1_000),
      );
    }

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sessionsRecorded).toBe(SHARPE_MIN_SESSIONS - 1);
    expect(performance.sharpe).toBeNull();
  });

  it("computes a Sharpe ratio once the minimum session count is reached", async () => {
    for (let day = 1; day <= SHARPE_MIN_SESSIONS; day++) {
      const gross = day % 2 === 0 ? 2_000 : -500;
      await store.transaction((query) =>
        recordSessionGrossPnl(query, WORKSPACE, `2026-07-${String(day).padStart(2, "0")}`, gross),
      );
    }

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sessionsRecorded).toBe(SHARPE_MIN_SESSIONS);
    expect(performance.sharpe).not.toBeNull();
    expect(typeof performance.sharpe).toBe("number");
  });

  it("never reports a Sharpe ratio when returns have zero variance (flat series)", async () => {
    for (let day = 1; day <= SHARPE_MIN_SESSIONS; day++) {
      await store.transaction((query) =>
        recordSessionGrossPnl(query, WORKSPACE, `2026-06-${String(day).padStart(2, "0")}`, 1_000),
      );
    }

    const performance = await store.transaction((query) => loadSessionPerformance(query, WORKSPACE));

    expect(performance.sharpe).toBeNull();
  });
});
