/** NSE equity (Capital Market) segment trading holidays -- full-day closures
 * only, not the separate currency-derivatives calendar.
 *
 * Source: NSE's own published 2026 holiday circular, cross-referenced
 * against Zerodha's public holiday calendar (https://zerodha.com/marketintel/holiday-calendar/)
 * on 2026-09-22. A holiday that also falls on a weekend (15 Feb, 21 Mar,
 * 15 Aug, 8 Nov in 2026) is omitted here -- the weekend closure already
 * covers it, and listing it again would just be redundant, not wrong.
 *
 * Deliberately scoped to only the years actually verified: see
 * KNOWN_HOLIDAY_YEARS below and market-calendar.ts's seedNseCalendar,
 * which refuses to guess "just a normal weekday" for a year outside this
 * set -- it leaves those days unseeded so they honestly resolve to
 * "unknown" instead.
 */
export const NSE_HOLIDAY_CALENDAR_SOURCE = "nse-circular-2026-cross-referenced-zerodha-2026-09-22";
export const NSE_HOLIDAY_CALENDAR_VERSION = "2026.1";

export const KNOWN_HOLIDAY_YEARS: ReadonlySet<number> = new Set([2026]);

export const NSE_HOLIDAYS_2026: ReadonlyMap<string, string> = new Map([
  ["2026-01-15", "Municipal Corporation Elections (Maharashtra)"],
  ["2026-01-26", "Republic Day"],
  ["2026-03-03", "Holi"],
  ["2026-03-26", "Shri Ram Navami"],
  ["2026-03-31", "Shri Mahavir Jayanti"],
  ["2026-04-03", "Good Friday"],
  ["2026-04-14", "Dr. Baba Saheb Ambedkar Jayanti"],
  ["2026-05-01", "Maharashtra Day"],
  ["2026-05-28", "Bakri Eid"],
  ["2026-06-26", "Moharram"],
  ["2026-09-14", "Ganesh Chaturthi"],
  ["2026-10-02", "Mahatma Gandhi Jayanti"],
  ["2026-10-20", "Dussehra"],
  ["2026-11-10", "Diwali-Balipratipada"],
  ["2026-11-24", "Prakash Gurpurb Sri Guru Nanak Dev"],
  ["2026-12-25", "Christmas"],
]);

const HOLIDAYS_BY_YEAR: ReadonlyMap<number, ReadonlyMap<string, string>> = new Map([[2026, NSE_HOLIDAYS_2026]]);

/** Returns the holiday name for a "YYYY-MM-DD" date if it's a known NSE
 * closure, or null if it's a known ordinary trading day (still a year we
 * have verified data for). Throws if the year isn't one we have verified
 * holiday data for at all -- the caller must not guess for that case. */
export function nseHolidayName(dateKey: string): string | null {
  const year = Number(dateKey.slice(0, 4));
  if (!KNOWN_HOLIDAY_YEARS.has(year)) {
    throw new Error(`No verified NSE holiday data for ${year}.`);
  }
  return HOLIDAYS_BY_YEAR.get(year)?.get(dateKey) ?? null;
}
