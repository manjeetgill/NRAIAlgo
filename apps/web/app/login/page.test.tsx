import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockRouterReplace }),
}));

function fillAndSubmit(email: string, password: string) {
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
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ email: "trader@example.com" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginPage />);
    fillAndSubmit("trader@example.com", "a-good-password");

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
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ message: "Invalid email or password." }) }),
    );

    render(<LoginPage />);
    fillAndSubmit("trader@example.com", "wrong-password");

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password."));
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });
});
