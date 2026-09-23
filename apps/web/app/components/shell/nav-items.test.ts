import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "./nav-items";

describe("application navigation", () => {
  it("links every implemented portfolio screen", () => {
    const items = NAV_GROUPS.flatMap(group => group.items);
    for (const href of ["/app/orders-trades", "/app/live-positions", "/app/funds-margin", "/app/cash-holdings"]) {
      expect(items.find(item => item.href === href)).toMatchObject({ built: true });
    }
  });
});
