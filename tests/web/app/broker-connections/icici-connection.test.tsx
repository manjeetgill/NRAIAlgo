import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IciciConnection } from "../../../../frontend/nextjs/app/app/broker-connections/icici-connection";

afterEach(() => vi.unstubAllGlobals());





it("saves ICICI credentials without displaying saved secrets", async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ icici: null }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<IciciConnection />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText("Breeze API key"), { target: { value: "key" } });
  fireEvent.change(screen.getByLabelText("Breeze API secret"), { target: { value: "secret" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ICICI configuration" }));
  await waitFor(() => expect(screen.queryByLabelText("Breeze API secret")).not.toBeInTheDocument());
  expect(fetchMock).toHaveBeenCalledWith("/v1/broker-credentials/icici", expect.objectContaining({ method: "POST", body: JSON.stringify({ apiKey: "key", apiSecret: "secret" }) }));
  expect(screen.getByRole("button", { name: "Open ICICI login" })).toBeEnabled();
});



it("keeps account data out of Broker Gateways even when authorized", async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ icici: "2026-09-23T00:00:00.000Z" }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<IciciConnection />);
  await screen.findByText(/View account data on the dashboard/);
  expect(screen.queryByRole("region", { name: "ICICI account" })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls).toHaveLength(2);
});
