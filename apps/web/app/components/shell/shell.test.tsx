import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Shell } from "./shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/overview",
}));

describe("Shell", () => {
  it("renders the brand and the paper-mode banner", () => {
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );

    expect(screen.getByText("NRAIAlgo")).toBeInTheDocument();
    expect(screen.getByText(/Paper mode: orders are simulated/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to live (locked)" })).toBeDisabled();
  });

  it("renders Algo Terminal as a real, active link and every other item as an inert placeholder", () => {
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );

    const algoTerminal = screen.getByRole("link", { name: /Algo Terminal/ });
    expect(algoTerminal).toHaveAttribute("href", "/app/overview");

    expect(screen.queryByRole("link", { name: /Strategy Matrix/ })).not.toBeInTheDocument();
    expect(screen.getByText("Strategy Matrix")).toBeInTheDocument();
    expect(screen.getAllByText("Planned").length).toBeGreaterThan(0);
  });

  it("renders the children inside the main content area", () => {
    render(
      <Shell>
        <p>screen content</p>
      </Shell>,
    );

    expect(screen.getByText("screen content")).toBeInTheDocument();
  });

  it("toggles the mobile drawer open and closed", () => {
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );

    const toggle = screen.getByRole("button", { name: "Open navigation" });
    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Close navigation" })).toBeInTheDocument();
  });

  it("shows 'Not signed in' when no session is passed, not a real email", () => {
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );

    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });

  it("shows the signed-in user's email and a working sign-out control when a session is passed", () => {
    const onSignOut = vi.fn();
    render(
      <Shell email="trader@example.com" onSignOut={onSignOut}>
        <p>content</p>
      </Shell>,
    );

    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
