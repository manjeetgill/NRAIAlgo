import { createHash } from "node:crypto";
import { createIciciFeed, type IciciFeed, type IciciFeedFactory, type IciciInstrument, type IciciSession } from "./icici-feed.js";

export type IciciLiveSnapshot = {
  state: "connecting" | "streaming" | "reconnecting" | "unavailable";
  asOf: string;
  prices: { key: string; price: number; previousClose: number | null; sourceAt: string; fresh: boolean }[];
};
type Entry = {
  fingerprint: string;
  feed: IciciFeed;
  state: IciciLiveSnapshot["state"];
  usedAt: number;
  ticks: Map<string, { price: number; previousClose: number | null; sourceAt: number; receivedAt: number }>;
  listeners: Set<() => void>;
};

function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }

/** One credential-isolated ICICI socket per active workspace. The browser only
 * receives bounded price snapshots; the broker token never leaves the API. */
export class IciciLiveMarket {
  private entries = new Map<string, Entry>();
  private waiting = new Map<string, Set<() => void>>();
  constructor(private factory: IciciFeedFactory = createIciciFeed, private clock = Date.now) {}

  ensure(workspaceId: string, session: IciciSession, rows: Record<string, string | number | null>[]) {
    const fingerprint = createHash("sha256").update(session.sessionToken).digest("hex");
    let entry = this.entries.get(workspaceId);
    if (entry && entry.fingerprint !== fingerprint) { this.remove(workspaceId); entry = undefined; }
    if (!entry) {
      if (this.entries.size >= 32) return;
      const created: Entry = { fingerprint, feed: { subscribe() {}, stop() {} }, state: "connecting", usedAt: this.clock(), ticks: new Map(), listeners: this.waiting.get(workspaceId) ?? new Set() };
      this.waiting.delete(workspaceId);
      this.entries.set(workspaceId, created);
      created.feed = this.factory(session, message => {
        if (this.entries.get(workspaceId) !== created) return;
        const now = this.clock();
        if (message.type === "state") {
          created.state = message.state;
          if (message.state !== "streaming") created.ticks.clear();
        } else if (message.sourceAt > 0 && message.sourceAt <= now + 5_000 && Number.isFinite(message.price) && message.price > 0) {
          const previous = created.ticks.get(message.key);
          if (!previous || message.sourceAt >= previous.sourceAt) created.ticks.set(message.key, { price: message.price, previousClose: message.previousClose ?? previous?.previousClose ?? null, sourceAt: message.sourceAt, receivedAt: now });
        }
        for (const listener of created.listeners) listener();
      });
      entry = created;
    }
    entry.usedAt = this.clock();
    const instruments: IciciInstrument[] = rows.flatMap((row, index) => {
      const quantity = Number(row.quantity);
      const exchangeCode = text(row.exchange_code).toUpperCase();
      const stockCode = text(row.stock_code).toUpperCase();
      if (!Number.isFinite(quantity) || quantity === 0 || !exchangeCode || !stockCode) return [];
      return [{ key: positionKey(row, index), exchangeCode, stockCode, productType: text(row.product_type), expiryDate: text(row.expiry_date), strikePrice: text(row.strike_price), right: text(row.right) }];
    });
    entry.feed.subscribe(instruments);
    const desired = new Set(instruments.map(instrument => instrument.key));
    for (const key of entry.ticks.keys()) if (!desired.has(key)) entry.ticks.delete(key);
  }

  snapshot(workspaceId: string): IciciLiveSnapshot {
    const now = this.clock(); const entry = this.entries.get(workspaceId);
    if (!entry) return { state: "unavailable", asOf: new Date(now).toISOString(), prices: [] };
    entry.usedAt = now;
    // Keep the exchange previous-close baseline even after an illiquid
    // contract's last tick becomes stale. Consumers use the tick price only
    // when fresh; otherwise the 30-second REST LTP remains authoritative.
    const prices = [...entry.ticks.entries()].map(([key, tick]) => ({
      key,
      price: tick.price,
      previousClose: tick.previousClose,
      sourceAt: new Date(tick.sourceAt).toISOString(),
      fresh: now - tick.receivedAt <= 15_000 && now - tick.sourceAt <= 15_000,
    }));
    return { state: entry.state, asOf: new Date(now).toISOString(), prices };
  }

  subscribe(workspaceId: string, listener: () => void): () => void {
    const entry = this.entries.get(workspaceId);
    if (!entry) {
      const listeners = this.waiting.get(workspaceId) ?? new Set(); listeners.add(listener); this.waiting.set(workspaceId, listeners);
      return () => { listeners.delete(listener); if (!listeners.size) this.waiting.delete(workspaceId); };
    }
    entry.usedAt = this.clock(); entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }
  disconnect(workspaceId: string) { this.remove(workspaceId); }
  prune() { for (const [id, entry] of this.entries) if (!entry.listeners.size && this.clock() - entry.usedAt > 60_000) this.remove(id); }
  close() { for (const id of [...this.entries.keys()]) this.remove(id); this.waiting.clear(); }
  private remove(workspaceId: string) { const entry = this.entries.get(workspaceId); this.entries.delete(workspaceId); entry?.feed.stop(); }
}

export function positionKey(row: Record<string, unknown>, index: number): string {
  return [text(row.exchange_code), text(row.stock_code), text(row.product_type), text(row.expiry_date), text(row.strike_price), text(row.right), String(index)].join("|");
}
