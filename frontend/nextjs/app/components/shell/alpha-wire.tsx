"use client";

import { useEffect, useRef, useState } from "react";
import { alphaWireSnapshotSchema, safeNewsUrl, type AlphaWireItem, type AlphaWireSnapshot } from "@nraialgo/contracts";
import styles from "./alpha-wire.module.css";

const COLLAPSE_PREFERENCE_KEY = "nraialgo.alpha-wire.collapsed";

function stamp(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Time not supplied";
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)) + " IST";
}

export function AlphaWire({ enabled, initiallyCollapsed = false, embedded = false }: { enabled: boolean; initiallyCollapsed?: boolean; embedded?: boolean }) {
  const [snapshot, setSnapshot] = useState<AlphaWireSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [provider, setProvider] = useState("All");
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const [selected, setSelected] = useState<AlphaWireItem | null>(null);
  const [unread, setUnread] = useState(0);
  const [now, setNow] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const cards = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (embedded) return;
    let cancelled = false;
    try {
      const saved = window.localStorage.getItem(COLLAPSE_PREFERENCE_KEY);
      if (saved !== null) queueMicrotask(() => { if (!cancelled) setCollapsed(saved === "true"); });
    } catch { /* Storage can be disabled; the safe default still applies. */ }
    return () => { cancelled = true; };
  }, [embedded]);

  const setCollapsePreference = (value: boolean) => {
    setCollapsed(value);
    try { window.localStorage.setItem(COLLAPSE_PREFERENCE_KEY, String(value)); } catch { /* Non-essential preference. */ }
  };

  useEffect(() => {
    if (!enabled) return;
    let active = true; let lastMessage = 0; let streamHasSnapshot = false;
    const seen = new Set<string>(); let initialized = false;
    const accept = (value: unknown) => {
      const parsed = alphaWireSnapshotSchema.safeParse(value);
      if (!parsed.success || !active) return false;
      let added = 0;
      for (const item of parsed.data.items) { if (initialized && !seen.has(item.id)) added++; seen.add(item.id); }
      if (seen.size > 2000) { seen.clear(); for (const item of parsed.data.items) seen.add(item.id); }
      initialized = true;
      if (added) setUnread(count => count + added);
      setSnapshot(parsed.data);
      return true;
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetch("/v1/alpha-wire", { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (response.ok) { const body = await response.json(); if (!streamHasSnapshot) accept(body); } })
      .catch(() => { /* SSE can still recover; never replace cached headlines with dummy data. */ })
      .finally(() => clearTimeout(timeout));
    const stream = typeof EventSource === "undefined" ? null : new EventSource("/v1/alpha-wire/stream");
    stream?.addEventListener("snapshot", event => {
      try {
        if (accept(JSON.parse((event as MessageEvent<string>).data))) {
          streamHasSnapshot = true; lastMessage = Date.now(); setConnected(true);
        }
      } catch { setConnected(false); }
    });
    if (stream) stream.onerror = () => { if (active) setConnected(false); };
    const freshness = setInterval(() => {
      if (!active) return;
      setNow(Date.now());
      if (Date.now() - lastMessage > 40_000) setConnected(false);
    }, 1000);
    return () => { active = false; clearTimeout(timeout); clearInterval(freshness); controller.abort(); stream?.close(); };
  }, [enabled]);

  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  const source = snapshot?.source;
  const sources = snapshot?.sources ?? (source ? [{ id: 'nse', name: 'NSE announcements', category: 'Announcements', ...source }] : []);
  const healthy = sources.filter(s => s.status === 'healthy' && s.lastSuccessAt && now - Date.parse(s.lastSuccessAt) < (s.pollIntervalSeconds * 2 + 30) * 1000).length;
  const status = !enabled ? "Sign in for updates" : !connected ? "Updates disconnected" : `Connected · ${healthy}/${sources.length} sources healthy`;
  const items = (snapshot?.items ?? []).filter(item => (category === "All" || item.category === category) && (provider === 'All' || item.source === provider) && `${item.title} ${item.source} ${item.publisher ?? ''} ${(item.symbols ?? []).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  const selectedUrl = selected ? safeNewsUrl(selected.url) : null;

  return <section className={`${styles.wire} ${embedded ? styles.embedded : ""}`} aria-label="Alpha Wire announcements">
    <div className={styles.toolbar}>
      <strong className={styles.brand}><span aria-hidden="true">◉</span> {embedded ? "AFTER-MARKET NEWS WIRE & AI OVERNIGHT INTELLIGENCE" : "ALPHA WIRE"}</strong>
      <span className={connected && healthy === sources.length && healthy > 0 ? styles.healthy : styles.status} role="status">{status}</span>
      <button type="button" onClick={() => { setUnread(0); setCollapsePreference(false); }}>{unread ? `${unread} new · Mark read` : `${snapshot?.items.length ?? 0} headlines`}</button>
      {!embedded && <button type="button" className={styles.collapse} aria-expanded={!collapsed} aria-controls="alpha-wire-content" onClick={() => setCollapsePreference(!collapsed)}>{collapsed ? "Expand" : "Collapse"}</button>}
    </div>
    {(!collapsed || embedded) && <div id="alpha-wire-content">
      <div className={styles.filters}>
        {['All', 'Announcements', 'News', 'Macro', 'Regulatory', 'Social'].map(label => <button key={label} type="button" aria-pressed={category === label} onClick={() => setCategory(label)}>{label}</button>)}
        <button type="button" disabled title="Options alert calculations are not configured">Options</button>
        <select aria-label="Filter by news source" value={provider} onChange={event => setProvider(event.target.value)}>
          <option value="All">All sources</option>{sources.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <input aria-label="Search announcements" placeholder="Search headlines…" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
        <button type="button" aria-label="Previous headlines" onClick={() => cards.current?.scrollBy({ left: -320, behavior: "smooth" })}>←</button>
        <button type="button" aria-label="Next headlines" onClick={() => cards.current?.scrollBy({ left: 320, behavior: "smooth" })}>→</button>
      </div>
      <div className={styles.cards} ref={cards}>
        {items.map(item => <button type="button" key={item.id} className={styles.card} onClick={() => setSelected(item)}>
          <span className={styles.cardSource}>{item.source}{item.category === 'Social' ? ' · Unverified social' : ''}{item.publisher ? ` · ${item.publisher}` : ''}</span>
          <strong>{item.title}</strong>
          <span className={styles.timestamp}>{stamp(item.publishedAt)}</span>
        </button>)}
        {!items.length && <p className={styles.empty}>{query ? "No matching announcements." : "No items received for this filter. Check source status below."}</p>}
      </div>
      <details className={styles.sourceStatus}><summary>Source status & refresh intervals · Headlines, not a tick feed</summary>
        {sources.map(s => <div key={s.id}><strong>{s.name}</strong> · {s.status.replaceAll('_', ' ')} · Every {Math.round(s.pollIntervalSeconds / 60)} min · Checked: {stamp(s.lastCheckedAt)} · Last success: {stamp(s.lastSuccessAt)}</div>)}
        <p>Key required: configure server-side credentials. Access denied: provider refused this request. Healthy means the source was checked, not that new headlines were published.</p>
      </details>
    </div>}
    <dialog ref={dialog} className={styles.dialog} onClose={() => setSelected(null)}>
      {selected && <>
        <div className={styles.toolbar}><strong>{selected.source} · {selected.category}</strong><button type="button" onClick={() => dialog.current?.close()} autoFocus>Close</button></div>
        <h2>{selected.title}</h2>
        <p>Published: {stamp(selected.publishedAt)}</p><p>Received: {stamp(selected.receivedAt)}</p>
        {selected.publisher && <p>Publisher / author: {selected.publisher}</p>}
        {!!selected.symbols?.length && <p>Provider tickers: {selected.symbols.join(', ')} (not verified broker instrument mappings)</p>}
        {selected.sentiment && <p>Provider sentiment: {selected.sentiment} · Not NRAIAlgo analysis</p>}
        {selectedUrl && <a href={selectedUrl} target="_blank" rel="noopener noreferrer">Read original announcement ↗</a>}
        <p className={styles.caption}>{selected.category === 'Social' ? 'Unverified social commentary. ' : ''}Source headline, not a verified trading signal. No automatic trading action is taken.</p>
        <button type="button" disabled title="AI analysis is not configured">Analyse impact · Not configured</button>
      </>}
    </dialog>
  </section>;
}
