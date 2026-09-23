import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "../../../apps/web/app/login/page";

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

async function fillAndSubmit(email: string, password: string) {
  await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockRouterReplace.mockClear();
  });

  it("posts credentials to /v1/auth/login and redirects to /app/overview on success", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ needsSetup: false, setupEnabled: false }) }).mockResolvedValue({ ok: true, json: async () => ({ email: "trader@example.com" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);
    await fillAndSubmit("trader@example.com", "a-good-password");

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith("/app/overview"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "trader@example.com", password: "a-good-password" }),
      }),
    );
  });

  it("shows the server's error message on invalid credentials and never navigates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ needsSetup: false, setupEnabled: false }) }).mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Invalid email or password." }) }),
    );

    render(<LoginPage />);
    await fillAndSubmit("trader@example.com", "wrong-password");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password."));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("creates the first user then asks them to sign in without retaining secrets", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ needsSetup: true, setupEnabled: true }) }).mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginPage />);
    await screen.findByRole("button", { name: "Create user" });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "my-long-password" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "different-password" } });
    fireEvent.change(screen.getByLabelText("Setup key"), { target: { value: "a".repeat(64) } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "my-long-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Create user" }));
    await screen.findByText("Account created. Sign in with your new password.");
    expect(fetchMock).toHaveBeenLastCalledWith("/v1/auth/setup", expect.objectContaining({ body: JSON.stringify({ email: "owner@example.com", password: "my-long-password", setupToken: "a".repeat(64) }) }));
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("Setup key")).not.toBeInTheDocument();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it("disables setup when no server key is configured", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ needsSetup: true, setupEnabled: false }) }));
    render(<LoginPage />);
    expect(await screen.findByRole("button", { name: "Create user" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("INITIAL_SETUP_TOKEN");
  });

  it("fails closed when setup discovery fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<LoginPage />);
    await screen.findByText(/Cannot check setup status/);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});
