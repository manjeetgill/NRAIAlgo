"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OverviewSnapshotSchema, type OverviewSnapshot } from "@nraialgo/contracts";

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
 * Follows the guide's display-refresh policy: a 15-second fallback poll
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const requestId = ++latestRequestId.current;
      activeController.current?.abort();
      const controller = new AbortController();
      activeController.current = controller;

      try {
        const response = await fetch("/v1/overview", { signal: controller.signal });
        if (cancelled || requestId !== latestRequestId.current) {
          return;
        }
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          throw new Error(`Overview request failed (HTTP ${response.status})`);
        }
        const parsed = OverviewSnapshotSchema.parse(await response.json());
        if (cancelled || requestId !== latestRequestId.current) {
          return;
        }
        hasSnapshotRef.current = true;
        setSnapshot(parsed);
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
        // A prior successful snapshot stays visible (never cleared here) --
        // just flagged stale so the caller can show a warning above it.
        if (hasSnapshotRef.current) {
          setStale(true);
        }
      } finally {
        if (!cancelled && requestId === latestRequestId.current) {
          setLoading(false);
        }
      }
    }

    void load();
    const interval = setInterval(() => {
      if (!document.hidden) {
        void load();
      }
    }, 15000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    window.addEventListener("focus", onVisibilityChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      cancelled = true;
      activeController.current?.abort();
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
