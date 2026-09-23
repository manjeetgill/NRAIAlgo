import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useIciciAccount } from "./use-icici-account";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("marks retained snapshots stale after a failed refresh", async () => {
  vi.useFakeTimers();
  const account = { accountId: "TEST", asOf: "2026-09-23T01:00:00.000Z", sections: {} };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => account }).mockRejectedValue(new Error("offline")));
  const { result, unmount } = renderHook(() => useIciciAccount());
  expect(result.current.loading).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(result.current.loading).toBe(false);
  expect(result.current.stale).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(result.current.account).toEqual(account);
  expect(result.current.stale).toBe(true);
  unmount();
});
it("times out stalled requests and retries without overlapping polls", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { result, unmount } = renderHook(() => useIciciAccount());
  await act(() => vi.advanceTimersByTimeAsync(20001));
  expect(result.current.account).toBeNull();
  expect(result.current.status).toContain("unavailable");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  unmount();
  await act(() => vi.advanceTimersByTimeAsync(60000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("recovers when a response body never resolves even after abort", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn(async () => ({ ok: true, json: () => new Promise(() => {}) }));
  vi.stubGlobal("fetch", fetchMock);
  const { result, unmount } = renderHook(() => useIciciAccount());
  await act(() => vi.advanceTimersByTimeAsync(20001));
  expect(result.current.status).toContain("unavailable");
  await act(() => vi.advanceTimersByTimeAsync(30000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
  unmount();
});

it("retains a failed ICICI section without discarding newly refreshed sections", async () => {
  vi.useFakeTimers();
  const old = { accountId: "TEST", asOf: "2026-09-23T01:00:00.000Z", sections: { portfolioholdings: {status:"available", rows:[{stock_code:"ABC",quantity:3}]}, funds:{status:"available",rows:[{total_bank_balance:10}]} } };
  const next = { ...old, asOf:"2026-09-23T01:01:00.000Z", sections: { portfolioholdings:{status:"unavailable",rows:[]}, funds:{status:"available",rows:[{total_bank_balance:20}]} } };
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>old}).mockResolvedValue({ok:true,json:async()=>next}));
  const {result,unmount}=renderHook(()=>useIciciAccount());
  await act(()=>vi.advanceTimersByTimeAsync(30001));
  expect(result.current.account?.sections.portfolioholdings?.rows).toEqual(old.sections.portfolioholdings.rows);
  expect(result.current.account?.sections.portfolioholdings?.status).toBe("unavailable");
  expect(result.current.account?.sections.portfolioholdings?.asOf).toBe(old.asOf);
  expect(result.current.account?.sections.funds?.rows).toEqual(next.sections.funds.rows);
  unmount();
});

it("overlays credential-free ICICI stream prices onto the reconciled position", async () => {
  vi.useFakeTimers();
  let listener: ((event: MessageEvent) => void) | undefined;
  class Stream {
    onerror: (() => void) | null = null;
    addEventListener(_name: string, callback: EventListener) { listener = callback as (event: MessageEvent) => void; }
    close() {}
  }
  vi.stubGlobal("EventSource", Stream);
  const account = { accountId: "IC1", asOf: "2026-09-23T04:07:50.000Z", sections: { portfoliopositions: { status: "available", rows: [{ exchange_code: "NFO", stock_code: "NIFTY", product_type: "Options", expiry_date: "25-Sep-2026", strike_price: 24000, right: "Call", quantity: 50, ltp: 100 }] } } };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => account }));
  const { result, unmount } = renderHook(() => useIciciAccount());
  await act(() => vi.advanceTimersByTimeAsync(1));
  act(() => listener?.({ data: JSON.stringify({ state: "streaming", asOf: "2026-09-23T04:08:00.000Z", prices: [{ key: "NFO|NIFTY|Options|25-Sep-2026|24000|Call|0", price: 101.25, previousClose: 99.5, sourceAt: "2026-09-23T04:08:00.000Z", fresh: true }] }) } as MessageEvent));
  expect(result.current.live).toBe("streaming");
  expect(result.current.account?.sections.portfoliopositions?.rows[0]).toMatchObject({ ltp: 101.25, previous_close: 99.5, live_as_of: "2026-09-23T04:08:00.000Z" });
  unmount();
});
