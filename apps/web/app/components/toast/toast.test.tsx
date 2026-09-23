import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function Trigger() {
  const { show } = useToast();
  return (
    <>
      <button type="button" onClick={() => show("Saved successfully.", "success")}>
        Trigger success
      </button>
      <button type="button" onClick={() => show("Save failed.", "error")}>
        Trigger error
      </button>
    </>
  );
}

describe("ToastProvider / useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a success toast when triggered", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger success" }));

    expect(screen.getByText("Saved successfully.")).toBeInTheDocument();
  });

  it("shows an error toast when triggered", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger error" }));

    expect(screen.getByText("Save failed.")).toBeInTheDocument();
  });

  it("auto-dismisses a toast after a few seconds", () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Trigger success" }));
    expect(screen.getByText("Saved successfully.")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.queryByText("Saved successfully.")).not.toBeInTheDocument();
  });

  it("throws when useToast is called outside a ToastProvider", () => {
    function Bare() {
      useToast();
      return null;
    }
    // Suppress React's expected console.error for the thrown-during-render case.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/useToast\(\) must be used inside a ToastProvider/);
    spy.mockRestore();
  });
});
