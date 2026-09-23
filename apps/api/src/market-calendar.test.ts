import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { resolveSessionState, seedNseCalendar } from "./market-calendar.js";

/** Uses a distinct exchange so this test never collides with calendar rows a
 * developer already seeded for real "NSE" data via `npm run db:setup`. */
const EXCHANGE = "TEST";
const SEGMENT = "EQ";

let store: Store;

/** Migrations run over an admin-privileged connection, exactly like `db:setup` --
 * the test suite must not need the app role to have schema-creation rights any
 * more than the running API does. In CI, DATABASE_URL's single role already owns
 * the service database, so it doubles as both. */
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

beforeEach(async () => {
  await store.transaction(async (query) => {
    await query("DELETE FROM market_calendar WHERE exchange=$1", [EXCHANGE]);
    await seedNseCalendar(query, {
      from: new Date("2026-09-18T00:00:00Z"), // Fri 18th IST
      days: 6, // through Wed 23rd IST
      exchange: EXCHANGE,
      segment: SEGMENT,
    });
  });
});

afterAll(async () => {
  await store.transaction((query) =>
    query("DELETE FROM market_calendar WHERE exchange=$1", [EXCHANGE]),
  );
  await store.close();
});

function istInstant(iso: string): Date {
  return new Date(iso);
}

describe("resolveSessionState", () => {
  it("resolves market-open during NSE hours on a seeded weekday", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2026-09-21T05:00:00Z"), // Mon 10:30 IST
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("market-open");
    expect(state.calendarValid).toBe(true);
    expect(state.sessionId).toBe("2026-09-21");
  });

  it("resolves pre-open between 09:00 and 09:15 IST", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2026-09-21T03:31:00Z"), // Mon 09:01 IST
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("pre-open");
  });

  it("resolves after-close before pre-open and reports today as next session", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2026-09-21T03:00:00Z"), // Mon 08:30 IST
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("after-close");
    expect(state.nextSession).toBe("2026-09-21");
  });

  it("resolves after-close post-close and reports the next trading day", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2026-09-21T10:10:00Z"), // Mon 15:40 IST
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("after-close");
    expect(state.nextSession).toBe("2026-09-22");
    expect(state.lastCompletedSession).toBe("2026-09-21");
  });

  it("resolves weekend-holiday on Saturday and points to Monday", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2026-09-19T06:00:00Z"), // Sat 11:30 IST
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("weekend-holiday");
    expect(state.nextSession).toBe("2026-09-21");
    expect(state.lastCompletedSession).toBe("2026-09-18");
  });

  it("resolves unknown when the day has not been seeded, without guessing", async () => {
    const state = await store.transaction((query) =>
      resolveSessionState(
        query,
        istInstant("2099-01-05T05:00:00Z"),
        EXCHANGE,
        SEGMENT,
      ),
    );
    expect(state.state).toBe("unknown");
    expect(state.calendarValid).toBe(false);
  });
});

describe("seedNseCalendar -- real NSE holidays", () => {
  it("marks a real weekday exchange holiday (Republic Day 2026-01-26, a Monday) as closed, not a trading day", async () => {
    await store.transaction(async (query) => {
      await query("DELETE FROM market_calendar WHERE exchange=$1 AND trading_day='2026-01-26'", [EXCHANGE]);
      await seedNseCalendar(query, { from: new Date("2026-01-26T00:00:00Z"), days: 1, exchange: EXCHANGE, segment: SEGMENT });
    });

    const state = await store.transaction((query) =>
      resolveSessionState(query, istInstant("2026-01-26T05:00:00Z"), EXCHANGE, SEGMENT),
    );

    expect(state.state).toBe("weekend-holiday");
    expect(state.calendarValid).toBe(true);
  });

  it("does not seed (and so does not guess) a weekday in a year with no verified holiday data", async () => {
    await store.transaction(async (query) => {
      await query("DELETE FROM market_calendar WHERE exchange=$1 AND trading_day='2099-01-05'", [EXCHANGE]);
      await seedNseCalendar(query, { from: new Date("2099-01-05T00:00:00Z"), days: 1, exchange: EXCHANGE, segment: SEGMENT });
    });

    const state = await store.transaction((query) =>
      resolveSessionState(query, istInstant("2099-01-05T05:00:00Z"), EXCHANGE, SEGMENT),
    );

    // 2099-01-05 is a Monday -- the old weekday-is-always-a-trading-day
    // logic would have wrongly seeded and reported this as open/closed;
    // failing closed to "unknown" is the correct, honest answer here.
    expect(state.state).toBe("unknown");
    expect(state.calendarValid).toBe(false);
  });

  it("records the holiday calendar's source/version/import timestamp in calendar_metadata", async () => {
    const rows = await store.transaction((query) =>
      query<{ source: string; version: string }>(
        "SELECT source, version FROM calendar_metadata WHERE exchange=$1 AND segment=$2",
        [EXCHANGE, SEGMENT],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe("2026.1");
  });
});
