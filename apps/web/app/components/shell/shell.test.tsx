import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shell } from "./shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/overview",
}));

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme; });

describe("Shell", () => {
  it("switches appearance without changing execution controls and remembers it on remount", () => {
    const first = render(<Shell><p>content</p></Shell>);
    fireEvent.click(screen.getByRole("button", {name:"Light theme"}));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("nraialgo-theme")).toBe("light");
    expect(screen.getByRole("button",{name:"Light theme"})).toHaveAttribute("aria-pressed","true");
    expect(screen.getByRole("button",{name:"Execution locked"})).toBeDisabled();
    first.unmount();render(<Shell><p>content</p></Shell>);
    expect(screen.getByRole("button",{name:"Light theme"})).toHaveAttribute("aria-pressed","true");
    fireEvent.click(screen.getByRole("button",{name:"Light theme"}));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("restores saved light mode and synchronizes changes from another tab", () => {
    localStorage.setItem("nraialgo-theme","light");render(<Shell>content</Shell>);
    expect(screen.getByRole("button",{name:"Light theme"})).toHaveAttribute("aria-pressed","true");
    act(()=>{localStorage.setItem("nraialgo-theme","dark");window.dispatchEvent(new StorageEvent("storage",{key:"nraialgo-theme"}));});
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("still switches when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked");});
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
    render(<Shell>content</Shell>);fireEvent.click(screen.getByRole("button",{name:"Light theme"}));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("renders the brand without claiming simulation or live execution", () => {
    render(
      <Shell>
        <p>content</p>
      </Shell>,
    );

    expect(screen.getByText("NRAIAlgo")).toBeInTheDocument();
    expect(screen.getByText(/Account monitoring/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execution locked" })).toBeDisabled();
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
