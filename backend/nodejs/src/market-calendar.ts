/** NSE equity-segment calendar, backed by PostgreSQL instead of hard-coded hours.
 *
 * This replaces the frontend's ad hoc resolveMockMarketState (09:00/09:15/15:30
 * baked into the resolver function itself) with configured data: session
 * boundaries live in market_calendar rows, one per exchange/segment/trading day,
 * so a specific day's hours can differ from the standard pattern.
 *
 * Real NSE holidays (see nse-holidays.ts) are consulted for every year that
 * data has been verified for -- a weekday exchange holiday is marked closed,
 * not silently treated as a normal trading day. For a year outside that
 * verified set, this deliberately seeds nothing at all rather than guessing
 * "weekday = trading day": resolveSessionState then honestly reports
 * calendarValid=false / state="unknown" for that day instead of a wrong
 * "market-open"/"after-close" guess -- failing closed, not open.
 */
import type { Query } from "./database/database.js";
import { z } from "zod";
import type { SessionData } from "@nraialgo/contracts";
import { KNOWN_HOLIDAY_YEARS, NSE_HOLIDAY_CALENDAR_SOURCE, NSE_HOLIDAY_CALENDAR_VERSION, nseHolidayName } from "./nse-holidays.js";

const NSE_PRE_OPEN_START_MINUTES = 9 * 60; // 09:00 IST
const NSE_MARKET_OPEN_START_MINUTES = 9 * 60 + 15; // 09:15 IST
const NSE_MARKET_CLOSE_MINUTES = 15 * 60 + 30; // 15:30 IST
const IST_OFFSET_MINUTES = 5 * 60 + 30;

interface CalendarRow {
  trading_day: string;
  is_trading_day: boolean;
  closure_reason: string | null;
  pre_open_start: string | null;
  market_open: string | null;
  market_close: string | null;
}

function istDateKey(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  return ist.toISOString().slice(0, 10);
}

function istBoundary(dateKey: string, minutesSinceMidnight: number): string {
  const utcMs =
    Date.parse(`${dateKey}T00:00:00Z`) +
    (minutesSinceMidnight - IST_OFFSET_MINUTES) * 60_000;
  return new Date(utcMs).toISOString();
}

/** Idempotent: upserts each day in the window without disturbing a day that was
 * already overridden (e.g. a manually recorded exchange holiday). Records
 * which holiday-calendar source/version produced each seeded row (see
 * ensureCalendarMetadataTable) so that provenance is inspectable later,
 * not just implied by whenever this function happened to run. */
export async function seedNseCalendar(
  query: Query,
  options: { from: Date; days: number; exchange?: string; segment?: string },
) {
  const exchange = options.exchange ?? "NSE";
  const segment = options.segment ?? "EQ";
  let seededAny = false;
  for (let offset = 0; offset < options.days; offset++) {
    const dateKey = istDateKey(
      new Date(options.from.getTime() + offset * 86_400_000),
    );
    const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    const year = Number(dateKey.slice(0, 4));
    if (!KNOWN_HOLIDAY_YEARS.has(year)) continue;

    let holidayName: string | null = null;
    if (!isWeekend) {
      holidayName = nseHolidayName(dateKey);
    }
    const isTradingDay = !isWeekend && !holidayName;
    seededAny = true;

    await query(
      `INSERT INTO market_calendar
         (exchange, segment, trading_day, is_trading_day, closure_reason, pre_open_start, market_open, market_close, managed_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (exchange, segment, trading_day) DO UPDATE SET
         is_trading_day=EXCLUDED.is_trading_day, closure_reason=EXCLUDED.closure_reason,
         pre_open_start=EXCLUDED.pre_open_start, market_open=EXCLUDED.market_open,
         market_close=EXCLUDED.market_close, managed_version=EXCLUDED.managed_version
       WHERE market_calendar.managed_version LIKE 'seed:%'`,
      [
        exchange,
        segment,
        dateKey,
        isTradingDay,
        isWeekend ? "Weekend" : holidayName,
        isTradingDay ? istBoundary(dateKey, NSE_PRE_OPEN_START_MINUTES) : null,
        isTradingDay ? istBoundary(dateKey, NSE_MARKET_OPEN_START_MINUTES) : null,
        isTradingDay ? istBoundary(dateKey, NSE_MARKET_CLOSE_MINUTES) : null,
        `seed:${NSE_HOLIDAY_CALENDAR_VERSION}`,
      ],
    );
  }
  if (seededAny) {
    await query(
      `INSERT INTO calendar_metadata (exchange, segment, source, version, imported_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (exchange, segment)
       DO UPDATE SET source=EXCLUDED.source, version=EXCLUDED.version, imported_at=now()
       WHERE calendar_metadata.source = EXCLUDED.source`,
      [exchange, segment, NSE_HOLIDAY_CALENDAR_SOURCE, NSE_HOLIDAY_CALENDAR_VERSION],
    );
  }
}

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v);
export const calendarImportSchema = z.object({
  source: z.string().url().startsWith("https://"), version: z.string().min(1).max(100),
  days: z.array(z.object({
    day: daySchema, trading: z.boolean(), reason: z.string().min(1).max(300).nullable(),
    preOpen: z.string().datetime({offset:true}).nullable(),
    open: z.string().datetime({offset:true}).nullable(), close: z.string().datetime({offset:true}).nullable(),
  }).strict()).min(1).max(730),
}).strict();

/** Explicit operator import: replaces the listed dates only, including weekend sessions.
 * Must run inside a transaction. Generated seeds cannot overwrite imported dates. */
export async function importCalendar(query: Query, value: unknown, exchange = "NSE", segment = "EQ") {
  const data = calendarImportSchema.parse(value);
  if (new Set(data.days.map(d => d.day)).size !== data.days.length) throw new Error("Duplicate calendar dates");
  for (const d of data.days) {
    if (d.trading) {
      if (!d.preOpen || !d.open || !d.close || !(Date.parse(d.preOpen) <= Date.parse(d.open) && Date.parse(d.open) < Date.parse(d.close)) ||
          [d.preOpen,d.open,d.close].some(t => istDateKey(new Date(t)) !== d.day)) throw new Error("Invalid session boundaries");
    } else if (d.preOpen || d.open || d.close || !d.reason) throw new Error("Closed dates require a reason and no boundaries");
  }
  for (const d of data.days) await query(`INSERT INTO market_calendar
    (exchange,segment,trading_day,is_trading_day,closure_reason,pre_open_start,market_open,market_close,managed_version)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(exchange,segment,trading_day) DO UPDATE SET
    is_trading_day=EXCLUDED.is_trading_day,closure_reason=EXCLUDED.closure_reason,
    pre_open_start=EXCLUDED.pre_open_start,market_open=EXCLUDED.market_open,market_close=EXCLUDED.market_close,
    managed_version=EXCLUDED.managed_version`, [exchange,segment,d.day,d.trading,d.reason,d.preOpen,d.open,d.close,`import:${data.version}`]);
  await query(`INSERT INTO calendar_metadata(exchange,segment,source,version,imported_at) VALUES($1,$2,$3,$4,now())
    ON CONFLICT(exchange,segment) DO UPDATE SET source=EXCLUDED.source,version=EXCLUDED.version,imported_at=now()`, [exchange,segment,data.source,data.version]);
}

export async function calendarCoverage(query: Query, now = new Date()) {
  const from = istDateKey(now);
  const [row] = await query<{covered:number}>(`SELECT count(*)::int AS covered FROM market_calendar
    WHERE exchange='NSE' AND segment='EQ' AND trading_day >= $1::date AND trading_day < $1::date + 45`, [from]);
  return { status: row?.covered === 45 ? "ok" : "coverage_expiring", coveredDays: row?.covered ?? 0, requiredDays: 45 };
}

/** Resolve session state from configured calendar rows, never from hard-coded
 * hours. Returns calendarValid=false when today's row has not been seeded --
 * the guide requires that to surface as Unknown, not a guessed state. */
export async function resolveSessionState(
  query: Query,
  now: Date,
  exchange = "NSE",
  segment = "EQ",
): Promise<SessionData> {
  const todayKey = istDateKey(now);
  const [today] = await query<CalendarRow>(
    `SELECT trading_day::text, is_trading_day, closure_reason, pre_open_start, market_open, market_close
       FROM market_calendar WHERE exchange=$1 AND segment=$2 AND trading_day=$3`,
    [exchange, segment, todayKey],
  );
  const [lastCompleted] = await query<{ trading_day: string }>(
    `SELECT trading_day::text FROM market_calendar
       WHERE exchange=$1 AND segment=$2 AND is_trading_day AND market_close <= $3
       ORDER BY trading_day DESC LIMIT 1`,
    [exchange, segment, now.toISOString()],
  );
  async function nextTradingDay(): Promise<CalendarRow | null> {
    const [row] = await query<CalendarRow>(
      `SELECT trading_day::text, is_trading_day, closure_reason, pre_open_start, market_open, market_close
         FROM market_calendar
         WHERE exchange=$1 AND segment=$2 AND is_trading_day AND trading_day > $3
         ORDER BY trading_day ASC LIMIT 1`,
      [exchange, segment, todayKey],
    );
    return row ?? null;
  }
  const lastCompletedSession = lastCompleted?.trading_day ?? null;

  if (!today) {
    return {
      state: "unknown",
      calendarValid: false,
      sessionId: null,
      lastCompletedSession,
      nextSession: null,
      nextTransitionAt: null,
    };
  }

  if (!today.is_trading_day) {
    const next = await nextTradingDay();
    return {
      state: "weekend-holiday",
      calendarValid: true,
      sessionId: null,
      lastCompletedSession,
      nextSession: next?.trading_day ?? null,
      nextTransitionAt: next?.pre_open_start ?? null,
    };
  }

  const preOpen = new Date(today.pre_open_start!).getTime();
  const marketOpen = new Date(today.market_open!).getTime();
  const marketClose = new Date(today.market_close!).getTime();
  const nowMs = now.getTime();

  if (nowMs < preOpen) {
    return {
      state: "after-close",
      calendarValid: true,
      sessionId: todayKey,
      lastCompletedSession,
      nextSession: todayKey,
      nextTransitionAt: today.pre_open_start,
    };
  }
  if (nowMs < marketOpen) {
    return {
      state: "pre-open",
      calendarValid: true,
      sessionId: todayKey,
      lastCompletedSession,
      nextSession: null,
      nextTransitionAt: today.market_open,
    };
  }
  if (nowMs < marketClose) {
    return {
      state: "market-open",
      calendarValid: true,
      sessionId: todayKey,
      lastCompletedSession,
      nextSession: null,
      nextTransitionAt: today.market_close,
    };
  }
  const next = await nextTradingDay();
  return {
    state: "after-close",
    calendarValid: true,
    sessionId: todayKey,
    lastCompletedSession,
    nextSession: next?.trading_day ?? null,
    nextTransitionAt: next?.pre_open_start ?? null,
  };
}
