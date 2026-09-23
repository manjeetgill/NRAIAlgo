import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AccountAccessForm } from "./account-access-form";

afterEach(() => vi.unstubAllGlobals());
it.each(["invite", "reset"] as const)("redeems %s codes without logging in automatically", async mode => {
  const fetchMock = vi.fn().mockResolvedValue({ok: true}); vi.stubGlobal("fetch", fetchMock);
  const back = vi.fn();
  render(<AccountAccessForm mode={mode} initialEmail="person@example.com" onBack={back} />);
  expect(screen.getByText(/No automated email will be sent/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(mode === "invite" ? "Invitation code" : "Recovery code"), {target: {value: "a".repeat(43)}});
  fireEvent.change(screen.getByLabelText("New password"), {target: {value: "a-long-new-password"}});
  fireEvent.change(screen.getByLabelText("Confirm new password"), {target: {value: "a-long-new-password"}});
  fireEvent.click(screen.getByRole("button", {name: mode === "invite" ? "Create account" : "Reset password"}));
  await waitFor(() => expect(back).toHaveBeenCalled());
  expect(fetchMock).toHaveBeenCalledWith(mode === "invite" ? "/v1/auth/register" : "/v1/auth/reset-password", expect.objectContaining({body: JSON.stringify({email: "person@example.com", password: "a-long-new-password", code: "a".repeat(43)})}));
});
it("rejects mismatched passwords before sending a request", () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  render(<AccountAccessForm mode="reset" initialEmail="person@example.com" onBack={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "a".repeat(43)}});
  fireEvent.change(screen.getByLabelText("New password"), {target: {value: "a-long-new-password"}});
  fireEvent.change(screen.getByLabelText("Confirm new password"), {target: {value: "different-password"}});
  fireEvent.click(screen.getByRole("button", {name: "Reset password"}));
  expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("shows invalid-code errors and permits retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok: false, json: async () => ({message: "Invalid or expired code."})}));
  render(<AccountAccessForm mode="reset" initialEmail="person@example.com" onBack={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Recovery code"), {target: {value: "a".repeat(43)}});
  for (const label of ["New password", "Confirm new password"]) fireEvent.change(screen.getByLabelText(label), {target: {value: "a-long-new-password"}});
  fireEvent.click(screen.getByRole("button", {name: "Reset password"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid or expired code");
  expect(screen.getByRole("button", {name: "Reset password"})).toBeEnabled();
});
