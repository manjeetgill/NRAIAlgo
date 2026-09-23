import { expect, it, vi } from "vitest";
import { IciciLiveMarket, positionKey } from "./icici-live.js";
import type { IciciFeedMessage, IciciInstrument } from "./icici-feed.js";

it("keeps ICICI ticks workspace-isolated and retains the close baseline when a tick becomes stale", () => {
  let now = Date.parse("2026-09-23T04:08:00.000Z"); let receive: ((message: IciciFeedMessage) => void) | undefined; let subscribed: IciciInstrument[] = [];
  const stop = vi.fn();
  const market = new IciciLiveMarket((_session, callback) => { receive = callback; return { subscribe(value) { subscribed = value; }, stop }; }, () => now);
  const session = { sessionToken: Buffer.from("IC1:secret").toString("base64"), accountId: "IC1" };
  const row = { exchange_code: "NFO", stock_code: "NIFTY", product_type: "Options", expiry_date: "25-Sep-2026", strike_price: 24000, right: "Call", quantity: 50 };
  market.ensure("workspace-a", session, [row]);
  expect(subscribed).toHaveLength(1);
  expect(subscribed[0]?.key).toBe(positionKey(row, 0));
  receive?.({ type: "state", state: "streaming" });
  receive?.({ type: "tick", key: positionKey(row, 0), price: 101.25, previousClose: 99.5, sourceAt: now });
  expect(market.snapshot("workspace-a")).toMatchObject({ state: "streaming", prices: [{ price: 101.25, previousClose: 99.5, fresh: true }] });
  expect(market.snapshot("workspace-b").prices).toEqual([]);
  now += 15_001;
  expect(market.snapshot("workspace-a").prices).toMatchObject([{ price: 101.25, previousClose: 99.5, fresh: false }]);
  market.close(); expect(stop).toHaveBeenCalledOnce();
});
