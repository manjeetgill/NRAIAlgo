import { describe, expect, it } from "vitest";
import { parseIndexCloseCsv } from "../../backend/nodejs/src/nse-bhavcopy.js";

// Real rows from a live fetch of
// https://nsearchives.nseindia.com/content/indices/ind_close_all_18092026.csv
// (2026-09-18), not fabricated -- this is what NSE's own archive returns.
const REAL_SAMPLE = `Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield
Nifty 50,18-09-2026,23334.7,23389.15,23286.6,23346.4,75.8,.33,375346024,31510.28,19.74,2.82,1.21
Nifty Next 50,18-09-2026,71290.9,72199.1,71287.85,72025.4,881.4,1.24,223326106,12642.87,19.04,3.21,1
Nifty Bank,18-09-2026,56172.85,56497.45,56073.55,56358.7,302.95,.54,237801140,8027.68,13.33,1.69,.7
India VIX,18-09-2026,12.29,12.29,11.3075,11.39,-0.91,-7.36,-,-,-,-,-
`;

describe("parseIndexCloseCsv", () => {
  it.each(["", " ", "0", "-1", "NaN", "Infinity"])("rejects invalid tracked prices %j", value => {
    expect(() => parseIndexCloseCsv(`Index Name,Closing Index Value\nNifty 50,${value}\nNifty Bank,10\nIndia VIX,12`, "2026-09-18")).toThrow("Invalid NSE closing value");
  });
  it("rejects a different publication date", () => {
    expect(() => parseIndexCloseCsv(REAL_SAMPLE, "2026-09-21")).toThrow("date mismatch");
  });
  it("extracts exactly the three tracked indices with their real closing values", () => {
    const quotes = parseIndexCloseCsv(REAL_SAMPLE, "2026-09-18");

    expect(quotes).toEqual([
      expect.objectContaining({ instrumentId: "NSE:NIFTY50", label: "NIFTY 50", value: 23346.4 }),
      expect.objectContaining({ instrumentId: "NSE:BANKNIFTY", label: "BANK NIFTY", value: 56358.7 }),
      expect.objectContaining({ instrumentId: "NSE:INDIAVIX", label: "INDIA VIX", value: 11.39 }),
    ]);
  });

  it("marks every quote as official-close and not fresh -- this is end-of-day data, never a live tick", () => {
    const quotes = parseIndexCloseCsv(REAL_SAMPLE, "2026-09-18");

    for (const quote of quotes) {
      expect(quote.priceBasis).toBe("official-close");
      expect(quote.fresh).toBe(false);
    }
  });

  it("carries official point and percentage changes when NSE supplies them", () => {
    const quotes = parseIndexCloseCsv(REAL_SAMPLE, "2026-09-18");
    expect(quotes[0]).toMatchObject({ change: 75.8, changePct: 0.33 });
  });

  it("sets sourceAsOf to the real 15:30 IST market close for that trading day", () => {
    const [quote] = parseIndexCloseCsv(REAL_SAMPLE, "2026-09-18");

    expect(quote?.sourceAsOf).toBe("2026-09-18T10:00:00.000Z");
  });

  it("rejects a CSV that doesn't have the expected NSE header, rather than guessing columns", () => {
    expect(() => parseIndexCloseCsv("Foo,Bar\n1,2\n", "2026-09-18")).toThrow(
      /Unexpected NSE index-close CSV format/,
    );
  });

  it("ignores index rows the screen doesn't track (e.g. Nifty Next 50) without error", () => {
    const quotes = parseIndexCloseCsv(REAL_SAMPLE, "2026-09-18");

    expect(quotes.find((quote) => quote.label.includes("Next 50"))).toBeUndefined();
  });

  it("throws rather than silently returning a partial panel when one tracked index is missing", () => {
    const missingVix = REAL_SAMPLE.split("\n")
      .filter((line) => !line.startsWith("India VIX"))
      .join("\n");

    expect(() => parseIndexCloseCsv(missingVix, "2026-09-18")).toThrow(/INDIA VIX/);
  });

  it("throws naming every missing index when more than one is absent", () => {
    const onlyNifty = "Index Name,Closing Index Value\nNifty 50,23346.4\n";

    expect(() => parseIndexCloseCsv(onlyNifty, "2026-09-18")).toThrow(/BANK NIFTY.*INDIA VIX/);
  });
});
