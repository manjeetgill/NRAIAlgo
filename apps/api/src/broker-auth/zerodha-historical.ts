/**
 * Reads real historical OHLC candles through an already-authorized Zerodha
 * session, via the official kiteconnect SDK's getHistoricalData. As of
 * February 2026, historical data is bundled into the same paid Kite Connect
 * subscription as live data (no separate historical charge) -- see
 * https://kite.trade/forum/discussion/14806/historical-data-is-now-free-with-base-kite-connect-subscription.
 *
 * What this actually returns, per candle: date, open, high, low, close,
 * volume, and oi (open interest, F&O only, when requested). Up to 60
 * minute-level days or ~2000 daily days per call, per Kite's documented
 * limits -- this module does not itself enforce that; callers choosing a
 * (from, to) range are responsible for staying within it.
 *
 * Deliberately NOT wired into the Overview screen: the MVP guide this
 * project follows explicitly defers "bulk historical imports, backtesting,
 * research jobs or long-term performance charts" from that screen. The
 * natural home for this is the Strategy Matrix / Backtests nav items,
 * which are still unbuilt placeholders.
 */
import { KiteConnect, type Connect } from "kiteconnect";

export type HistoricalInterval =
  | "minute"
  | "3minute"
  | "5minute"
  | "10minute"
  | "15minute"
  | "30minute"
  | "60minute"
  | "day";

export interface HistoricalCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
}

type HistoricalClient = Pick<Connect, "setAccessToken" | "getHistoricalData">;

export async function fetchZerodhaHistoricalCandles(
  apiKey: string,
  accessToken: string,
  instrumentToken: number,
  interval: HistoricalInterval,
  from: Date,
  to: Date,
  options: { continuous?: boolean; includeOpenInterest?: boolean } = {},
  factory: (apiKey: string) => HistoricalClient = (key) => new KiteConnect({ api_key: key }),
): Promise<HistoricalCandle[]> {
  const client = factory(apiKey);
  client.setAccessToken(accessToken);
  const rows = await client.getHistoricalData(
    instrumentToken,
    interval,
    from,
    to,
    options.continuous ?? false,
    options.includeOpenInterest ?? false,
  );
  return rows.map((row) => ({
    timestamp: new Date(row.date).toISOString(),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    openInterest: row.oi ?? null,
  }));
}
