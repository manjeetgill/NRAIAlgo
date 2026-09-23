import { describe, expect, it } from "vitest";
import { fetchZerodhaHistoricalCandles } from "./zerodha-historical.js";

describe("fetchZerodhaHistoricalCandles", () => {
  it("passes through the real getHistoricalData call with the requested parameters", async () => {
    let capturedArgs: unknown[] = [];
    const from = new Date("2026-09-01T00:00:00Z");
    const to = new Date("2026-09-21T00:00:00Z");

    const candles = await fetchZerodhaHistoricalCandles(
      "key",
      "token",
      256265, // NIFTY 50 instrument token
      "day",
      from,
      to,
      {},
      () => ({
        setAccessToken: () => {},
        getHistoricalData: async (...args: unknown[]) => {
          capturedArgs = args;
          return [
            { date: new Date("2026-09-18T09:15:00+05:30"), open: 25000, high: 25200, low: 24950, close: 25150, volume: 1_200_000 },
          ];
        },
      }),
    );

    expect(capturedArgs).toEqual([256265, "day", from, to, false, false]);
    expect(candles).toEqual([
      {
        timestamp: new Date("2026-09-18T09:15:00+05:30").toISOString(),
        open: 25000,
        high: 25200,
        low: 24950,
        close: 25150,
        volume: 1_200_000,
        openInterest: null,
      },
    ]);
  });

  it("carries open interest through when requested, for F&O instruments", async () => {
    const candles = await fetchZerodhaHistoricalCandles(
      "key",
      "token",
      12345,
      "day",
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-02T00:00:00Z"),
      { includeOpenInterest: true },
      () => ({
        setAccessToken: () => {},
        getHistoricalData: async () => [
          { date: new Date("2026-09-01T09:15:00+05:30"), open: 100, high: 110, low: 95, close: 105, volume: 500, oi: 42000 },
        ],
      }),
    );

    expect(candles[0]?.openInterest).toBe(42000);
  });

  it("defaults continuous and open-interest flags to false when not specified", async () => {
    let capturedArgs: unknown[] = [];
    await fetchZerodhaHistoricalCandles(
      "key",
      "token",
      1,
      "minute",
      new Date("2026-09-01T00:00:00Z"),
      new Date("2026-09-01T01:00:00Z"),
      {},
      () => ({
        setAccessToken: () => {},
        getHistoricalData: async (...args: unknown[]) => {
          capturedArgs = args;
          return [];
        },
      }),
    );

    expect(capturedArgs[4]).toBe(false);
    expect(capturedArgs[5]).toBe(false);
  });
});
