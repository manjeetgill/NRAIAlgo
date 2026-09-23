"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OverviewSnapshotSchema, type OverviewSnapshot } from "@nraialgo/contracts";

export const OVERVIEW_REQUEST_TIMEOUT_MS = 30_000;

/** Expire presentation flags even when the network (or a response body) hangs. */
export function expireOverviewSnapshot(base: OverviewSnapshot, now: number, receivedAt: number): OverviewSnapshot {
  const expired = (asOf: string, limit: number) => !Number.isFinite(Date.parse(asOf)) ||
    now - Date.parse(asOf) >= limit || now - receivedAt >= limit;
  const next = structuredClone(base);
  let changed = false;
  for (const quote of next.prices.data ?? []) {
    if (quote.fresh && expired(quote.sourceAsOf, 15_000)) {
      quote.fresh = false; quote.priceBasis = "last-observed"; changed = true;
      if (next.prices.data) { next.prices.status = "degraded"; next.prices.reason = "Price freshness expired; waiting for a current response"; }
    }
  }
  for (const row of next.positions?.data ?? []) {
    if (row.fresh && expired(row.asOf, 15_000)) { row.fresh = false; changed = true; }
  }
  if (next.marketStream?.status === "streaming" && (!next.marketStream.lastTickAt || expired(next.marketStream.lastTickAt, 15_000))) {
    next.marketStream.status = "stale"; next.marketStream.reason = "Tick freshness expired"; changed = true;
  }
  if (next.readiness.data?.checks.priceFeed.status === "passed" &&
      (now - receivedAt >= 15_000 || next.prices.data?.some(q => !q.fresh))) {
    next.readiness.data.checks.priceFeed = { status: "unknown", reason: "Price freshness expired" };
    next.readiness.data.liveTradeEligible = false; changed = true;
  }
  for (const key of ["positions", "pnl", "holdings", "brokerOrders"] as const) {
    const panel = next[key];
    if (panel?.data && panel.status === "available" && expired(panel.asOf, 30_000)) {
      Object.assign(panel, { status: "degraded", reason: "Account data freshness expired; showing last reported values" }); changed = true;
    }
  }
  return changed ? next : base;
}

export interface UseOverviewSnapshotResult {
  snapshot: OverviewSnapshot | null;
  loading: boolean;
  error: string | null;
  /** True once a refresh has failed after a snapshot was already showing --
   * the UI should keep rendering `snapshot` (it's still the last real data)
   * but flag it as stale rather than silently pretending it's current. */
  stale: boolean;
  refresh: () => void;
}

/**
 * Fetches the real snapshot from GET /v1/overview and validates it against
 * the shared schema before ever rendering it -- a malformed response is
 * treated as an error, never silently rendered as if it were valid data.
 *
 * A transient refresh failure never wipes a snapshot that's already
 * showing: `snapshot` is only ever replaced by a newer valid one, so the
 * screen keeps showing real (if now possibly stale) data instead of
 * flipping to a bare error notice on every dropped poll. `stale` is what
 * the caller uses to show that warning.
 *
 * Reads the server's tick-backed cache once per second while the market is
 * open; broker REST reconciliation stays server-side at ten seconds.
 * Outside market hours this uses a 15-second fallback poll
 * while the tab is visible, plus an immediate refetch when the tab
 * *becomes* visible again (covers reconnect-after-sleep -- not on every
 * visibilitychange, which also fires on hide) and on explicit refresh().
 * This is a UI refresh cadence, not an execution-authority signal -- it
 * never implies anything about order eligibility on its own.
 *
 * Requests are sequenced with an AbortController plus a monotonically
 * increasing request id: starting a new load aborts whatever request was
 * still in flight, and a response is only applied if it's still the latest
 * request -- so a slow, older response can never overwrite a newer one
 * that already landed.
 */
export function useOverviewSnapshot(): UseOverviewSnapshotResult {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequestId = useRef(0);
  const activeController = useRef<AbortController | null>(null);
  // Read inside the effect's catch handler instead of the `snapshot` state
  // value, which would otherwise be a stale closure (the effect only
  // re-runs on [reloadToken, router], not on every snapshot update).
  const hasSnapshotRef = useRef(false);
  const marketOpenRef = useRef(false);
  const lastSuccessRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastStarted = 0;
    let retryAfter = 0;
    let failures = 0;
    let deadline: ReturnType<typeof setTimeout> | undefined;

    function expire() {
      const receivedAt = lastSuccessRef.current;
      if (receivedAt === null) return;
      const now = Date.now();
      setSnapshot(current => current ? expireOverviewSnapshot(current, now, receivedAt) : current);
      if (now - receivedAt >= (marketOpenRef.current ? 15_000 : 45_000)) setStale(true);
    }

    async function load() {
      // A slow initial account read must finish; do not abort it every second.
      if (inFlight || Date.now() < retryAfter) return;
      inFlight = true;
      lastStarted = Date.now();
      const requestId = ++latestRequestId.current;
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;

      try {
        const request = (async () => {
          const response = await fetch("/v1/overview", { signal: controller.signal, cache: "no-store" });
          if (response.status === 401) return null;
          if (!response.ok) throw new Error(`Overview request failed (HTTP ${response.status})`);
          return OverviewSnapshotSchema.parse(await response.json());
        })();
        // Race covers BOTH headers and body, even if a transport ignores abort.
        const parsed = await Promise.race([request, new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => {
            reject(new Error("Overview request timed out; retrying"));
            controller.abort();
          }, OVERVIEW_REQUEST_TIMEOUT_MS);
        })]);
        if (cancelled || requestId !== latestRequestId.current) {
          return;
        }
        if (parsed === null) {
          router.replace("/login");
          return;
        }
        if (cancelled || requestId !== latestRequestId.current) {
          return;
        }
        hasSnapshotRef.current = true;
        lastSuccessRef.current = Date.now();
        failures = 0; retryAfter = 0;
        marketOpenRef.current = parsed.session.data?.state === "market-open";
        setSnapshot(expireOverviewSnapshot(parsed, Date.now(), lastSuccessRef.current));
        setError(null);
        setStale(false);
      } catch (caught) {
        if (cancelled || requestId !== latestRequestId.current) {
          return;
        }
        if (caught instanceof DOMException && caught.name === "AbortError") {
          // Superseded by a newer request -- not a real failure to report.
          return;
        }
        setError(caught instanceof Error ? caught.message : "Overview request failed");
        retryAfter = Date.now() + Math.min(30_000, 1000 * 2 ** failures++);
        // A prior successful snapshot stays visible (never cleared here) --
        // just flagged stale so the caller can show a warning above it.
        if (hasSnapshotRef.current) {
          setStale(true);
        }
      } finally {
        clearTimeout(deadline);
        inFlight = false;
        if (!cancelled && requestId === latestRequestId.current) {
          setLoading(false);
        }
      }
    }

    void load();
    const interval = setInterval(() => {
      expire();
      if (!document.hidden && Date.now() - lastStarted >= (marketOpenRef.current ? 1000 : 15000)) {
        void load();
      }
    }, 1000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        expire();
        void load();
      }
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      activeController.current?.abort();
      clearTimeout(deadline);
      clearInterval(interval);
      window.removeEventListener("focus", onVisibilityChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reloadToken, router]);

  return {
    snapshot,
    loading,
    error,
    stale,
    refresh: () => setReloadToken((token) => token + 1),
  };
}
