import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlphaWire } from "../../../../frontend/nextjs/app/components/shell/alpha-wire";

const item = { id: "1", title: "Example company board announcement", source: "NSE announcements", category: "Announcements", url: "https://nsearchives.nseindia.com/test.pdf", publishedAt: "2026-09-22T03:30:00Z", receivedAt: "2026-09-22T03:31:00Z" };
const snapshot = { items: [item], source: { status: "healthy", lastCheckedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), pollIntervalSeconds: 300 } };
class Stream {
  static current: Stream;
  onerror: (() => void) | null = null;
  callback: ((event: {data: string}) => void) | undefined;
  close = vi.fn();
  constructor() { Stream.current = this; }
  addEventListener(_name: string, cb: (event: {data: string}) => void) { this.callback = cb; }
  emit(value: unknown) { this.callback?.({ data: JSON.stringify(value) }); }
}
afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("Alpha Wire", () => {
  it("loads, filters and opens real-source links; preserves cards during outages and closes the stream", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    vi.stubGlobal("EventSource", Stream);
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute("open", ""); } });
    const { unmount } = render(<AlphaWire enabled />);
    await screen.findByText(item.title);
    act(() => Stream.current.emit(snapshot));
    expect(screen.getByRole("status")).toHaveTextContent("Connected");
    fireEvent.change(screen.getByLabelText("Search announcements"), { target: { value: "nomatch" } });
    expect(screen.getByText("No matching announcements.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search announcements"), { target: { value: "" } });
    fireEvent.click(screen.getByText(item.title));
    expect(screen.getByRole("link", { name: /Read original/ })).toHaveAttribute("href", item.url);
    expect(screen.getByRole("button", { name: /Analyse impact/ })).toBeDisabled();
    act(() => Stream.current.onerror?.());
    expect(screen.getByRole("status")).toHaveTextContent("disconnected");
    expect(screen.getAllByText(item.title)).toHaveLength(2);
    unmount(); expect(Stream.current.close).toHaveBeenCalled();
  });
  it("counts new items once, disables unconfigured sources and never fetches in an anonymous preview", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot });
    vi.stubGlobal("fetch", fetcher); vi.stubGlobal("EventSource", Stream);
    const first = render(<AlphaWire enabled={false} />);
    expect(fetcher).not.toHaveBeenCalled(); first.unmount();
    render(<AlphaWire enabled />);
    await screen.findByText(item.title);
    act(() => Stream.current.emit({ ...snapshot, items: [{ ...item, id: "2", title: "Second announcement" }, item] }));
    expect(screen.getByRole("button", { name: "1 new · Mark read" })).toBeInTheDocument();
    act(() => Stream.current.emit({ ...snapshot, items: [{ ...item, id: "2", title: "Second announcement" }, item] }));
    fireEvent.click(screen.getByRole("button", { name: "1 new · Mark read" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "2 headlines" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Social" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Options" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText(item.title)).not.toBeInTheDocument();
  });
  it("restores and updates the user's collapsed preference", async () => {
    window.localStorage.setItem("nraialgo.alpha-wire.collapsed", "true");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => snapshot }));
    vi.stubGlobal("EventSource", Stream);
    render(<AlphaWire enabled />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(window.localStorage.getItem("nraialgo.alpha-wire.collapsed")).toBe("false");
  });
});
