import type { OverviewSnapshot } from "@nraialgo/contracts";
import type { ZerodhaInputs } from "../build-overview-snapshot.js";
import { createKiteFeed, type Feed, type FeedFactory, type FeedMessage } from "./kite-feed.js";
import { accountIsStale, degradeAccountPanels } from "./account-freshness.js";

export const TICK_MAX_AGE_MS = 15_000;
type Tick = { price: number; receivedAt: number; sourceAt: number };
type Entry = {
  credentials: ZerodhaInputs; feed: Feed; usedAt: number;
  state: "connecting" | "streaming" | "reconnecting" | "unavailable";
  indices: { token: number; instrumentId: string; label: string }[];
  ticks: Map<number, Tick>; lastTickAt: number | null; reconcile: boolean; generation: number;
};

/** One feed per active workspace in this API process. For multiple replicas,
 * deploy a dedicated market-data owner/pubsub service before scaling out. */
export class LiveOverview {
  private entries = new Map<string, Entry>();
  private generation = 0;
  constructor(private factory: FeedFactory = createKiteFeed, private clock = Date.now) {}

  ensure(workspace: string, credentials: ZerodhaInputs | null) {
    let entry = this.entries.get(workspace);
    if (entry && (!credentials || entry.credentials.accessToken !== credentials.accessToken || entry.credentials.apiKey !== credentials.apiKey || entry.credentials.accountId !== credentials.accountId)) {
      this.remove(workspace);
      entry = undefined;
    }
    if (!credentials) return;
    if (entry) { entry.usedAt = this.clock(); return; }
    // Bounded resource use and per-key Kite connection budget (in-process).
    if (this.entries.size >= 32 || [...this.entries.values()].filter(e => e.credentials.apiKey === credentials.apiKey).length >= 3) return;
    const created: Entry = { credentials, feed: { subscribe() {}, stop() {} }, usedAt: this.clock(), state: "connecting", indices: [], ticks: new Map(), lastTickAt: null, reconcile: true, generation: ++this.generation };
    this.entries.set(workspace, created);
    created.feed = this.factory(credentials, message => {
      if (this.entries.get(workspace) === created) this.receive(created, message);
    });
  }

  private receive(entry: Entry, message: FeedMessage) {
    if (message.type === "state") {
      entry.state = message.state;
      entry.reconcile = true;
      entry.generation = ++this.generation;
      if (message.state !== "streaming") { entry.ticks.clear(); entry.lastTickAt = null; }
    } else if (message.type === "indices") entry.indices = message.indices;
    else if (message.type === "order") { entry.reconcile = true; entry.generation = ++this.generation; }
    else {
      const now = this.clock();
      for (const tick of message.ticks) {
        if (!Number.isInteger(tick.token) || tick.token <= 0 || !Number.isFinite(tick.price) || tick.price <= 0) continue;
        const sourceAt = tick.exchangeTime ? Date.parse(tick.exchangeTime) : now;
        if (!Number.isFinite(sourceAt) || sourceAt > now + 5000) continue;
        const previous = entry.ticks.get(tick.token);
        if (previous && sourceAt < previous.sourceAt) continue;
        entry.ticks.set(tick.token, { price: tick.price, receivedAt: now, sourceAt });
        entry.lastTickAt = now;
      }
    }
  }

  needsReconciliation(workspace: string) { return this.entries.get(workspace)?.reconcile ?? false; }
  reconciliationVersion(workspace: string) { return this.entries.get(workspace)?.generation; }
  reconciled(workspace: string, generation: number | undefined) {
    const entry = this.entries.get(workspace);
    if (entry && generation === entry.generation) entry.reconcile = false;
  }
  prune() {
    for (const [workspace, entry] of this.entries) if (this.clock() - entry.usedAt > 60_000) this.remove(workspace);
  }
  private remove(workspace: string) {
    const entry = this.entries.get(workspace);
    this.entries.delete(workspace);
    entry?.feed.stop();
  }
  close() { for (const workspace of this.entries.keys()) this.remove(workspace); }

  overlay(base: OverviewSnapshot): OverviewSnapshot {
    const entry = this.entries.get(base.scope.workspaceId);
    if (!entry) return base;
    const now = this.clock();
    const nowIso = new Date(now).toISOString();
    entry.usedAt = now;
    const open = base.session.data?.calendarValid && base.session.data.state === "market-open";
    const fresh = (tick: Tick) => !!open && entry.state === "streaming" && now - tick.receivedAt <= TICK_MAX_AGE_MS && now - tick.sourceAt <= TICK_MAX_AGE_MS;
    const snapshot = structuredClone(base);
    const accountStale = accountIsStale(base, "zerodha", entry.credentials.accountId, now);
    if (accountStale || entry.reconcile) degradeAccountPanels(snapshot, "Zerodha");
    const streamStatus = entry.state === "streaming" && open && (entry.lastTickAt == null || now - entry.lastTickAt > TICK_MAX_AGE_MS) ? "stale" : entry.state;
    snapshot.marketStream = { status: streamStatus, lastTickAt: entry.lastTickAt == null ? null : new Date(entry.lastTickAt).toISOString(), displayIntervalMs: 1000, accountIntervalMs: 10_000, reason: streamStatus === "streaming" ? null : "No current tick stream; verify feed health, Zerodha daily login and data subscription" };
    const quotes = entry.indices.flatMap(index => {
      const tick = entry.ticks.get(index.token);
      return tick ? [{ instrumentId: index.instrumentId, label: index.label, value: tick.price, priceBasis: fresh(tick) ? "ltp" as const : "last-observed" as const, sourceAsOf: new Date(tick.sourceAt).toISOString(), receivedAt: new Date(tick.receivedAt).toISOString(), fresh: fresh(tick) }] : [];
    });
    // Keep the official closing reference outside regular market hours.
    if (open && quotes.length) snapshot.prices = quotes.length === 3 && quotes.every(q => q.fresh)
      ? { status: "available", source: "zerodha-websocket", asOf: nowIso, version: now, reason: null, data: quotes }
      : { status: "degraded", source: "zerodha-websocket", asOf: nowIso, version: now, reason: "Some index ticks are missing or stale", data: quotes };
    const closed = base.session.data?.calendarValid && ["after-close", "weekend-holiday"].includes(base.session.data.state);
    if (closed && base.prices.status === "unavailable" && quotes.length) {
      snapshot.prices = {
        status: "degraded", source: "zerodha-websocket",
        // Receipt time of the observations, not the time this view was polled.
        asOf: quotes.reduce((latest, quote) => quote.receivedAt > latest ? quote.receivedAt : latest, quotes[0]!.receivedAt),
        version: now,
        reason: `Official closing reference unavailable; showing last observed Zerodha prices. ${base.prices.reason}`,
        data: quotes.map(quote => ({ ...quote, priceBasis: "last-observed", fresh: false })),
      };
    }
    if (snapshot.readiness.data) snapshot.readiness.data.checks.priceFeed = !open
      ? { status: "not_applicable", reason: "Regular market is not open" }
      : { status: quotes.length === 3 && quotes.every(q => q.fresh) ? "passed" : "unknown", reason: quotes.length === 3 && quotes.every(q => q.fresh) ? null : "Waiting for fresh index ticks" };
    if (snapshot.readiness.data) snapshot.readiness.data.liveTradeEligible = false;
    const positions = snapshot.positions?.data;
    entry.feed.subscribe((positions ?? []).filter(row => row.provider === "zerodha" && row.accountId === entry.credentials.accountId).map(row => row.instrumentToken));
    let delta = 0;
    let anyRevalued = false;
    for (const row of positions ?? []) {
      if (row.provider !== "zerodha" || row.accountId !== entry.credentials.accountId) continue;
      const tick = entry.ticks.get(row.instrumentToken);
      // REST is the quantity/account authority. Never apply a tick older than
      // that baseline; this also avoids a price jumping backwards after refresh.
      if (accountStale || entry.reconcile || !tick || !fresh(tick) || tick.sourceAt < Date.parse(row.asOf)) { row.fresh = false; continue; }
      const change = Math.round((tick.price - row.lastPrice) * row.quantity * row.multiplier * 100);
      row.pnlPaise += change;
      row.lastPrice = tick.price;
      row.asOf = new Date(tick.receivedAt).toISOString();
      row.fresh = true;
      delta += change;
      anyRevalued = true;
    }
    if (snapshot.pnl.data && anyRevalued) {
      snapshot.pnl.data.unrealisedPaise += delta;
      snapshot.pnl.data.grossPaise += delta;
      if (snapshot.pnl.data.netPaise != null) snapshot.pnl.data.netPaise += delta;
      snapshot.pnl.data.valuationAsOf = nowIso;
      snapshot.pnl.source += "+tick-estimate";
    }
    // Connection status is not a measured latency. No made-up ping values.
    snapshot.connections = { status: "available", source: "broker-reads+zerodha-feed-worker", asOf: nowIso, version: now, reason: null, data: [...(snapshot.connections.data ?? []).filter(connection => !connection.source.toLowerCase().includes("zerodha")), { source: `Zerodha WebSocket (${entry.state})`, status: entry.state === "streaming" ? "connected" : "session_ended", latencyMs: null, asOf: entry.lastTickAt == null ? nowIso : new Date(entry.lastTickAt).toISOString() }] };
    return snapshot;
  }
}
