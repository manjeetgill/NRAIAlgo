import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import OverviewPlaygroundPage from "./page";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  usePathname: () => "/dev/overview-playground",
  notFound: () => notFoundMock(),
}));

describe("OverviewPlaygroundPage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    notFoundMock.mockClear();
  });

  it("shows a different state's content when the switcher selects it", () => {
    render(<OverviewPlaygroundPage />);

    fireEvent.click(screen.getByRole("radio", { name: "Weekend / holiday" }));

    expect(screen.getByRole("heading", { name: "Weekend / holiday" })).toBeInTheDocument();
  });

  it("discloses that it's a design-review playground, not production", () => {
    render(<OverviewPlaygroundPage />);

    expect(screen.getByText(/Design review playground/)).toBeInTheDocument();
  });

  it("renders inside the real app shell so states preview in context", () => {
    render(<OverviewPlaygroundPage />);

    expect(screen.getByText("NRAIAlgo")).toBeInTheDocument();
    expect(screen.getByText(/Paper mode: orders are simulated/)).toBeInTheDocument();
  });

  it("calls notFound() instead of rendering when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => render(<OverviewPlaygroundPage />)).toThrow("NEXT_NOT_FOUND");
    // React may retry the throwing render internally; what matters is that
    // it was called at least once and the page never rendered its content.
    expect(notFoundMock).toHaveBeenCalled();
    expect(screen.queryByText(/Design review playground/)).not.toBeInTheDocument();
  });
});
