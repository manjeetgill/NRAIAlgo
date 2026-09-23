# Alpha Wire

Persistent authenticated headline panel in the shared application shell. No mock
headlines, social posts, trading signals or AI summaries ship in this feature.

## Additional sources

All sources are polled server-side and delivered to authenticated browsers over SSE.
They are news feeds, not tick-by-tick market data. No fabricated fallback headlines.

| Source | Content | Poll interval | Configuration |
| --- | --- | --- | --- |
| RBI | Official press releases | 15 minutes | No key |
| RBI notifications / speeches | Separate official regulatory and speech feeds | 15 minutes each | No key |
| BSE announcements | Company filings, headline plus filing subject | 5 minutes | No key |
| BSE notices | Exchange notices and circulars | 15 minutes | No key |
| PIB English releases | Government-wide English press releases | 15 minutes | No key; currently redirects, unavailable |
| SEBI | Official regulatory RSS | 60 minutes (feed TTL) | No key |
| GDELT | India-related economic news discovery | 15 minutes | No key |
| Marketaux | Indian equity news | 20 minutes | `MARKETAUX_API_TOKEN` |
| Alpha Vantage | Global macro news and provider sentiment | 80 minutes | `ALPHA_VANTAGE_API_KEY` |
| Mastodon | Public #indianfinance posts on mastodon.social | 15 minutes | Optional `MASTODON_ACCESS_TOKEN` |
| Bluesky | Public India economy search | 15 minutes | Public endpoint; access may be denied |

Set secrets in the API environment or corresponding `_FILE` variables, never
`NEXT_PUBLIC_*`, committed files or browser storage. Restart the API after changes.
Missing keys show `key_required`; no provider accounts are created automatically.
Marketaux spacing allows about 72 requests/day, requesting three articles each.
Alpha Vantage spacing allows about 18 requests/day; other uses of the same key
consume its quota too, and endpoint access remains subject to provider entitlement.
In Docker, mount individual secret files into the API and pass their `_FILE` paths;
do not mount the entire deployment secrets directory into a runtime container.

Schema migration 8 adds `alpha_wire_poll_state`. Each additional provider reserves
its next request atomically in Postgres before fetching; restart does not reset
quota spacing. HTTP 429 and 403 back off at least one hour; Retry-After is respected
up to 24 hours. Individual switches: `ALPHA_WIRE_RBI_ENABLED=false`, and equivalent
`SEBI`, `GDELT`, `MARKETAUX`, `ALPHAVANTAGE`, `MASTODON`, `BLUESKY`, `BSE`,
`BSE_NOTICES`, `RBI_NOTIFICATIONS`, `RBI_SPEECHES`, `PIB` switches.

BSE's RSS directory publishes `/data/xml/announcements.aspx` and
`/data/xml/notices.xml`; both returned usable XML during verification. The NSE
integration is the announcements feed, not a claim that every separate NSE
results, corporate-actions or circular feed is subscribed. PIB is government-wide,
not finance-only. Its English URL currently redirects to a different language/region
and an empty feed; redirects are deliberately rejected, so it reports unavailable
instead of claiming English headlines are live. No scraping workaround is used.
Official directories: https://www.bseindia.com/rss-feed and
https://www.pib.gov.in/ViewRss.aspx?lang=1&reg=1 . RSS delivery latency includes
publisher updates plus our polling interval; it is not guaranteed instant delivery.

Each source has independent check/success timestamps and health. Healthy means a
successful check, not necessarily new articles. The documented Bluesky public search
returned HTTP 403 during setup: show access denied, with no access-control bypass.
Mastodon can return no recent matching posts. Social posts are explicitly unverified
and limited to the last 48 hours. GDELT discovery time is not publication time;
unknown publication timestamps remain unknown. Provider ticker labels are not broker
instrument mappings; provider sentiment is not NRAIAlgo analysis.

The multi-source snapshot reserves up to 25 items per source, 200 overall, retaining
30 days. Canonical HTTPS URL plus headline deduplicates additional providers; the
first source wins when aggregators overlap. Full articles are not fetched or stored.
Responses have a 2 MB limit (5 MB for BSE announcements, whose verified feed exceeded
3 MB), 15-second timeout and no redirects. HTML is stripped;
XML DTDs are rejected. External links are HTTPS-only; credentials, local hosts and
numeric IP destinations are rejected. Free API access does not imply redistribution
rights: review each publisher/provider's terms before broader distribution.

References: [Marketaux](https://www.marketaux.com/documentation),
[GDELT](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/),
[RBI](https://www.rbi.org.in/Scripts/rss.aspx),
[SEBI](https://www.sebi.gov.in/rss.html),
[Mastodon](https://docs.joinmastodon.org/methods/timelines/),
[Bluesky](https://docs.bsky.app/docs/api/app-bsky-feed-search-posts),
[Alpha Vantage](https://www.alphavantage.co/documentation/#news-sentiment).

## NSE source and freshness

- Official NSE RSS: https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml
- Source directory: https://www.nseindia.com/static/rss-feed
- The feed advertises a five-minute TTL. One API process polls on startup, then
  every five minutes after the previous attempt completes, including weekends.
- Headline = company/title plus the feed's SUBJECT field where provided. No
  inferred symbols, institutional activity, sentiment or investment advice.
- Unzoned NSE publication timestamps are interpreted as IST, not server time.
  Missing/invalid timestamps remain unknown; received time is separate.
- Use is subject to NSE's terms; review redistribution/display rights before
  enabling for a broader audience. This is not a licensed breaking-news wire.
- Set `ALPHA_WIRE_ENABLED=false` in API environment to disable upstream reads.

## Delivery and storage

- Schema migration 7 creates `alpha_wire_items`, restricted-role DML grants and
  an index. Apply migrations before production API startup (see deployment guide).
- Only public announcement metadata is stored. Private account/workspace alerts
  must never be inserted into this shared table.
- SHA-256 content IDs deduplicate repeated feed items. Corrections to headline,
  publication time or link produce new items. The newest 200 items are shown by
  publication time, falling back to receipt time when publication is unknown;
  records older than 30 days are pruned after successful ingestion. The multi-source
  view applies the per-source cap described above.
- `GET /v1/alpha-wire`: authenticated recent snapshot, no caching.
- `GET /v1/alpha-wire/stream`: authenticated SSE, immediate snapshot, updates after
  ingestion and a snapshot heartbeat every 15 seconds. Reconnects resend the
  recent 200-item window, not a complete news archive. Session validity is checked
  on every emission; logout/expiry closes the stream within the heartbeat window.
- Client reconnect delay is five seconds. Missing heartbeats mark delivery
  disconnected after 40 seconds. Source status is separate from browser delivery.
- On upstream failure, keep stored items and last-success time, report unavailable.
  No source authentication, anti-bot circumvention or third-party scraping fallback.
- Fixed HTTPS source, no redirects, 15-second timeout, 2 MB response cap, XML DTDs
  rejected. NSE links allow only official NSE hosts; other sources use the HTTPS
  validation described above. Render text, never HTML.
- Streams are bounded to 100 per API process and slow clients are disconnected.
  Keep the current one-API deployment; no new Redis/broker required.
- Caddy routes SSE directly to the API with buffering disabled for this path.

## UI

Sticky strip on authenticated screens, dark/light themes, horizontal cards,
search, category and provider filters, source-health details, new-item count,
collapse/expand and accessible native dialog with original-source links. Market
closure does not stop ingestion. Options analytics and AI impact analysis remain
unavailable; no execution controls exist.

Tests use fixtures only; fixtures are never exposed by production endpoints.
