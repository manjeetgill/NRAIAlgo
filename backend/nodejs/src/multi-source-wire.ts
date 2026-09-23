import type { AlphaWireItem, AlphaWireSnapshot } from "@nraialgo/contracts";
import type { Store } from "./database/database.js";
import { AlphaWire } from "./alpha-wire.js";
import { providers, type NewsProvider } from "./news-providers.js";

type Status = NonNullable<AlphaWireSnapshot["sources"]>[number];
export class MultiSourceWire extends AlphaWire {
  private schedule: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  private inflight = new Map<string, AbortController>();
  private states = new Map<string, Status>();
  constructor(private db: Store, private http: typeof fetch = fetch, private configs = providers(), private active = process.env.ALPHA_WIRE_ENABLED !== "false") {
    super(db, http, active);
    for (const p of configs) this.states.set(p.id, { id: p.id, name: p.name, category: p.category, status: !active || p.disabled ? "disabled" : p.needsKey ? "key_required" : "waiting", lastCheckedAt: null, lastSuccessAt: null, pollIntervalSeconds: p.interval });
  }
  override start() {
    super.start(); if (!this.active || this.schedule || this.stopped) return;
    const run = () => { for (const p of this.configs) void this.pollProvider(p); };
    run(); this.schedule = setInterval(run, 30_000); this.schedule.unref();
  }
  override close() { this.stopped = true; clearInterval(this.schedule); for (const c of this.inflight.values()) c.abort(); super.close(); }
  override async snapshot(): Promise<AlphaWireSnapshot> {
    const base = await super.snapshot();
    // Reserve space for every source so busy NSE announcements cannot hide macro/news.
    const rows = await this.db.transaction(q => q<{ payload: AlphaWireItem }>(`SELECT payload FROM (
      SELECT payload, received_at, ROW_NUMBER() OVER (PARTITION BY payload->>'source'
        ORDER BY COALESCE((payload->>'publishedAt')::timestamptz, received_at) DESC, id DESC) AS rank
      FROM alpha_wire_items WHERE received_at > now() - interval '30 days'
    ) ranked WHERE rank <= 25 ORDER BY COALESCE((payload->>'publishedAt')::timestamptz, received_at) DESC LIMIT 200`));
    return { ...base, items: rows.map(r => r.payload), sources: [{ id: "nse", name: "NSE announcements", category: "Announcements", ...base.source }, ...this.states.values()] };
  }
  async pollProvider(p: NewsProvider) {
    if (this.stopped || !this.active || p.disabled || p.needsKey || this.inflight.has(p.id)) return;
    const controller = new AbortController(); this.inflight.set(p.id, controller);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let changed = false;
    const state = this.states.get(p.id)!;
    try {
      // Reserve BEFORE outbound call, atomically across restarts/processes. An API
      // restart never resets free-tier spacing. Failure still consumes the slot.
      const reserved = await this.db.transaction(q => q(`INSERT INTO alpha_wire_poll_state(provider,next_poll_at)
        VALUES ($1, now() + $2 * interval '1 second') ON CONFLICT(provider) DO UPDATE
        SET next_poll_at=EXCLUDED.next_poll_at WHERE alpha_wire_poll_state.next_poll_at <= now() RETURNING provider`, [p.id, p.interval]));
      if (!reserved.length || this.stopped) return;
      changed = true;
      timeout = setTimeout(() => controller.abort(), 15_000);
      const response = await this.http(p.url, { signal: controller.signal, redirect: "error", headers: { Accept: "application/json, application/rss+xml, application/xml, text/xml", ...p.headers } });
      state.lastCheckedAt = new Date().toISOString();
      if (!response.ok) {
        state.status = response.status === 429 ? "rate_limited" : [401,403].includes(response.status) ? "access_denied" : "unavailable";
        const retry = response.headers.get("retry-after");
        const delay = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 0;
        const backoff = Math.min(86400, Math.max(p.interval, Number.isFinite(delay) ? delay : 0, response.status === 429 || response.status === 403 ? 3600 : 0));
        await this.db.transaction(q => q("UPDATE alpha_wire_poll_state SET next_poll_at=GREATEST(next_poll_at,now() + $2 * interval '1 second') WHERE provider=$1", [p.id, backoff]));
        await response.body?.cancel(); return;
      }
      if (!response.body) throw new Error("Empty provider response");
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      const maxBytes = p.id === "bse" ? 5_000_000 : 2_000_000;
      try { while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.length; if (bytes > maxBytes) { await reader.cancel(); throw new Error("Feed too large"); } chunks.push(r.value); } } finally { reader.releaseLock(); }
      const now = new Date(); const items = p.parse(Buffer.concat(chunks).toString("utf8"), now);
      if (this.stopped) return;
      await this.db.transaction(async q => {
        for (const entry of items) await q("INSERT INTO alpha_wire_items(id,payload,received_at) VALUES($1,$2::jsonb,$3) ON CONFLICT(id) DO NOTHING", [entry.id, JSON.stringify(entry), entry.receivedAt]);
        await q("DELETE FROM alpha_wire_items WHERE received_at < now() - interval '30 days'");
      });
      state.status = "healthy"; state.lastSuccessAt = now.toISOString();
    } catch { changed = true; state.status = "unavailable"; state.lastCheckedAt = new Date().toISOString(); }
    finally { clearTimeout(timeout); this.inflight.delete(p.id); if (!this.stopped && changed) this.notify(); }
  }
}
