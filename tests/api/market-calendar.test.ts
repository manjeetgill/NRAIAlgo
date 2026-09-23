import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "../../apps/api/src/database.js";
import { resolveSessionState, seedNseCalendar, importCalendar } from "../../apps/api/src/market-calendar.js";

/** Distinct fixture namespace inside the disposable test cluster. */
const EXCHANGE = "CAL_TEST";
const SEGMENT = "EQ";

let store: Store;

/** Migrations use the disposable cluster's admin; reads/writes use its restricted
 * application role. Local and CI runs share this same isolation boundary. */
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

beforeEach(async () => {
  await store.transaction(async (query) => {
    await query("DELETE FROM market_calendar WHERE exchange=$1", [EXCHANGE]);
    await query("DELETE FROM calendar_metadata WHERE exchange=$1", [EXCHANGE]);
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
  it("preserves explicitly imported special sessions across reseeding", async () => {
    await store.transaction(async q => {
      await importCalendar(q, {source:"https://example.com/test-calendar",version:"test-1",days:[{
        day:"2026-09-19",trading:true,reason:null,preOpen:"2026-09-19T12:00:00Z",open:"2026-09-19T12:15:00Z",close:"2026-09-19T13:15:00Z"
      }]}, EXCHANGE, SEGMENT);
      await seedNseCalendar(q, {from:new Date("2026-09-19T00:00:00Z"),days:1,exchange:EXCHANGE,segment:SEGMENT});
    });
    const state = await store.transaction(q=>resolveSessionState(q,new Date("2026-09-19T12:30:00Z"),EXCHANGE,SEGMENT));
    expect(state.state).toBe("market-open");
  });
  it("refreshes generated dates while preserving legacy/manual rows", async () => {
    await store.transaction(async q => {
      await q("UPDATE market_calendar SET is_trading_day=false,managed_version='seed:old' WHERE exchange=$1 AND trading_day='2026-09-21'",[EXCHANGE]);
      await seedNseCalendar(q,{from:new Date("2026-09-21T00:00:00Z"),days:1,exchange:EXCHANGE,segment:SEGMENT});
      const [row]=await q<{is_trading_day:boolean}>("SELECT is_trading_day FROM market_calendar WHERE exchange=$1 AND trading_day='2026-09-21'",[EXCHANGE]);
      expect(row?.is_trading_day).toBe(true);
      await q("UPDATE market_calendar SET is_trading_day=false,managed_version=NULL WHERE exchange=$1 AND trading_day='2026-09-21'",[EXCHANGE]);
      await seedNseCalendar(q,{from:new Date("2026-09-21T00:00:00Z"),days:1,exchange:EXCHANGE,segment:SEGMENT});
      const [manual]=await q<{is_trading_day:boolean}>("SELECT is_trading_day FROM market_calendar WHERE exchange=$1 AND trading_day='2026-09-21'",[EXCHANGE]);
      expect(manual?.is_trading_day).toBe(false);
    });
  });
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
