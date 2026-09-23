import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { expireOverviewSnapshot, OVERVIEW_REQUEST_TIMEOUT_MS, useOverviewSnapshot } from "../../../../apps/web/app/app/overview/use-overview-snapshot";
vi.mock("next/navigation", () => {
  const router = { replace: vi.fn() };
  return { useRouter: () => router };
});
const response = (state: "market-open" | "after-close") => ({ ok: true, status: 200, json: async () => OVERVIEW_SNAPSHOT_FIXTURES[state] });
describe("tick-cache display cadence", () => {
  beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(document, "hidden", { value: false, configurable: true }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("refreshes once per second in the open market", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("market-open")); vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useOverviewSnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(fetcher).toHaveBeenCalledTimes(4);
    hook.unmount();
  });
  it("uses slower polling outside the market and pauses hidden tabs", async () => {
    const fetcher = vi.fn().mockResolvedValue(response("after-close")); vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useOverviewSnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(14000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(fetcher).toHaveBeenCalledTimes(2);
    hook.unmount();
  });
  it("does not abort a slow request each second", async () => {
    const fetcher = vi.fn().mockReturnValue(new Promise(() => {})); vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useOverviewSnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(false);
    hook.unmount();
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it.each(["headers", "body"])("times out hung %s, retries, and ignores the abandoned result", async (part) => {
    let resolveOld: (value: unknown) => void = () => {};
    const pending = new Promise(resolve => { resolveOld = resolve; });
    const fetcher = vi.fn().mockReturnValueOnce(part === "headers" ? pending : Promise.resolve({ok: true, status: 200, json: () => pending}))
      .mockResolvedValue(response("market-open"));
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useOverviewSnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(OVERVIEW_REQUEST_TIMEOUT_MS); });
    expect(hook.result.current.error).toContain("timed out");
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(hook.result.current.snapshot?.session.data?.state).toBe("market-open");
    await act(async () => { resolveOld(part === "headers" ? response("after-close") : OVERVIEW_SNAPSHOT_FIXTURES["after-close"]); });
    expect(hook.result.current.snapshot?.session.data?.state).toBe("market-open");
    hook.unmount();
  });
  it("expires the stale warning independently while a refresh is hung or the tab is hidden", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response("market-open")).mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const hook = renderHook(() => useOverviewSnapshot());
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    Object.defineProperty(document, "hidden", {value: true, configurable: true});
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(hook.result.current.stale).toBe(true);
    expect(hook.result.current.snapshot).not.toBeNull();
    hook.unmount();
  });
  it("removes expired quote and position freshness and degrades old margin data", () => {
    const base = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    const now = Date.parse(base.generatedAt);
    base.positions = {status: "available", source: "kotak", asOf: base.generatedAt, version: 1, reason: null, data: [
      {provider:"kotak",accountId:"K",instrumentToken:123,exchange:"nse_fo",symbol:"TEST",product:"NRML",quantity:1,multiplier:1,averagePrice:100,lastPrice:100,pnlPaise:0,asOf:base.generatedAt,fresh:true},
    ]};
    const expired = expireOverviewSnapshot(base, now + 31_000, now);
    expect(expired.positions?.data?.[0]?.fresh).toBe(false);
    expect(expired.holdings.status).toBe("degraded");
    expect(base.positions.data?.[0]?.fresh).toBe(true);
  });
});
