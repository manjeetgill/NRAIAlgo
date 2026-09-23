import { describe, expect, it } from "vitest";
import { resolvedOverallPnl } from "../../../../frontend/nextjs/app/app/overview/market-open-desk";

describe("resolvedOverallPnl", () => {
  it("prefers reported net P&L", () => {
    expect(resolvedOverallPnl({ netPaise: 9_000, grossPaise: 10_000 }, 8_000)).toBe(9_000);
  });

  it("uses reported gross P&L when charges and net are unavailable", () => {
    expect(resolvedOverallPnl({ netPaise: null, grossPaise: -58_063_00 }, null)).toBe(-58_063_00);
  });

  it("uses the position estimate only when no broker P&L is present", () => {
    expect(resolvedOverallPnl(null, 12_500)).toBe(12_500);
  });
});
