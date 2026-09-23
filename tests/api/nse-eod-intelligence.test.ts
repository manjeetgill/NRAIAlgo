import { describe, expect, it } from "vitest";
import { parseFiiDiiJson, parseParticipantOiCsv, parseSectorPerformanceCsv } from "../../backend/nodejs/src/nse-eod-intelligence.js";

describe("NSE EOD intelligence parsers", () => {
  it("parses participant OI by named columns", () => {
    const csv = `Participant wise Open Interest,,,,,,\nClient Type,Future Index Long,Future Index Short,Option Index Call Long,Option Index Put Long,Option Index Call Short,Option Index Put Short\nClient,10,5,20,21,22,23\nDII,30,4,31,32,33,34\nFII,40,50,41,42,43,44\nPro,60,7,61,62,63,64\nTOTAL,140,66,153,157,161,165`;
    const rows = parseParticipantOiCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows.find(row => row.category === "FII")).toMatchObject({ futureIndexLong: 40, futureIndexShort: 50, optionIndexPutShort: 44 });
  });

  it("validates and reconciles official FII/DII cash values", () => {
    const rows = parseFiiDiiJson([
      { category: "DII", date: "22-Sep-2026", buyValue: "14599.72", sellValue: "10479.65", netValue: "4120.07" },
      { category: "FII/FPI", date: "22-Sep-2026", buyValue: "9845.81", sellValue: "13655.80", netValue: "-3809.99" },
    ], "2026-09-22");
    expect(rows.find(row => row.category === "FII/FPI")?.netCrore).toBe(-3809.99);
    expect(() => parseFiiDiiJson([{ category: "FII/FPI", date: "21-Sep-2026", buyValue: "1", sellValue: "1", netValue: "0" }], "2026-09-22")).toThrow(/not available/);
  });

  it("uses official sector close, point change and percentage change", () => {
    const csv = `Index Name,Index Date,Closing Index Value,Points Change,Change(%)\nNifty Bank,22-09-2026,56215.55,-255.10,-.45\nNifty IT,22-09-2026,28582.10,-248.80,-.86\nNifty Auto,22-09-2026,27086.30,-64.80,-.24\nNifty FMCG,22-09-2026,45657.75,-243.15,-.53`;
    expect(parseSectorPerformanceCsv(csv)).toEqual([
      expect.objectContaining({ label: "Banking & Finance", close: 56215.55, changePct: -0.45 }),
      expect.objectContaining({ label: "Technology & IT", change: -248.8 }),
      expect.objectContaining({ label: "Auto & EV", changePct: -0.24 }),
      expect.objectContaining({ label: "Consumer Goods", close: 45657.75 }),
    ]);
  });
});
