/**
 * Real, credential-free NSE index closing prices from NSE's own published
 * archives (https://nsearchives.nseindia.com) -- used as the prices panel's
 * data source until a broker's live feed exists (build order step 4).
 *
 * This is genuinely NSE-published data, not a guess or a fixture: verified
 * against a live fetch of ind_close_all_18092026.csv, which returns rows
 * literally named "Nifty 50", "Nifty Bank" and "India VIX" with a
 * "Closing Index Value" column. It is end-of-day only -- priceBasis is
 * always "official-close" (NSE's own named closing value), never "ltp" or
 * the more ambiguous "last-observed"; there is no live tick here.
 */
import type { PriceQuote } from "@nraialgo/contracts";

const INDEX_INSTRUMENTS: readonly { indexName: string; instrumentId: string; label: string }[] = [
  { indexName: "Nifty 50", instrumentId: "NSE:NIFTY50", label: "NIFTY 50" },
  { indexName: "Nifty Bank", instrumentId: "NSE:BANKNIFTY", label: "BANK NIFTY" },
  { indexName: "India VIX", instrumentId: "NSE:INDIAVIX", label: "INDIA VIX" },
];

// EOD data for a published trading day never changes -- cache it for this
// process's lifetime instead of re-fetching NSE on every /v1/overview poll.
const cache = new Map<string, PriceQuote[]>();

/** day is "YYYY-MM-DD" (from market_calendar); NSE's archive path wants "DDMMYYYY". */
function toArchiveDateStamp(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}${month}${year}`;
}

/** Parses NSE's own CSV header by name (never a fixed column index) so a
 * harmless column reorder doesn't silently misread a different field.
 * Throws on anything that doesn't look like this exact shape -- this must
 * never partially succeed with wrong values. */
export function parseIndexCloseCsv(csv: string, day: string): PriceQuote[] {
  const lines = csv.trim().split("\n");
  const header = lines[0]?.split(",").map((cell) => cell.trim()) ?? [];
  const nameIndex = header.indexOf("Index Name");
  const closeIndex = header.indexOf("Closing Index Value");
  if (nameIndex === -1 || closeIndex === -1) {
    throw new Error("Unexpected NSE index-close CSV format");
  }
  const closingValues = new Map<string, number>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const name = cells[nameIndex]?.trim();
    const close = Number(cells[closeIndex]);
    if (name && Number.isFinite(close)) {
      closingValues.set(name, close);
    }
  }
  const receivedAt = new Date().toISOString();
  // 15:30 IST market close -- these are genuinely the values as of that
  // moment, not an arbitrary "whenever the file was published" guess.
  const sourceAsOf = new Date(`${day}T10:00:00Z`).toISOString();
  const missing = INDEX_INSTRUMENTS.filter(({ indexName }) => !closingValues.has(indexName));
  if (missing.length) {
    // All three tracked indices or none: a caller showing "Prices:
    // Available" with, say, NIFTY 50 silently missing is worse than
    // reporting the whole panel unavailable -- see contracts panel()'s
    // own "never a fabricated zero" rule, which this generalizes to
    // "never a silently incomplete available."
    throw new Error(
      `NSE bhavcopy for ${day} was missing: ${missing.map((instrument) => instrument.label).join(", ")}`,
    );
  }
  return INDEX_INSTRUMENTS.map(({ indexName, instrumentId, label }) => ({
    instrumentId,
    label,
    value: closingValues.get(indexName)!,
    priceBasis: "official-close" as const,
    sourceAsOf,
    receivedAt,
    fresh: false,
  }));
}

/** Fetches and parses one trading day's index closes. Throws (never returns
 * partial/fabricated data) if NSE is unreachable, the day isn't published
 * yet, or any of the three tracked indices is missing. */
export async function fetchNseIndexCloses(day: string): Promise<PriceQuote[]> {
  const cached = cache.get(day);
  if (cached) {
    return cached;
  }
  const url = `https://nsearchives.nseindia.com/content/indices/ind_close_all_${toArchiveDateStamp(day)}.csv`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`NSE bhavcopy request failed (HTTP ${response.status}) for ${day}`);
  }
  // parseIndexCloseCsv now itself throws unless all three tracked indices
  // are present -- there is no partial-success shape left to check here.
  const quotes = parseIndexCloseCsv(await response.text(), day);
  cache.set(day, quotes);
  return quotes;
}
