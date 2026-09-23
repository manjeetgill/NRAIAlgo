import { describe, expect, it } from "vitest";
import { formatBrokerMoney } from "../../../../frontend/nextjs/app/app/overview/account-records-page";

describe("formatBrokerMoney", () => {
  it("formats ICICI number and numeric-string values as INR consistently", () => {
    expect(formatBrokerMoney(36_526.02)).toBe("₹36,526.02");
    expect(formatBrokerMoney("4,67,398.91")).toBe("₹4,67,398.91");
    expect(formatBrokerMoney("0")).toBe("₹0.00");
  });

  it("does not coerce missing or non-numeric broker values to zero", () => {
    expect(formatBrokerMoney(null)).toBe("Not supplied");
    expect(formatBrokerMoney("Unavailable")).toBe("Not supplied");
  });
});
