import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "@nraialgo/contracts";
import OverviewPage from "./page";

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn() }),
}));

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => body,
    }),
  );
}

describe("OverviewPage (production)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockRouterReplace.mockClear();
  });

  it("shows a loading state before the first snapshot arrives", () => {
    mockFetchOnce(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);

    render(<OverviewPage />);

    expect(screen.getByText(/Loading Overview/)).toBeInTheDocument();
  });

  it("renders the real snapshot once GET /v1/overview resolves", async () => {
    mockFetchOnce(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);

    render(<OverviewPage />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Market open" })).toBeInTheDocument(),
    );
  });

  it("keeps layout simulation controls out of the operational page", async () => {
    mockFetchOnce(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
    render(<OverviewPage />);
    await waitFor(() => expect(screen.queryByText(/Loading Overview/)).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Auto · actual session" })).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Layout preview notice" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Market open" })).toBeInTheDocument();
  });

  it("shows an honest error instead of fabricating a snapshot when the request fails", async () => {
    mockFetchOnce({}, false);

    render(<OverviewPage />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load the Overview snapshot/)).toBeInTheDocument(),
    );
  });

  it("sends an expired/anonymous session to /login instead of showing a generic error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    render(<OverviewPage />);

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText(/Could not load the Overview snapshot/)).not.toBeInTheDocument();
  });

  it("keeps the last valid snapshot visible with a stale warning when a later refresh fails, instead of blanking the screen", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => OVERVIEW_SNAPSHOT_FIXTURES["market-open"] })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(<OverviewPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Market open" })).toBeInTheDocument());

    // Trigger the second (failing) request via the hook's own refresh path
    // -- simplest is firing a visibilitychange, which the hook listens for.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(screen.getByText(/Disconnected/)).toBeInTheDocument());
    // The real, previously-loaded data is still on screen.
    expect(screen.getByRole("heading", { name: "Market open" })).toBeInTheDocument();
  });
});
