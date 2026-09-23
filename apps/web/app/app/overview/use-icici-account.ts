"use client";
import { useEffect, useState } from "react";
import { accountSchema, type IciciAccount } from "./icici-model";
import { z } from "zod";
export { iciciHoldings } from "./icici-model";
export type { IciciAccount } from "./icici-model";

export function useIciciAccount() {
  const [account, setAccount] = useState<IciciAccount | null>(null);
  const [status, setStatus] = useState("Loading ICICI account snapshot…");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [stale, setStale] = useState(true);
  const [live, setLive] = useState<"connecting" | "streaming" | "reconnecting" | "unavailable">("connecting");
  useEffect(() => {
    let stopped = false;
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      controller = new AbortController();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const request = (async () => {
          const response = await fetch("/v1/broker-auth/icici/account", { signal: controller.signal, cache: "no-store" });
          if (!response.ok) throw new Error("Unavailable");
          return accountSchema.parse(await response.json());
        })();
        const data = await Promise.race([request, new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => { reject(new Error("Timed out")); controller.abort(); }, 20000);
        })]);
        if (!stopped && !controller.signal.aborted) { setStale(false); setAccount(previous => {
          if (!previous || previous.accountId !== data.accountId) return data;
          const sections = { ...data.sections };
          for (const [name, section] of Object.entries(sections)) {
            const old = previous.sections[name];
            if (section.status === "unavailable" && old?.rows.length) sections[name] = { ...section, asOf: old.asOf ?? previous.asOf, rows: old.rows, reason: `Last confirmed snapshot ${old.asOf ?? previous.asOf}. ${section.reason ?? "Refresh failed"}` };
          }
          return { ...data, sections };
        }); setStatus(`ICICI REST snapshot · ${new Date(data.asOf).toLocaleString()}`); }
      } catch {
        if (!stopped) {
          setStale(true);
          setAccount(current => {
            setStatus(current
              ? `ICICI refresh failed — showing the last snapshot from ${new Date(current.asOf).toLocaleString()}.`
              : "ICICI data unavailable — check Broker Gateways. Consolidated coverage is incomplete.");
            return current;
          });
        }
      } finally { clearTimeout(deadline); if (!stopped) { setLoading(false); timer = setTimeout(refresh, 30000); } }
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [revision]);
  useEffect(() => {
    const stream = typeof EventSource === "undefined" ? null : new EventSource("/v1/broker-auth/icici/stream");
    if (!stream) return;
    const schema = z.object({ state: z.enum(["connecting", "streaming", "reconnecting", "unavailable"]), asOf: z.string().datetime(), prices: z.array(z.object({ key: z.string(), price: z.number().finite().positive(), previousClose: z.number().finite().positive().nullable(), sourceAt: z.string().datetime(), fresh: z.boolean() })) });
    const receive = (event: MessageEvent) => {
      let value: unknown;
      try { value = JSON.parse(String(event.data)); } catch { return; }
      const parsed = schema.safeParse(value);
      if (!parsed.success) return;
      setLive(parsed.data.state);
      setAccount(current => {
        if (!current?.sections.portfoliopositions) return current;
        const prices = new Map(parsed.data.prices.map(item => [item.key, item]));
        const rows = current.sections.portfoliopositions.rows.map((row, index) => {
          const key = [row.exchange_code, row.stock_code, row.product_type, row.expiry_date, row.strike_price, row.right, index].map(value => value == null ? "" : String(value)).join("|");
          const tick = prices.get(key);
          return { ...row, live_as_of: tick?.fresh ? tick.sourceAt : null, ...(tick ? { previous_close: tick.previousClose, ...(tick.fresh ? { ltp: tick.price } : {}) } : {}) };
        });
        return { ...current, sections: { ...current.sections, portfoliopositions: { ...current.sections.portfoliopositions, rows } } };
      });
    };
    stream.addEventListener("snapshot", receive);
    stream.onerror = () => setLive("reconnecting");
    return () => stream.close();
  }, []);
  return { account, status, stale, live, loading, refresh: () => { setStale(true); setStatus("Refreshing ICICI data…"); setRevision(value => value + 1); } };
}
