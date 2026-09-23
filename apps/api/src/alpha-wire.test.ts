import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import sensible from "@fastify/sensible";
import { AlphaWire, parseAnnouncements, safeAnnouncementUrl } from "./alpha-wire.js";
import { alphaWireRoutes } from "./routes/alpha-wire.js";
import type { Store, Query } from "./database.js";
import type { AlphaWireItem } from "@nraialgo/contracts";
import { safeNewsUrl } from "@nraialgo/contracts";
import { providers, parseRss } from "./news-providers.js";
import { MultiSourceWire } from "./multi-source-wire.js";

const xml = `<rss><channel><item><title><![CDATA[ACME &amp; Co — Board meeting]]></title><link>https://nsearchives.nseindia.com/example.pdf</link><pubDate>Tue, 22 Sep 2026 09:00:00 +0530</pubDate></item></channel></rss>`;
function memoryStore() {
  const rows = new Map<string, AlphaWireItem>();
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("INSERT") && !rows.has(String(params![0]))) rows.set(String(params![0]), JSON.parse(String(params![1])));
    if (sql.startsWith("SELECT payload")) return [...rows.values()].map(payload => ({ payload }));
    return [];
  });
  const store: Store = { async transaction(fn) { return fn(query as Query); }, async close() {} };
  return { store, query };
}
describe("Alpha Wire", () => {
  it("registers official feeds and parses BSE filing subjects and unzoned Indian RSS dates", () => {
    const all = providers({});
    const now = new Date("2026-09-22T12:00:00Z");
    const bse = all.find(p => p.id === "bse")!;
    const xml = '<rss><channel><item><title>Company (123456)</title><description><![CDATA[<p>Quarterly results</p>]]></description><link>https://www.bseindia.com/filing.pdf</link><pubDate>22-Sep-2026 15:48:18</pubDate></item></channel></rss>';
    expect(bse.parse(xml, now)[0]).toMatchObject({ title: "Company (123456) — Quarterly results", publishedAt: "2026-09-22T10:18:18.000Z" });
    // BSE's own <description> sometimes glues a bare filing-type label
    // directly onto the real headline with no punctuation -- verified live
    // (bseindia.com's own feed literally reads "Press Release Brahma raises
    // AI $150 MILLION..." as one string). A separator gets inserted after
    // the known label; anything else (already one coherent sentence) is
    // left untouched.
    const pressRelease = '<rss><channel><item><title>Prime Focus Ltd (532748)</title><description><![CDATA[Press Release Brahma raises AI  $ 150 MILLION ROUND LED BY MULTIPLES]]></description><link>https://www.bseindia.com/filing2.pdf</link><pubDate>22-Sep-2026 15:48:18</pubDate></item></channel></rss>';
    expect(bse.parse(pressRelease, now)[0]?.title).toBe("Prime Focus Ltd (532748) — Press Release — Brahma raises AI $ 150 MILLION ROUND LED BY MULTIPLES");
    const coherent = '<rss><channel><item><title>Prime Focus Ltd (532748)</title><description><![CDATA[Disclosure under Regulation 30 read with Regulation 30A of SEBI Listing Regulations, 2015.]]></description><link>https://www.bseindia.com/filing3.pdf</link><pubDate>22-Sep-2026 15:48:18</pubDate></item></channel></rss>';
    expect(bse.parse(coherent, now)[0]?.title).toBe("Prime Focus Ltd (532748) — Disclosure under Regulation 30 read with Regulation 30A of SEBI Listing Regulations, 2015.");
    const rbi = all.find(p => p.id === "rbi_notifications")!;
    expect(rbi.parse(xml.replace("22-Sep-2026 15:48:18", "Tue, 22 Sep 2026 15:48:18"), now)[0]?.publishedAt).toBe("2026-09-22T10:18:18.000Z");
    expect(all.find(p => p.id === "pib")?.url).toContain("Lang=1");
    expect(providers({ ALPHA_WIRE_PIB_ENABLED: "false" }).find(p => p.id === "pib")?.disabled).toBe(true);
    expect(() => bse.parse('<!DOCTYPE rss><rss/>', now)).toThrow();
  });
  it("normalizes requested providers without treating discovery time or social posts as verified news", () => {
    const all = providers({}); const now = new Date("2026-09-22T10:00:00Z");
    const parse = (id: string, body: unknown) => all.find(p => p.id === id)!.parse(JSON.stringify(body), now);
    expect(all.find(p => p.id === 'marketaux')?.needsKey).toBe(true);
    expect(all.find(p => p.id === 'alphavantage')?.needsKey).toBe(true);
    const news = parse('gdelt', { articles: [{ title: 'India inflation report', url: 'https://news.example.com/a?utm_source=test', seendate: '20260922T090000Z', domain: 'news.example.com' }] });
    expect(news[0]?.publishedAt).toBeNull(); expect(news[0]?.url).toBe('https://news.example.com/a');
    const market = parse('marketaux', { data: [{ title: 'India inflation report', url: 'https://news.example.com/a', published_at: '2026-09-22T09:00:00Z', entities: [{symbol:'ABC'}] }] });
    expect(market[0]?.id).toBe(news[0]?.id); expect(market[0]?.symbols).toEqual(['ABC']);
    const av = parse('alphavantage', { feed: [{ title: 'Macro', url: 'https://news.example.com/m', time_published: '20260922T090000', overall_sentiment_label: 'Neutral' }] });
    expect(av[0]?.publishedAt).toBe('2026-09-22T09:00:00.000Z'); expect(av[0]?.sentiment).toBe('Neutral');
    expect(() => parse('alphavantage', { Information:'quota exceeded' })).toThrow();
    expect(() => parse('marketaux', { error:'invalid key' })).toThrow();
    const social = parse('mastodon', [{content:'<p>India finance update</p>', url:'https://mastodon.social/@user/123', created_at:'2026-09-22T09:00:00Z', visibility:'public', account:{acct:'user'}}]);
    expect(social[0]?.category).toBe('Social'); expect(social[0]?.title).toBe('India finance update');
    expect(parse('mastodon', [{content:'private',url:'https://mastodon.social/@user/1',visibility:'private',created_at:'2026-09-22T09:00:00Z'}])).toEqual([]);
    expect(parse('bluesky', {posts:[{uri:'at://did:plc:abc/app.bsky.feed.post/123',record:{text:'India economy',createdAt:'2026-09-22T09:00:00Z'},author:{handle:'user.bsky.social'}}]})[0]?.category).toBe('Social');
    expect(safeNewsUrl('https://127.0.0.1/private')).toBeNull(); expect(safeNewsUrl('javascript:alert(1)')).toBeNull();
    expect(parseRss('<rss><channel><item><title>RBI policy</title><link>http://www.rbi.org.in/policy</link><pubDate>22 Sep 2026 15:00:00 +0530</pubDate></item></channel></rss>', {name:'RBI',category:'Macro'}, now)[0]?.url).toBe('https://www.rbi.org.in/policy');
  });
  it("reserves free-tier calls before fetching and retains cooldown across worker restarts", async () => {
    let reserved = false;
    const calls: string[] = [];
    const db: Store = { async transaction(fn) { return fn((async(sql: string) => {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO alpha_wire_poll_state')) { if(reserved) return []; reserved=true; return [{provider:'gdelt'}]; }
      return [];
    }) as Query); }, async close() {} };
    const p = providers({}).find(p=>p.id==='gdelt')!;
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}',{status:429,headers:{'retry-after':'7200'}}));
    const first = new MultiSourceWire(db,http,[p]);
    const second = new MultiSourceWire(db,http,[p]);
    try {
      await Promise.all([first.pollProvider(p),first.pollProvider(p)]);
      expect(http).toHaveBeenCalledTimes(1);
      expect((await first.snapshot()).sources?.find(s=>s.id==='gdelt')?.status).toBe('rate_limited');
      await second.pollProvider(p); expect(http).toHaveBeenCalledTimes(1);
      expect(calls.some(sql=>sql.startsWith('UPDATE alpha_wire_poll_state'))).toBe(true);
    } finally { first.close();second.close(); }
  });
  it("collapses NSE's own duplicate filing (same title, same pubDate, different PDF attachment) into one item", () => {
    // Verified live against NSE's real feed: the same "Outcome of Board
    // Meeting" disclosure filed twice under two different attachment URLs,
    // seconds apart in submission but sharing one displayed pubDate.
    const duplicateFiling = `<rss><channel>
      <item><title>Prime Focus Limited</title><link>https://nsearchives.nseindia.com/corporate/PFOCUS_A.pdf</link><description>Prime Focus Limited has informed the Exchange regarding Outcome of Board Meeting held on September 23, 2026. |SUBJECT: Outcome of Board Meeting</description><pubDate>23-Sep-2026 08:06:53</pubDate></item>
      <item><title>Prime Focus Limited</title><link>https://nsearchives.nseindia.com/corporate/PFOCUS_B.pdf</link><description>Prime Focus Limited has informed the Exchange regarding Outcome of Board Meeting held on September 23, 2026. |SUBJECT: Outcome of Board Meeting</description><pubDate>23-Sep-2026 08:06:53</pubDate></item>
    </channel></rss>`;
    const items = parseAnnouncements(duplicateFiling, new Date("2026-09-23T10:00:00Z"));
    expect(items).toHaveLength(1);
  });

  it("parses dates, deduplicates, rejects unsafe links and never fabricates publication times", () => {
    const items = parseAnnouncements(xml, new Date("2026-09-22T10:00:00Z"));
    expect(items).toHaveLength(1);
    expect(items[0]?.publishedAt).toBe("2026-09-22T03:30:00.000Z");
    expect(parseAnnouncements(xml.replace("Tue, 22 Sep 2026 09:00:00 +0530", "22-Sep-2026 09:00:00"), new Date("2026-09-22T10:00:00Z"))[0]?.publishedAt).toBe("2026-09-22T03:30:00.000Z");
    expect(parseAnnouncements(xml.replace("Tue, 22 Sep 2026 09:00:00 +0530", "unknown"))[0]?.publishedAt).toBeNull();
    expect(parseAnnouncements(xml.replace("https://nsearchives.nseindia.com/example.pdf", "javascript:alert(1)"))).toEqual([]);
    expect(safeAnnouncementUrl("https://nsearchives.nseindia.com.evil.test/a")).toBeNull();
    expect(safeAnnouncementUrl("https://user:password@nsearchives.nseindia.com/a")).toBeNull();
    expect(() => parseAnnouncements("<!DOCTYPE rss><rss/>" )).toThrow();
    expect(() => parseAnnouncements("<html>Access denied</html>" )).toThrow();
    expect(() => parseAnnouncements("<rss><item>" )).toThrow();
  });
  it("persists actual headlines once and retains them when the source fails", async () => {
    const { store, query } = memoryStore();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(xml));
    const wire = new AlphaWire(store, fetcher);
    try {
      await wire.poll();
      const first = await wire.snapshot();
      expect(first.items).toHaveLength(1);
      expect(first.source.status).toBe("healthy");
      await wire.poll();
      expect((await wire.snapshot()).items).toEqual(first.items);
      fetcher.mockRejectedValue(new Error("network unavailable"));
      await wire.poll();
      const failed = await wire.snapshot();
      expect(failed.items).toEqual(first.items);
      expect(failed.source.status).toBe("unavailable");
      expect(failed.source.lastSuccessAt).not.toBeNull();
      expect(query.mock.calls.some(([sql]) => sql.includes("30 days"))).toBe(true);
    } finally { wire.close(); }
  });
  it("does not fetch when disabled, and both endpoints require authentication", async () => {
    const { store } = memoryStore();
    const fetcher = vi.fn<typeof fetch>();
    const wire = new AlphaWire(store, fetcher, false);
    await wire.poll(); expect(fetcher).not.toHaveBeenCalled();
    expect((await wire.snapshot()).source.status).toBe("disabled");
    const app = Fastify(); app.register(cookie); app.register(sensible); app.register(alphaWireRoutes(store, wire));
    try {
      expect((await app.inject("/v1/alpha-wire")).statusCode).toBe(401);
      expect((await app.inject("/v1/alpha-wire/stream")).statusCode).toBe(401);
    } finally { await app.close(); }
  });
  it("serves stream snapshots and releases connections on shutdown", async () => {
    let authenticated = true;
    const { store } = memoryStore();
    const original = store.transaction.bind(store);
    store.transaction = fn => original(query => fn((async (sql, params) => sql.includes("JOIN users") ? authenticated ? [{ id: "owner", email: "owner@example.com" }] : [] : query(sql, params)) as Query));
    const wire = new AlphaWire(store, vi.fn(), false);
    const app = Fastify(); app.register(cookie); app.register(sensible); app.register(alphaWireRoutes(store, wire));
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test server");
    const abort = new AbortController();
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/alpha-wire/stream`, { headers: { cookie: "nraialgo_session=test" }, signal: abort.signal });
      expect(response.headers.get("content-type")).toBe("text/event-stream");
      const reader = response.body!.getReader();
      let body = "";
      while (!body.includes("event: snapshot")) body += new TextDecoder().decode((await reader.read()).value);
      expect(body).toContain('"items":[]');
      authenticated = false;
      // Closing server must release streams without waiting for client disconnect.
      await app.close();
    } finally { abort.abort(); await app.close(); }
  });
});
