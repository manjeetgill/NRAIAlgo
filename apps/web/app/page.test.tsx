import { describe, expect, it, vi } from "vitest";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("HomePage", () => {
  it("redirects to the Overview screen", async () => {
    const { default: HomePage } = await import("./page");

    HomePage();

    expect(redirectMock).toHaveBeenCalledWith("/app/overview");
  });
});
