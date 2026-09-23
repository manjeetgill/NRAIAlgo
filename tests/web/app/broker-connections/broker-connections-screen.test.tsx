import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrokerConnectionsScreen } from "../../../../apps/web/app/app/broker-connections/broker-connections-screen";
import { ToastProvider } from "@/app/components/toast/toast";

type Status = { zerodha: string | null; kotak: string | null };

function mockFetch(
  options: { configured?: Status; session?: Status } = {},
): ReturnType<typeof vi.fn> {
  const configured = options.configured ?? { zerodha: null, kotak: null };
  const session = options.session ?? { zerodha: null, kotak: null };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/broker-credentials/status")) {
      return { ok: true, json: async () => configured } as Response;
    }
    if (url.includes("/broker-auth/status")) {
      return { ok: true, json: async () => session } as Response;
    }
    if (url.includes("/broker-auth/zerodha/redirect-url")) {
      return { ok: true, json: async () => ({ url: "http://localhost:4000/v1/broker-auth/zerodha/callback" }) } as Response;
    }
    if (url.includes("/broker-auth/zerodha/login-url")) {
      return { ok: true, json: async () => ({ url: "https://kite.zerodha.com/connect/login?api_key=x&v=3" }) } as Response;
    }
    if (init?.method === "POST") {
      return { ok: true, json: async () => ({}) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderScreen() {
  return render(
    <ToastProvider>
      <BrokerConnectionsScreen />
    </ToastProvider>,
  );
}

vi.mock("../../../../apps/web/app/app/overview/use-overview-snapshot", () => ({useOverviewSnapshot: () => ({snapshot:null,stale:false,refresh:vi.fn()})}));
vi.mock("../../../../apps/web/app/app/overview/use-icici-account", () => ({useIciciAccount: () => ({account:null,stale:false,refresh:vi.fn()})}));

describe("BrokerConnectionsScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults to the Zerodha tab with step 1 (API key/secret), not a password field", async () => {
    mockFetch();
    renderScreen();

    expect(screen.getByLabelText("API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("API Secret")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Not configured")).toBeInTheDocument());
  });

  it("shows Zerodha's step 2 authorize button disabled until step 1 is configured", async () => {
    mockFetch({ configured: { zerodha: null, kotak: null } });
    renderScreen();

    expect(screen.getByText("Authorize for today")).toBeInTheDocument();
    expect(screen.getByText(/Kite access tokens expire at the start of the next session/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Authorize with Zerodha" })).toBeDisabled(),
    );
    expect(
      screen.getByText(/redirects to Zerodha's own login page, where you complete 2FA \(TOTP\)/),
    ).toBeInTheDocument();
  });

  it("enables Zerodha's authorize button once step 1 is configured, and starts the real OAuth redirect", async () => {
    const fetchMock = mockFetch({ configured: { zerodha: "2026-09-20T00:00:00Z", kotak: null } });
    renderScreen();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Authorize with Zerodha" })).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Authorize with Zerodha" }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/broker-auth/zerodha/login-url"))).toBe(
        true,
      ),
    );
  });

  it("collapses step 1 to a summary once configured, hiding the credential fields", async () => {
    mockFetch({ configured: { zerodha: "2026-09-20T00:00:00Z", kotak: null } });
    renderScreen();

    await waitFor(() => expect(screen.getByText("Configured")).toBeInTheDocument());
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconfigure" })).toBeInTheDocument();
  });

  it("Reconfigure re-opens a blank form for a broker that was already configured", async () => {
    mockFetch({ configured: { zerodha: "2026-09-20T00:00:00Z", kotak: null } });
    renderScreen();
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconfigure" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reconfigure" }));

    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.getByLabelText("API Secret")).toHaveValue("");
  });

  it("switches to Kotak and shows its step 1 direct-login setup fields", () => {
    mockFetch();
    renderScreen();

    fireEvent.click(screen.getByRole("tab", { name: "Kotak" }));

    expect(screen.getByLabelText("Access Token (Neo API Key)")).toBeInTheDocument();
    expect(screen.getByLabelText("Registered Mobile Number")).toBeInTheDocument();
    expect(screen.getByLabelText("UCC / Client Code")).toBeInTheDocument();
  });

  it("keeps Kotak's authorize button disabled until step 1 is configured and TOTP/MPIN are both 6 digits", async () => {
    mockFetch({ configured: { zerodha: null, kotak: "2026-09-20T00:00:00Z" } });
    renderScreen();
    fireEvent.click(screen.getByRole("tab", { name: "Kotak" }));

    const authorizeButton = screen.getByRole("button", { name: "Authorize for today" });
    await waitFor(() => expect(authorizeButton).toBeDisabled());

    fireEvent.change(screen.getByLabelText("TOTP (2FA, today only)"), { target: { value: "123456" } });
    expect(authorizeButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("MPIN (today only)"), { target: { value: "654321" } });
    expect(authorizeButton).not.toBeDisabled();
  });

  it("submits Kotak's real TOTP+MPIN login, shows the authorized-until status, and toasts success", async () => {
    const fetchMock = mockFetch({ configured: { zerodha: null, kotak: "2026-09-20T00:00:00Z" } });
    renderScreen();
    fireEvent.click(screen.getByRole("tab", { name: "Kotak" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Authorize for today" })).toBeDisabled(),
    );
    fireEvent.change(screen.getByLabelText("TOTP (2FA, today only)"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("MPIN (today only)"), { target: { value: "654321" } });

    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }) as Response);
    fetchMock.mockImplementationOnce(
      async () => ({ ok: true, json: async () => ({ zerodha: null, kotak: "2026-09-21T13:00:00Z" }) }) as Response,
    );
    fireEvent.click(screen.getByRole("button", { name: "Authorize for today" }));

    await waitFor(() => expect(screen.getByText(/Authorized until/)).toBeInTheDocument());
    // Appears twice, legitimately: the inline banner and the toast.
    expect(screen.getAllByText("Kotak authorized for today.").length).toBeGreaterThan(0);
    const postCall = fetchMock.mock.calls.find(([url, init]) =>
      String(url).includes("/broker-auth/kotak/login") && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall?.[1] as RequestInit).body as string)).toEqual({ totp: "123456", mpin: "654321" });
  });

  it("keeps Save disabled until the required fields for the active broker are valid", () => {
    mockFetch();
    renderScreen();

    const saveButton = screen.getByRole("button", { name: /Save (Zerodha|Kotak) configuration/ });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "my_key" } });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "a_valid_long_api_secret" },
    });
    expect(saveButton).not.toBeDisabled();
  });

  it("saves step 1 setup for real, reflects Configured, and toasts success", async () => {
    const fetchMock = mockFetch();
    renderScreen();
    await waitFor(() => expect(screen.getByText("Not configured")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "my_key" } });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "a_valid_long_api_secret" },
    });
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({}) }) as Response);
    fetchMock.mockImplementationOnce(
      async () => ({ ok: true, json: async () => ({ zerodha: "2026-09-21T00:00:00Z", kotak: null }) }) as Response,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save (Zerodha|Kotak) configuration/ }));

    await waitFor(() => expect(screen.getByText("Configured")).toBeInTheDocument());
    expect(screen.getByText("Zerodha setup saved.")).toBeInTheDocument();
    const postCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall?.[0]).toContain("/v1/broker-credentials/zerodha");
  });

  it("toasts an error, not just the silent inline footer text, when Save fails", async () => {
    const fetchMock = mockFetch();
    renderScreen();
    await waitFor(() => expect(screen.getByText("Not configured")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "my_key" } });
    fireEvent.change(screen.getByLabelText("API Secret"), {
      target: { value: "a_valid_long_api_secret" },
    });
    fetchMock.mockImplementationOnce(
      async () => ({ ok: false, status: 400, json: async () => ({ message: "Kite rejected that key." }) }) as Response,
    );
    fireEvent.click(screen.getByRole("button", { name: /Save (Zerodha|Kotak) configuration/ }));

    await waitFor(() => expect(screen.getAllByText("Kite rejected that key.").length).toBeGreaterThan(0));
  });

  it("Cancel clears the active broker's fields without implying anything was ever saved", () => {
    mockFetch();
    renderScreen();

    fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "my_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("API Key")).toHaveValue("");
  });
});
