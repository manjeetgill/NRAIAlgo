/** Live NSE index prices through an already-authorized Zerodha session, via
 * Kite Connect's own getLTP -- a single lightweight call, not the fuller
 * getQuote. Used as the prices panel's preferred source whenever a broker
 * session exists; falls back to NSE's own published EOD archive
 * (nse-bhavcopy.ts) when it doesn't or this call fails, so the panel is
 * never left with nothing just because this path had a problem.
 */
import { KiteConnect, type Connect } from "kiteconnect";
import type { PriceQuote } from "@nraialgo/contracts";

export type LtpClient = Pick<Connect, "setAccessToken" | "getLTP">;

const INDEX_INSTRUMENTS: readonly { kiteKey: string; instrumentId: string; label: string }[] = [
  { kiteKey: "NSE:NIFTY 50", instrumentId: "NSE:NIFTY50", label: "NIFTY 50" },
  { kiteKey: "NSE:NIFTY BANK", instrumentId: "NSE:BANKNIFTY", label: "BANK NIFTY" },
  { kiteKey: "NSE:INDIA VIX", instrumentId: "NSE:INDIAVIX", label: "INDIA VIX" },
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/** Throws (never returns partial data) if the session is invalid or any of
 * the three tracked indices is missing from Kite's response -- same
 * all-or-nothing rule as nse-bhavcopy.ts's parseIndexCloseCsv. */
export async function fetchZerodhaIndexQuotes(
  apiKey: string,
  accessToken: string,
  now: Date,
  factory: (apiKey: string) => LtpClient = (key) => new KiteConnect({ api_key: key }),
  timeoutMs = 8000,
): Promise<PriceQuote[]> {
  const client = factory(apiKey);
  client.setAccessToken(accessToken);
  const ltp = await withTimeout(
    client.getLTP(INDEX_INSTRUMENTS.map((instrument) => instrument.kiteKey)),
    timeoutMs,
    "Zerodha index LTP read",
  );

  const missing = INDEX_INSTRUMENTS.filter((instrument) => ltp[instrument.kiteKey] === undefined);
  if (missing.length) {
    throw new Error(`Zerodha LTP response was missing: ${missing.map((instrument) => instrument.label).join(", ")}`);
  }

  const nowIso = now.toISOString();
  return INDEX_INSTRUMENTS.map(({ kiteKey, instrumentId, label }) => ({
    instrumentId,
    label,
    value: ltp[kiteKey]!.last_price,
    priceBasis: "ltp" as const,
    sourceAsOf: nowIso,
    receivedAt: nowIso,
    fresh: true,
  }));
}
