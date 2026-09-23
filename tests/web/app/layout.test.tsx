import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AppSectionLayout from "../../../frontend/nextjs/app/app/layout";

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
  usePathname: () => "/app/overview",
}));

describe("AppSectionLayout (auth gate)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockRouterReplace.mockClear();
  });

  it("renders nothing while the session check is in flight -- never a flash of protected content", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const { container } = render(
      <AppSectionLayout>
        <p>protected content</p>
      </AppSectionLayout>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("redirects to /login and never renders protected content for an anonymous caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    render(
      <AppSectionLayout>
        <p>protected content</p>
      </AppSectionLayout>,
    );

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith("/login"));
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("renders the shell and children once the session check succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: "trader@example.com" }) }),
    );

    render(
      <AppSectionLayout>
        <p>protected content</p>
      </AppSectionLayout>,
    );

    await waitFor(() => expect(screen.getByText("protected content")).toBeInTheDocument());
    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
  });
});
