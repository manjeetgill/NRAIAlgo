import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "@nraialgo/contracts";
import OverviewPlaygroundPage from "./page";

const notFoundMock = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({ usePathname: () => "/dev/overview-playground", notFound: () => notFoundMock() }));
vi.mock("@/app/app/overview/use-overview-snapshot", () => ({ useOverviewSnapshot: () => ({ snapshot: OVERVIEW_SNAPSHOT_FIXTURES["market-open"], loading: false, error: null, stale: false }) }));

describe("legacy overview playground", () => {
  afterEach(() => { vi.unstubAllEnvs(); notFoundMock.mockClear(); });
  it("uses the account page and layout selector instead of example snapshots", () => {
    render(<OverviewPlaygroundPage />);
    fireEvent.click(screen.getByRole("button", { name: "Weekend / holiday" }));
    expect(screen.getByRole("heading", { name: "Weekend / holiday" })).toBeInTheDocument();
    expect(screen.getByText(/Actual server session: Market open/)).toBeInTheDocument();
    expect(screen.queryByText(/fixed example data/)).not.toBeInTheDocument();
    expect(screen.getByText("NRAIAlgo")).toBeInTheDocument();
  });
  it("retains the production guard for the legacy dev URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => render(<OverviewPlaygroundPage />)).toThrow("NEXT_NOT_FOUND");
  });
});
