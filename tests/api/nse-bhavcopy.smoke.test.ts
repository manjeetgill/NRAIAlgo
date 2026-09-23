/** Opt-in connectivity check against NSE's real published archive -- not
 * run by `npm test` (see vitest.config.ts's exclude), only by
 * `npm run test:smoke`. The normal suite (nse-bhavcopy.test.ts) covers
 * parseIndexCloseCsv's logic against a captured real sample instead, so it
 * never depends on network access or NSE's uptime.
 */
import { describe, expect, it } from "vitest";
import { fetchNseIndexCloses } from "../../apps/api/src/nse-bhavcopy.js";

describe("fetchNseIndexCloses (real NSE archive)", () => {
  it(
    "fetches real NIFTY/BANKNIFTY/VIX closes for a known-published trading day",
    { timeout: 15000 },
    async () => {
      const quotes = await fetchNseIndexCloses("2026-09-18");

      const nifty = quotes.find((quote) => quote.instrumentId === "NSE:NIFTY50");
      expect(nifty?.value).toBe(23346.4);
      expect(nifty?.priceBasis).toBe("official-close");
      expect(nifty?.fresh).toBe(false);
    },
  );
});
