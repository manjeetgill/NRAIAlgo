import { describe, expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES, OverviewSnapshotSchema, type OverviewSnapshot } from "@nraialgo/contracts";
import { LiveOverview } from "./live-overview.js";
import type { FeedFactory, FeedMessage } from "./kite-feed.js";
import { KotakLiveOverview } from "./kotak-live-overview.js";
import type { KotakMessage } from "./kotak-feed.js";

function setup() {
  let time = Date.parse("2026-09-21T06:00:00Z");
  const feeds: { receive: (message: FeedMessage) => void; stop: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> }[] = [];
  const factory: FeedFactory = (_credentials, receive) => {
    const feed = { receive, stop: vi.fn(), subscribe: vi.fn() };
    feeds.push(feed);
    return feed;
  };
  const service = new LiveOverview(factory, () => time);
  const credentials = { apiKey: "key", accessToken: "token", accountId: "AB1234" };
  const snapshot: OverviewSnapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
  snapshot.generatedAt = new Date(time).toISOString();
  snapshot.positions = { status: "available", source: "zerodha-positions", asOf: snapshot.generatedAt, version: 1, reason: null, data: [
    { provider: "zerodha", accountId: "AB1234", instrumentToken: 100, exchange: "NFO", symbol: "TEST-FUT", product: "NRML", quantity: -2, multiplier: 10, averagePrice: 100, lastPrice: 100, pnlPaise: 0, asOf: snapshot.generatedAt, fresh: false },
  ] };
  const workspace = snapshot.scope.workspaceId;
  service.ensure(workspace, credentials);
  const emit = (message: FeedMessage) => feeds.at(-1)!.receive(message);
  const connect = () => {
    emit({ type: "indices", indices: [1, 2, 3].map(token => ({ token, instrumentId: `NSE:${token}`, label: `Index ${token}` })) });
    emit({ type: "state", state: "streaming" });
    service.reconciled(workspace, service.reconciliationVersion(workspace));
  };
  const tick = (token: number, price: number, source = time) => emit({ type: "ticks", ticks: [{ token, price, exchangeTime: new Date(source).toISOString() }] });
  return { service, credentials, snapshot, workspace, feeds, emit, connect, tick, advance: (ms: number) => { time += ms; } };
}

describe("workspace-isolated live overview", () => {
  it("subscribes holdings and revalues ticks without changing quantities or double counting", () => {
    const s = setup();
    const row = { provider:"zerodha", accountId:"AB1234", symbol:"EQUITY", instrumentToken:200, quantity:10, pledgedQuantity:2, marketValuePaise:100000, ltpPaise:10000, investedPaise:90000, unrealizedPaise:10000, dayPnlPaise:1000, priceAsOf:s.snapshot.generatedAt };
    s.snapshot.holdings.data!.holdings = [row];
    s.connect(); s.advance(1000); s.tick(200,105);
    const first = s.service.overlay(s.snapshot);
    expect(s.feeds[0]!.subscribe).toHaveBeenCalledWith([100,200]);
    expect(first.holdings.data!.holdings[0]).toMatchObject({quantity:10,pledgedQuantity:2,ltpPaise:10500,marketValuePaise:105000,investedPaise:90000,unrealizedPaise:15000,dayPnlPaise:6000,fresh:true});
    expect(s.service.overlay(s.snapshot).holdings).toEqual(first.holdings);
    expect(s.snapshot.holdings.data!.holdings[0]).toEqual(row);
    expect(first.pnl).toEqual(s.snapshot.pnl);
    s.advance(16000);
    expect(s.service.overlay(s.snapshot).holdings.data!.holdings[0]).toMatchObject({ltpPaise:10000,fresh:false});
  });

  it("preserves Kotak connection and position data without treating its token as a Kite token", () => {
    const s = setup();
    s.snapshot.positions!.data!.push({...s.snapshot.positions!.data![0]!,provider:'kotak',accountId:'K1',instrumentToken:999,pnlPaise:12000});
    s.snapshot.connections = {status:'available',source:'broker-reads',asOf:s.snapshot.generatedAt,version:1,reason:null,data:[{source:'kotak',status:'connected',latencyMs:null,asOf:s.snapshot.generatedAt}]};
    s.connect(); s.tick(999, 999);
    const result=s.service.overlay(s.snapshot);
    expect(s.feeds[0]!.subscribe).toHaveBeenCalledWith([100]);
    expect(result.positions!.data![1]).toMatchObject({provider:'kotak',lastPrice:100,pnlPaise:12000,fresh:false});
    expect(result.connections.data?.some(c=>c.source==='kotak')).toBe(true);
  });
  it("shares one socket across repeated requests but never across workspaces", () => {
    const s = setup();
    s.service.ensure(s.workspace, s.credentials);
    expect(s.feeds).toHaveLength(1);
    s.connect(); s.tick(1, 123);
    const other = { ...s.snapshot, scope: { ...s.snapshot.scope, workspaceId: "other" } };
    expect(s.service.overlay(other).prices).toEqual(other.prices);
    s.service.ensure("other", s.credentials);
    expect(s.feeds).toHaveLength(2);
    expect(s.service.overlay(other).prices).toEqual(other.prices);
    s.service.close();
    expect(s.feeds.every(feed => feed.stop.mock.calls.length === 1)).toBe(true);
  });

  it("rotates credentials and ignores late messages from the old worker", () => {
    const s = setup();
    s.connect(); s.tick(1, 123);
    s.service.ensure(s.workspace, { ...s.credentials, accessToken: "new-token" });
    expect(s.feeds[0]!.stop).toHaveBeenCalledOnce();
    s.feeds[0]!.receive({ type: "ticks", ticks: [{ token: 1, price: 999, exchangeTime: null }] });
    expect(s.service.overlay(s.snapshot).marketStream?.lastTickAt).toBeNull();
    s.service.ensure(s.workspace, null);
    expect(s.feeds[1]!.stop).toHaveBeenCalledOnce();
    expect(s.service.overlay(s.snapshot).marketStream).toBeUndefined();
  });

  it("publishes fresh indices without turning market data into execution authorization", () => {
    const s = setup(); s.connect();
    [1, 2, 3].forEach(token => s.tick(token, 100 + token));
    const result = s.service.overlay(s.snapshot);
    expect(result.prices.source).toBe("zerodha-websocket");
    expect(result.prices.data?.every(quote => quote.fresh)).toBe(true);
    expect(result.readiness.data?.checks.priceFeed.status).toBe("passed");
    expect(result.readiness.data?.liveTradeEligible).toBe(false);
    expect(() => OverviewSnapshotSchema.parse(result)).not.toThrow();
    expect(JSON.stringify(result)).not.toContain("accessToken");
  });

  it("revalues signed quantities with the multiplier without double-counting ticks", () => {
    const s = setup(); s.connect(); s.advance(1000); s.tick(100, 105);
    const result = s.service.overlay(s.snapshot);
    expect(result.positions?.data?.[0]?.pnlPaise).toBe(-10000);
    expect(result.pnl.data!.grossPaise).toBe(s.snapshot.pnl.data!.grossPaise - 10000);
    expect(result.pnl.data!.netPaise).toBe(s.snapshot.pnl.data!.netPaise! - 10000);
    expect(s.service.overlay(s.snapshot).pnl).toEqual(result.pnl);
    expect(s.snapshot.positions!.data![0]!.lastPrice).toBe(100);
    expect(s.feeds[0]!.subscribe).toHaveBeenCalledWith([100]);
    expect(() => OverviewSnapshotSchema.parse(result)).not.toThrow();
  });

  it("does not accept stale exchange timestamps, invalid prices or out-of-order ticks as fresh", () => {
    const s = setup(); s.connect(); s.tick(1, 120); s.tick(1, 1, Date.parse(s.snapshot.generatedAt) - 1000);
    s.tick(1, NaN);
    expect(s.service.overlay(s.snapshot).prices.data?.[0]?.value).toBe(120);
    s.advance(16_000);
    const stale = s.service.overlay(s.snapshot);
    expect(stale.prices.status).toBe("degraded");
    expect(stale.prices.data?.[0]?.fresh).toBe(false);
    expect(stale.marketStream?.status).toBe("stale");
    s.tick(2, 300, Date.parse(s.snapshot.generatedAt));
    expect(s.service.overlay(s.snapshot).prices.data?.[1]?.fresh).toBe(false);
  });

  it("requires new ticks after reconnect and requests account reconciliation", () => {
    const s = setup(); s.connect(); s.tick(1, 120);
    s.emit({ type: "state", state: "reconnecting" });
    expect(s.service.overlay(s.snapshot).marketStream?.lastTickAt).toBeNull();
    s.emit({ type: "order" });
    expect(s.service.needsReconciliation(s.workspace)).toBe(true);
    s.service.reconciled(s.workspace, s.service.reconciliationVersion(s.workspace));
    expect(s.service.needsReconciliation(s.workspace)).toBe(false);
  });

  it("stops projecting MTM when account quantities have not reconciled for 30 seconds", () => {
    const s = setup(); s.connect(); s.advance(31_000); s.tick(100, 200);
    const result = s.service.overlay(s.snapshot);
    expect(result.positions?.data?.[0]?.fresh).toBe(false);
    expect(result.positions?.status).toBe("degraded");
    expect(result.pnl.data?.grossPaise).toBe(s.snapshot.pnl.data?.grossPaise);
  });

  it("blocks old quantities until a successful read covers the latest event, including same-millisecond events", () => {
    const s = setup(); s.connect();
    s.emit({ type: "order" });
    const version = s.service.reconciliationVersion(s.workspace);
    s.tick(100, 105);
    expect(s.service.overlay(s.snapshot).positions?.data?.[0]).toMatchObject({ fresh: false, pnlPaise: 0 });
    s.emit({ type: "order" });
    s.service.reconciled(s.workspace, version);
    expect(s.service.needsReconciliation(s.workspace)).toBe(true);
    s.service.reconciled(s.workspace, s.service.reconciliationVersion(s.workspace));
    expect(s.service.overlay(s.snapshot).positions?.data?.[0]).toMatchObject({ fresh: true, pnlPaise: -10000 });
  });

  it("never clears a new credential generation using an older read", () => {
    const s = setup(); const version = s.service.reconciliationVersion(s.workspace);
    s.service.ensure(s.workspace, { ...s.credentials, accessToken: "rotated" });
    s.service.reconciled(s.workspace, version);
    expect(s.service.needsReconciliation(s.workspace)).toBe(true);
  });

  it("keeps closing references outside regular hours and prunes idle sockets", () => {
    const s = setup(); s.connect(); s.tick(1, 120);
    const closed = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    closed.scope.workspaceId = s.workspace;
    const result = s.service.overlay(closed);
    expect(result.prices).toEqual(closed.prices);
    expect(result.readiness.data?.checks.priceFeed.status).toBe("not_applicable");
    s.advance(61_000); s.service.prune();
    expect(s.feeds[0]!.stop).toHaveBeenCalledOnce();
  });

  it("uses dated, non-live Zerodha observations when the official close is unavailable", () => {
    const s = setup(); s.connect();
    [1, 2, 3].forEach(token => s.tick(token, 100 + token));
    const closed = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES['after-close']);
    closed.scope.workspaceId = s.workspace;
    closed.prices = { status: 'unavailable', source: 'nse-bhavcopy', asOf: null, version: 0, data: null, reason: 'HTTP 404' };
    s.advance(5 * 60 * 60 * 1000);
    const result = s.service.overlay(closed);
    expect(result.prices.status).toBe('degraded');
    expect(result.prices.source).toBe('zerodha-websocket');
    expect(result.prices.reason).toContain('HTTP 404');
    expect(result.prices.data).toHaveLength(3);
    expect(result.prices.data?.every(q => q.priceBasis === 'last-observed' && !q.fresh)).toBe(true);
    expect(result.prices.asOf).toBe(s.snapshot.generatedAt);
    expect(result.readiness.data?.liveTradeEligible).toBe(false);
    expect(() => OverviewSnapshotSchema.parse(result)).not.toThrow();
    // Publication replaces the fallback without altering the official values.
    const official = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES['after-close']);
    official.scope.workspaceId = s.workspace;
    official.prices.data![0]!.priceBasis = 'official-close';
    expect(s.service.overlay(official).prices).toEqual(official.prices);
    s.service.ensure(s.workspace, { ...s.credentials, accessToken: 'rotated' });
    expect(s.service.overlay(closed).prices).toEqual(closed.prices);
  });
});

describe('Kotak streaming',()=>{
 it('requires reconciliation, isolates provider/exchange, expires ticks and does not double-count',()=>{
  let now=Date.parse('2026-09-22T06:00:00Z');let receive:(m:KotakMessage)=>void=()=>{};
  const stop=vi.fn();const service=new KotakLiveOverview((_c,r)=>{receive=r;return {subscribe:vi.fn(),stop};},()=>now);
  const base=structuredClone(OVERVIEW_SNAPSHOT_FIXTURES['market-open']);base.generatedAt=new Date(now).toISOString();
  base.positions={status:'available',source:'kotak',version:1,asOf:base.generatedAt,reason:null,data:[{provider:'kotak',accountId:'K',exchange:'nse_fo',instrumentToken:123,symbol:'TEST',product:'NRML',quantity:65,multiplier:1,averagePrice:100,lastPrice:100,pnlPaise:0,asOf:base.generatedAt,fresh:false}]};
  const creds={session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'K'};
  service.ensure(base.scope.workspaceId,creds);receive({type:'state',channel:'market',state:'streaming'});
  now+=1000;receive({type:'tick',key:'nse_fo|123',price:110,sourceAt:now});
  expect(service.overlay(base).positions!.data![0]!.fresh).toBe(false);
  service.reconciled(base.scope.workspaceId,service.reconciliationVersion(base.scope.workspaceId));
  expect(service.overlay(base).positions!.data![0]!.pnlPaise).toBe(65000);
  expect(service.overlay(base).positions!.data![0]!.pnlPaise).toBe(65000);
  receive({type:'tick',key:'bse_fo|123',price:900,sourceAt:now});
  expect(service.overlay(base).positions!.data![0]!.lastPrice).toBe(110);
  receive({type:'order'});expect(service.needsReconciliation(base.scope.workspaceId)).toBe(true);
  const version=service.reconciliationVersion(base.scope.workspaceId);
  receive({type:'order'}); // Same millisecond must still invalidate an in-flight read.
  service.reconciled(base.scope.workspaceId,version);expect(service.needsReconciliation(base.scope.workspaceId)).toBe(true);
  service.reconciled(base.scope.workspaceId,service.reconciliationVersion(base.scope.workspaceId));now+=16000;
  expect(service.overlay(base).positions!.data![0]!.fresh).toBe(false);
  now+=15000;
  const stale=service.overlay(base);
  expect(stale.holdings.status).toBe('degraded');
  expect(stale.holdings.reason).toContain('Kotak account reconciliation');
  expect(stale.pnl.status).toBe('degraded');
  service.ensure(base.scope.workspaceId,null);expect(stop).toHaveBeenCalledOnce();
 });
 it('uses its own reconciliation timestamp, not a newer combined snapshot timestamp',()=>{
  const now=Date.parse('2026-09-22T06:00:00Z');
  const service=new KotakLiveOverview(()=>({subscribe:vi.fn(),stop:vi.fn()}),()=>now);
  const base=structuredClone(OVERVIEW_SNAPSHOT_FIXTURES['market-open']);base.generatedAt=new Date(now).toISOString();
  base.brokerReconciliation={kotak:{accountId:'K',status:'confirmed',asOf:new Date(now-31000).toISOString()}};
  service.ensure(base.scope.workspaceId,{session:{token:'t',sid:'s',baseUrl:'https://mis.kotaksecurities.com'},accountId:'K'});
  service.reconciled(base.scope.workspaceId,service.reconciliationVersion(base.scope.workspaceId));
  expect(service.overlay(base).holdings.status).toBe('degraded');
 });
});
