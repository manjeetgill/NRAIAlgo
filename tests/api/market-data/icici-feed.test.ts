import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { instrumentLookupKey, parseIciciTick, parseSecurityMaster } from "../../../apps/api/src/market-data/icici-feed.js";

describe("ICICI live feed protocol", () => {
  it("maps official security-master equity and derivative contracts to quote tokens", () => {
    const zip = new AdmZip();
    zip.addFile("NSEScripMaster.txt", Buffer.from("2885,RELIANCE,,Reliance Industries\n"));
    zip.addFile("FONSEScripMaster.txt", Buffer.from("12345,,NIFTY,OPT,25-SEP-2026,24000,CE\n12346,,NIFTY,FUT,25-SEP-2026,,,\n"));
    const master = parseSecurityMaster(zip.toBuffer());
    expect(master.get("NSE|RELIANCE")).toEqual({ token: "2885", prefix: "4." });
    expect(master.get("NFO|NIFTY|OPT|20260925|24000|CE")).toEqual({ token: "12345", prefix: "4." });
    expect(instrumentLookupKey({ exchangeCode: "NFO", stockCode: "NIFTY", productType: "Options", expiryDate: "2026-09-25", strikePrice: "24000.00", right: "Call" })).toBe("NFO|NIFTY|OPT|20260925|24000|CE");
  });

  it("accepts fresh quote frames and rejects depth, unknown, or future frames", () => {
    const now = Date.parse("2026-09-23T04:08:00.000Z");
    const quote = Array(23).fill(0); quote[0] = "4.1!12345"; quote[2] = 101.25; quote[21] = now / 1000; quote[22] = 99.5;
    const keys = new Map([["4.1!12345", "position-1"]]);
    expect(parseIciciTick(quote, keys, now)).toEqual({ type: "tick", key: "position-1", price: 101.25, previousClose: 99.5, sourceAt: now });
    quote[0] = "4.2!12345"; expect(parseIciciTick(quote, keys, now)).toBeNull();
    quote[0] = "4.1!999"; expect(parseIciciTick(quote, keys, now)).toBeNull();
    quote[0] = "4.1!12345"; quote[21] = (now + 6000) / 1000; expect(parseIciciTick(quote, keys, now)).toBeNull();
  });
});
