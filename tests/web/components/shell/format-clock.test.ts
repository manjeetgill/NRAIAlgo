import { describe, expect, it } from "vitest";
import { formatClock, formatTimeOnly } from "../../../../frontend/nextjs/app/components/shell/format-clock";

describe("formatClock", () => {
  it("formats an instant in the given timezone as 'Ddd DD Mon, HH:MM:SS'", () => {
    // 2026-09-21T06:30:15Z = Monday 12:00:15 IST
    const instant = new Date("2026-09-21T06:30:15Z");

    expect(formatClock(instant, "Asia/Kolkata")).toBe("Mon 21 Sep, 12:00:15");
  });

  it("reflects a different timezone for the same instant", () => {
    const instant = new Date("2026-09-21T06:30:15Z");

    expect(formatClock(instant, "UTC")).toBe("Mon 21 Sep, 06:30:15");
  });
});

describe("formatTimeOnly", () => {
  it("formats just the time as 'HH:MM:SS' in the given timezone", () => {
    const instant = new Date("2026-09-21T06:30:15Z");

    expect(formatTimeOnly(instant, "America/New_York")).toBe("02:30:15");
    expect(formatTimeOnly(instant, "Asia/Dubai")).toBe("10:30:15");
  });
});
