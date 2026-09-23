import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import type { AlphaWireItem, AlphaWireSnapshot } from "@nraialgo/contracts";
import type { Store } from "./database/database.js";

// Fixed official endpoint: no caller-controlled URLs, redirects or private-network fetches.
export const ANNOUNCEMENTS_URL = "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml";
const MAX_BYTES = 2_000_000;

export function safeAnnouncementUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["nsearchives.nseindia.com", "archives.nseindia.com", "www.nseindia.com"].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

/** Only headline metadata, not full articles. XML is untrusted, never rendered as HTML. */
export function parseAnnouncements(xml: string, now = new Date()): AlphaWireItem[] {
  if (Buffer.byteLength(xml) > MAX_BYTES || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Unsupported feed XML");
  const parser = new SaxesParser({ xmlns: false });
  const items: AlphaWireItem[] = [];
  const stack: string[] = [];
  let fields: Record<string, string> | undefined;
  let root = "";
  parser.on("opentag", tag => {
    const name = tag.name.toLowerCase();
    if (!stack.length) root = name;
    stack.push(name);
    if (name === "item") fields = {};
  });
  const text = (value: string) => {
    const name = stack.at(-1);
    if (fields && name && ["title", "link", "pubdate", "description"].includes(name)) fields[name] = (fields[name] ?? "") + value;
  };
  parser.on("text", text); parser.on("cdata", text);
  parser.on("closetag", () => {
    if (stack.pop() !== "item" || !fields) return;
    const subject = fields.description?.split(/\|SUBJECT:/i)[1]?.trim();
    const title = [fields.title, subject].filter(Boolean).join(" — ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
    const url = safeAnnouncementUrl((fields.link ?? "").trim());
    // NSE publishes unzoned exchange-local dates; never interpret in host timezone.
    const rawDate = fields.pubdate?.trim() ?? "";
    const nseDate = /^\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}$/.test(rawDate);
    const hasZone = /(?:GMT|UTC|Z|[+-]\d{2}:?\d{2})$/i.test(rawDate);
    const timestamp = Date.parse(nseDate ? `${rawDate} +0530` : hasZone ? rawDate : "");
    const publishedAt = Number.isFinite(timestamp) && timestamp <= now.getTime() + 300_000 ? new Date(timestamp).toISOString() : null;
    if (title && url) {
      // Deliberately excludes url: NSE itself sometimes files the exact same
      // disclosure twice under two different PDF attachments a few seconds
      // apart (verified live -- two "Outcome of Board Meeting" items for the
      // same company, same title, same pubDate, different /corporate/...pdf
      // link). Deduping on [title, publishedAt] collapses that correctly; a
      // genuinely different announcement essentially never shares both an
      // identical title string and an identical to-the-second timestamp.
      const id = createHash("sha256").update(JSON.stringify([title, publishedAt])).digest("hex");
      items.push({ id, title, url, source: "NSE announcements", category: "Announcements", publishedAt, receivedAt: now.toISOString() });
    }
    fields = undefined;
  });
  parser.write(xml).close();
  if (root !== "rss") throw new Error("Expected an RSS feed");
  return [...new Map(items.map(item => [item.id, item])).values()].slice(0, 200);
}

export class AlphaWire {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller?: AbortController;
  private closed = false;
  private polling = false;
  private listeners = new Set<() => void>();
  private source: AlphaWireSnapshot["source"];
  constructor(private store: Store, private fetcher: typeof fetch = fetch, private enabled = process.env.ALPHA_WIRE_ENABLED !== "false") {
    this.source = { status: enabled ? "waiting" : "disabled", lastCheckedAt: null, lastSuccessAt: null, pollIntervalSeconds: 300 };
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  protected notify() { for (const listener of this.listeners) listener(); }
  start() { if (!this.timer && !this.polling && !this.closed && this.enabled) void this.poll(); }
  close() { this.closed = true; clearTimeout(this.timer); this.controller?.abort(); this.listeners.clear(); }
  async snapshot(): Promise<AlphaWireSnapshot> {
    const rows = await this.store.transaction(query => query<{ payload: AlphaWireItem }>("SELECT payload FROM alpha_wire_items ORDER BY COALESCE((payload->>'publishedAt')::timestamptz, received_at) DESC, received_at DESC, id DESC LIMIT 200"));
    return { items: rows.map(row => row.payload), source: { ...this.source } };
  }
  async poll() {
    if (this.polling || this.closed || !this.enabled) return;
    clearTimeout(this.timer); this.timer = undefined;
    this.polling = true;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 15_000);
    try {
      const response = await this.fetcher(ANNOUNCEMENTS_URL, { signal: this.controller.signal, redirect: "error", headers: { Accept: "application/rss+xml, application/xml, text/xml" } });
      if (!response.ok || !response.body) throw new Error("Feed unavailable");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("Feed too large"); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const now = new Date();
      const items = parseAnnouncements(Buffer.concat(chunks).toString("utf8"), now);
      if (this.closed) return;
      await this.store.transaction(async query => {
        for (const item of items) await query("INSERT INTO alpha_wire_items (id,payload,received_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT (id) DO NOTHING", [item.id, JSON.stringify(item), item.receivedAt]);
        await query("DELETE FROM alpha_wire_items WHERE received_at < now() - interval '30 days'");
      });
      this.source = { ...this.source, status: "healthy", lastCheckedAt: now.toISOString(), lastSuccessAt: now.toISOString() };
    } catch {
      this.source = { ...this.source, status: "unavailable", lastCheckedAt: new Date().toISOString() };
    } finally {
      clearTimeout(timeout); this.polling = false;
      if (!this.closed) {
        this.notify();
        // NSE's RSS response advertises <ttl>5</ttl> (minutes).
        this.timer = setTimeout(() => { this.timer = undefined; void this.poll(); }, 300_000);
        this.timer.unref();
      }
    }
  }
}
