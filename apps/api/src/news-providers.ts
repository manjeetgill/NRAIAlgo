import { createHash } from "node:crypto";
import { SaxesParser } from "saxes";
import { safeNewsUrl, type AlphaWireItem } from "@nraialgo/contracts";

export interface NewsProvider {
  id: string; name: string; category: AlphaWireItem["category"]; interval: number;
  url: string; headers?: Record<string, string>; needsKey?: boolean; disabled: boolean;
  parse(body: string, now: Date): AlphaWireItem[];
}
const text = (value: unknown) => typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) : "";
function date(value: unknown, now: Date) {
  let raw = typeof value === "string" ? value.trim() : "";
  if (/^\d{8}T\d{6}Z?$/.test(raw)) raw = raw.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z");
  // Official Indian RSS publishers sometimes omit the timezone.
  if (/^(?:[A-Za-z]{3}, )?\d{1,2}[- ][A-Za-z]{3}[- ]\d{4} \d{2}:\d{2}:\d{2}$/.test(raw)) raw += " +0530";
  if (!/(Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(raw)) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms <= now.getTime() + 300_000 ? new Date(ms).toISOString() : null;
}
function item(p: Pick<NewsProvider, "name" | "category">, title: unknown, link: unknown, published: unknown, now: Date, extra: Partial<AlphaWireItem> = {}): AlphaWireItem | null {
  const headline = text(title); const url = typeof link === "string" ? safeNewsUrl(link) : null;
  if (!headline || !url) return null;
  // Provider-independent canonical URL + title key deduplicates overlapping aggregators.
  const id = createHash("sha256").update(JSON.stringify([url, headline.toLowerCase()])).digest("hex");
  return { ...extra, id, title: headline, url, source: p.name, category: p.category, publishedAt: date(published, now), receivedAt: now.toISOString() };
}
export function parseRss(body: string, provider: Pick<NewsProvider, "name" | "category">, now: Date) {
  const maxBytes = provider.name === "BSE announcements" ? 5_000_000 : 2_000_000;
  if (Buffer.byteLength(body) > maxBytes || /<!DOCTYPE|<!ENTITY/i.test(body)) throw new Error("Invalid RSS");
  const parser = new SaxesParser({ xmlns: false }); const stack: string[] = []; const result: AlphaWireItem[] = [];
  let fields: Record<string, string> | undefined; let root = "";
  parser.on("opentag", tag => { if (!stack.length) root = tag.name; stack.push(tag.name.toLowerCase()); if (tag.name.toLowerCase() === "item") fields = {}; });
  const append = (v: string) => { const k = stack.at(-1); if (fields && k && ["title", "link", "pubdate", "description"].includes(k)) fields[k] = (fields[k] ?? "") + v; };
  parser.on("text", append); parser.on("cdata", append);
  parser.on("closetag", () => {
    if (stack.pop() !== "item" || !fields) return;
    let url = fields.link?.trim() ?? "";
    // Official RSS links use HTTP; offer the same official resource over HTTPS.
    url = url.replace(/^http:\/\/(www\.)?(rbi\.org\.in|sebi\.gov\.in|bseindia\.com|pib\.gov\.in)\//i, "https://$1$2/");
    const title = provider.name === "BSE announcements" && text(fields.description)
      ? `${text(fields.title)} — ${text(fields.description)}` : fields.title;
    const parsed = item(provider, title, url, fields.pubdate, now);
    if (parsed) result.push(parsed); fields = undefined;
  });
  parser.write(body).close(); if (root.toLowerCase() !== "rss") throw new Error("Not RSS");
  return result.slice(0, 100);
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const rows = (v: unknown): Obj[] => { if (!Array.isArray(v)) throw new Error("Invalid feed response"); return v.slice(0, 100).map(obj); };
export function providers(env: NodeJS.ProcessEnv = process.env): NewsProvider[] {
  const result: NewsProvider[] = [];
  const add = (p: Omit<NewsProvider, "disabled">) => result.push({ ...p, disabled: env[`ALPHA_WIRE_${p.id.toUpperCase()}_ENABLED`] === "false" });
  for (const [id, name, category, url, interval] of [
    ["rbi", "RBI", "Macro", "https://rbi.org.in/pressreleases_rss.xml", 900],
    ["rbi_notifications", "RBI notifications", "Regulatory", "https://rbi.org.in/notifications_rss.xml", 900],
    ["rbi_speeches", "RBI speeches", "Macro", "https://rbi.org.in/speeches_rss.xml", 900],
    ["bse", "BSE announcements", "Announcements", "https://www.bseindia.com/data/xml/announcements.aspx", 300],
    ["bse_notices", "BSE notices", "Regulatory", "https://www.bseindia.com/data/xml/notices.xml", 900],
    ["pib", "PIB English releases", "Macro", "https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1", 900],
    ["sebi", "SEBI", "Regulatory", "https://www.sebi.gov.in/sebirss.xml", 3600],
  ] as const) add({ id, name, category, url, interval, parse: (b, n) => parseRss(b, { name, category }, n) });
  const gdelt = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  gdelt.search = new URLSearchParams({ query: '(India OR Indian OR RBI OR SEBI) (economy OR banking OR stocks OR inflation) sourcelang:english', mode: "artlist", format: "json", maxrecords: "30", sort: "datedesc", timespan: "24h" }).toString();
  add({ id: "gdelt", name: "GDELT", category: "News", interval: 900, url: gdelt.href, parse: (b, n) => rows(obj(JSON.parse(b)).articles).flatMap(r => {
    // seendate is GDELT discovery time, not publisher publication time.
    const v = item({ name: "GDELT", category: "News" }, r.title, r.url, null, n, { publisher: text(r.domain) }); return v ? [v] : [];
  }) });
  const marketaux = new URL("https://api.marketaux.com/v1/news/all");
  marketaux.search = new URLSearchParams({ api_token: env.MARKETAUX_API_TOKEN ?? "", countries: "in", language: "en", limit: "3", filter_entities: "true" }).toString();
  add({ id: "marketaux", name: "Marketaux", category: "News", interval: 1200, needsKey: !env.MARKETAUX_API_TOKEN, url: marketaux.href, parse: (b, n) => rows(obj(JSON.parse(b)).data).flatMap(r => {
    const entities = Array.isArray(r.entities) ? r.entities.map(obj) : [];
    const v = item({ name: "Marketaux", category: "News" }, r.title, r.url, r.published_at, n, { publisher: text(r.source), symbols: entities.map(e => text(e.symbol)).filter(Boolean).slice(0, 10) }); return v ? [v] : [];
  }) });
  const av = new URL("https://www.alphavantage.co/query");
  av.search = new URLSearchParams({ function: "NEWS_SENTIMENT", topics: "economy_macro", sort: "LATEST", limit: "30", apikey: env.ALPHA_VANTAGE_API_KEY ?? "" }).toString();
  add({ id: "alphavantage", name: "Alpha Vantage", category: "Macro", interval: 4800, needsKey: !env.ALPHA_VANTAGE_API_KEY, url: av.href, parse: (b, n) => {
    const body = obj(JSON.parse(b)); if (body.Note || body.Information || body["Error Message"]) throw new Error("Provider unavailable or quota restricted");
    return rows(body.feed).flatMap(r => { const v = item({ name: "Alpha Vantage", category: "Macro" }, r.title, r.url, r.time_published, n, { publisher: text(r.source), sentiment: text(r.overall_sentiment_label), symbols: Array.isArray(r.ticker_sentiment) ? r.ticker_sentiment.map(e => text(obj(e).ticker)).filter(Boolean).slice(0,10) : [] }); return v ? [v] : []; });
  } });
  add({ id: "mastodon", name: "Mastodon", category: "Social", interval: 900,
    url: "https://mastodon.social/api/v1/timelines/tag/indianfinance?limit=20",
    ...(env.MASTODON_ACCESS_TOKEN ? { headers: { Authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}` } } : {}),
    parse: (b, n) => rows(JSON.parse(b)).flatMap(r => {
      if (r.visibility !== "public" || r.sensitive || r.reblog || !date(r.created_at, n) || Date.parse(String(r.created_at)) < n.getTime() - 48 * 3600_000) return [];
      const v = item({ name: "Mastodon", category: "Social" }, r.content, r.url, r.created_at, n, { publisher: text(obj(r.account).acct) }); return v ? [v] : [];
    }) });
  add({ id: "bluesky", name: "Bluesky", category: "Social", interval: 900,
    url: "https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=India%20economy&sort=latest&limit=20",
    parse: (b, n) => rows(obj(JSON.parse(b)).posts).flatMap(r => {
      const record = obj(r.record); const uri = typeof r.uri === "string" ? r.uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/) : null;
      if (!uri || !date(record.createdAt, n) || Date.parse(String(record.createdAt)) < n.getTime() - 48 * 3600_000) return [];
      const v = item({ name: "Bluesky", category: "Social" }, record.text, `https://bsky.app/profile/${encodeURIComponent(uri[1]!)}/post/${encodeURIComponent(uri[2]!)}`, record.createdAt, n, { publisher: text(obj(r.author).handle) }); return v ? [v] : [];
    }) });
  return result;
}
