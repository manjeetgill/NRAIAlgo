"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import styles from "./broker-connections.module.css";
import { StatusBadge } from "@/app/components/status-badge/status-badge";
import { useToast } from "@/app/components/toast/toast";
import { formatTimestamp } from "@/app/app/overview/format";
import { IciciConnection } from "./icici-connection";

import { useOverviewSnapshot } from "../overview/use-overview-snapshot";
import { useIciciAccount } from "../overview/use-icici-account";
import { withIciciOverviewStatus } from "../overview/icici-overview-status";
import { BrokerHealth } from "../overview/broker-health";
import { useShellOverview } from "@/app/components/shell/overview-context";

type BrokerId = "zerodha" | "kotak";
type ConfiguredStatus = Record<BrokerId, string | null>;
type SessionStatus = Record<BrokerId, string | null>;

/**
 * Field requirements below are taken from the actual Zerodha Kite Connect and
 * Kotak Neo APIs (verified against AlgoTrade's working integration), not
 * guessed or copied from a visual reference. Both brokers split into two
 * genuinely different steps, not one form -- and both are now real:
 *
 *  1. Setup (one-time): register app-level credentials. Save POSTs to
 *     /v1/broker-credentials/:provider, which encrypts the value at rest
 *     (AES-256-GCM) before writing it to PostgreSQL. Once configured, the
 *     form collapses to a summary with an explicit Reconfigure action --
 *     fields never show the previously saved secret back (it's never
 *     returned by the API), so "reconfigure" always means entering both
 *     values fresh, not editing a partially-filled form.
 *  2. Daily authorization (recurring, every trading day): Zerodha is a real
 *     OAuth redirect -- Authorize sends the browser to Kite's own login
 *     page (where the account holder's client ID, password and TOTP are
 *     entered, never here), and Kite redirects back to our callback, which
 *     exchanges the request token for the day's access token. Kotak is a
 *     real two-step login (TOTP, then MPIN) submitted directly to this
 *     screen's form, matching Kotak Neo's actual API -- there is no OAuth
 *     redirect for this broker.
 *
 * Honest limitation: this is built against the documented/proven protocol
 * (ported from AlgoTrade's working adapters) but has not been exercised
 * against a live Zerodha or Kotak account in this environment -- there are
 * no real broker credentials available to test with here.
 *
 * There is no "HFT execution endpoint," "institutional routing tier," or
 * PIS bank-account field in either broker's actual app-setup API; those
 * would need to be modeled as separate account/banking data, not part of
 * API credential setup, and are out of scope here.
 */
export function BrokerConnectionsScreen() {
  const toast = useToast();
  const overview = useOverviewSnapshot(), icici = useIciciAccount();
  const shared = useMemo(() => overview.snapshot ? withIciciOverviewStatus(overview.snapshot,icici.account,icici.stale) : null,[overview.snapshot,icici.account,icici.stale]);
  useShellOverview(shared,overview.stale);
  const [activeBroker, setActiveBroker] = useState<BrokerId | "icici">("zerodha");
  useEffect(() => { const select = () => { const value = window.location.hash.slice(1); if (value === "zerodha" || value === "kotak" || value === "icici") setActiveBroker(value); }; select(); window.addEventListener("hashchange",select); return () => window.removeEventListener("hashchange",select); }, []);
  const [showZerodhaSecret, setShowZerodhaSecret] = useState(false);

  const [zerodhaApiKey, setZerodhaApiKey] = useState("");
  const [zerodhaApiSecret, setZerodhaApiSecret] = useState("");
  const [kotakAccessToken, setKotakAccessToken] = useState("");
  const [kotakMobile, setKotakMobile] = useState("");
  const [kotakUcc, setKotakUcc] = useState("");
  const [kotakTotp, setKotakTotp] = useState("");
  const [kotakMpin, setKotakMpin] = useState("");

  const [configured, setConfigured] = useState<ConfiguredStatus>({ zerodha: null, kotak: null });
  const [session, setSession] = useState<SessionStatus>({ zerodha: null, kotak: null });
  const [redirectUrl, setRedirectUrl] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [authState, setAuthState] = useState<"idle" | "authorizing" | "error">("idle");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  // Once configured, step 1 collapses to a summary; Reconfigure re-opens
  // the (always-blank) form for that broker specifically.
  const [reconfiguring, setReconfiguring] = useState<Record<BrokerId, boolean>>({
    zerodha: false,
    kotak: false,
  });

  const onChange = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) =>
    setter(event.target.value);

  async function refreshConfigured() {
    const response = await fetch("/v1/broker-credentials/status");
    if (response.ok) {
      setConfigured(await response.json());
    }
  }

  async function refreshSession() {
    const response = await fetch("/v1/broker-auth/status");
    if (response.ok) {
      setSession(await response.json());
    }
  }

  // Defined inline (not calling the functions above) so the mount-time
  // fetches stay plain effect-scoped async functions, per React's own
  // data-fetching pattern -- the shared refresh functions above are only
  // ever invoked from event handlers, never from this effect.
  useEffect(() => {
    let cancelled = false;
    async function loadInitialState() {
      const [configuredResponse, sessionResponse, redirectResponse] = await Promise.all([
        fetch("/v1/broker-credentials/status"),
        fetch("/v1/broker-auth/status"),
        fetch("/v1/broker-auth/zerodha/redirect-url"),
      ]);
      if (cancelled) {
        return;
      }
      if (configuredResponse.ok) {
        setConfigured(await configuredResponse.json());
      }
      if (sessionResponse.ok) {
        setSession(await sessionResponse.json());
      }
      if (redirectResponse.ok) {
        setRedirectUrl((await redirectResponse.json()).url);
      }
      // The Zerodha OAuth callback redirects back here with this query
      // param; read it once, then drop it from the URL so a page refresh
      // doesn't re-show a stale result.
      const params = new URLSearchParams(window.location.search);
      const zerodhaAuth = params.get("zerodha_auth");
      if (zerodhaAuth === "success") {
        setAuthNotice("Zerodha authorized for today.");
      } else if (zerodhaAuth === "error") {
        setAuthError("Zerodha authorization failed or was cancelled.");
      }
      if (zerodhaAuth) {
        params.delete("zerodha_auth");
        window.history.replaceState({}, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
      }
    }
    void loadInitialState();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    const payload =
      activeBroker === "zerodha"
        ? { apiKey: zerodhaApiKey, apiSecret: zerodhaApiSecret }
        : { accessToken: kotakAccessToken, mobileNumber: kotakMobile, ucc: kotakUcc };
    try {
      const response = await fetch(
        `/v1/broker-credentials/${activeBroker}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Save failed (HTTP ${response.status})`);
      }
      setSaveState("idle");
      setReconfiguring((current) => ({ ...current, [activeBroker]: false }));
      await refreshConfigured();
      toast.show(
        `${activeBroker === "zerodha" ? "Zerodha" : "Kotak"} setup saved.`,
        "success",
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Save failed";
      setSaveState("error");
      setSaveError(message);
      toast.show(message, "error");
    }
  }

  function handleCancel() {
    if (activeBroker === "zerodha") {
      setZerodhaApiKey("");
      setZerodhaApiSecret("");
    } else {
      setKotakAccessToken("");
      setKotakMobile("");
      setKotakUcc("");
    }
    setSaveState("idle");
    setSaveError(null);
    // Cancelling a reconfigure just returns to the summary; there is
    // nothing to collapse for a broker that was never configured.
    setReconfiguring((current) => ({ ...current, [activeBroker]: false }));
  }

  async function handleAuthorizeZerodha() {
    setAuthState("authorizing");
    setAuthError(null);
    setAuthNotice(null);
    try {
      const response = await fetch("/v1/broker-auth/zerodha/login-url");
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Could not start Zerodha authorization.");
      }
      const { url } = await response.json();
      // Full-page navigation, not a fetch: this must land on Zerodha's own
      // login page in the real browser, not be consumed as an API response.
      window.location.href = url;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not start Zerodha authorization.";
      setAuthState("error");
      setAuthError(message);
      toast.show(message, "error");
    }
  }

  async function handleAuthorizeKotak() {
    setAuthState("authorizing");
    setAuthError(null);
    setAuthNotice(null);
    try {
      const response = await fetch("/v1/broker-auth/kotak/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ totp: kotakTotp, mpin: kotakMpin }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Authorization failed (HTTP ${response.status})`);
      }
      setKotakTotp("");
      setKotakMpin("");
      setAuthState("idle");
      setAuthNotice("Kotak authorized for today.");
      await refreshSession();
      toast.show("Kotak authorized for today.", "success");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Kotak authorization failed.";
      setAuthState("error");
      setAuthError(message);
      toast.show(message, "error");
    }
  }

  const canSave =
    activeBroker === "zerodha"
      ? zerodhaApiKey.trim().length > 0 && zerodhaApiSecret.trim().length >= 16
      : kotakAccessToken.trim().length >= 8 &&
        /^\+91[0-9]{10}$/.test(kotakMobile.trim()) &&
        kotakUcc.trim().length > 0;

  const zerodhaAuthorizeDisabled = !configured.zerodha || authState === "authorizing";
  const kotakAuthorizeDisabled =
    !configured.kotak || !/^\d{6}$/.test(kotakTotp) || !/^\d{6}$/.test(kotakMpin) || authState === "authorizing";

  const showZerodhaForm = !configured.zerodha || reconfiguring.zerodha;
  const showKotakForm = !configured.kotak || reconfiguring.kotak;

  return (
    <main className={styles.page}>
      <div className={styles.mockNotice} role="note" aria-label="Backend status notice">
        <strong>Broker setup and authorization.</strong> Save app credentials once,
        then authorize each broker session when required. Account data appears in
        Algo Terminal and Cash Holdings. Authorization permits account reads;
        order execution is unavailable.
      </div>
      <details><summary>Session and service health</summary><dl><dt>Application configuration</dt><dd>{shared?.configuredProviders?.includes(activeBroker) ? "Configured" : "Not confirmed"}</dd><dt>Daily authorization</dt><dd>{shared?.authorizedProviders?.includes(activeBroker) ? "Session received; core reads determine health" : "Authorization required"}</dd><dt>Portfolio</dt><dd>{activeBroker === "icici" ? icici.account?.sections.portfolioholdings?.status ?? "Not received" : shared?.brokerReconciliation?.[activeBroker]?.status ?? "Not received"}</dd><dt>Orders</dt><dd>{activeBroker === "icici" ? icici.account?.sections.order?.status ?? "Not received" : activeBroker === "zerodha" ? shared?.brokerOrders?.status ?? "Not received" : "Not connected"}</dd><dt>Funds</dt><dd>{activeBroker === "icici" ? icici.account?.sections.funds?.status ?? "Not received" : shared?.holdings.data?.brokerBalances?.some(row=>row.provider===activeBroker) ? "Received" : "Not received"}</dd><dt>Market data</dt><dd>{activeBroker === "zerodha" ? shared?.marketStream?.status ?? "Snapshot" : "Snapshot"}</dd><dt>Trading</dt><dd>Disabled</dd></dl><details><summary>Technical diagnostics</summary><p>{shared?.holdings.reason}</p><p>{shared?.brokerOrders?.reason}</p><p>{activeBroker === "icici" ? icici.status : ""}</p></details></details>
      {authNotice && (
        <div className={styles.mockNotice} role="status" aria-label="Authorization notice">
          {authNotice}
        </div>
      )}
      {authError && (
        <div className={styles.mockNotice} role="alert" aria-label="Authorization error">
          {authError}
        </div>
      )}

      <div className={styles.header}>
        <BrokerHealth snapshot={shared} stale={overview.stale}/><button type="button" onClick={()=>{overview.refresh();icici.refresh();void refreshSession();}}>Refresh connection health</button>
      <h1 className={styles.title}>Broker Gateways</h1>
        <p className={styles.subtitle}>
          Two separate steps per broker: setup once, then authorize again
          every trading day. Broker sessions expire daily, so step 2 is
          never a one-time action.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.tabs} role="tablist" aria-label="Broker">
          <button
            type="button"
            role="tab"
            aria-selected={activeBroker === "zerodha"}
            className={`${styles.tab} ${activeBroker === "zerodha" ? styles.tabActive : ""}`}
            onClick={() => setActiveBroker("zerodha")}
          >
            Zerodha Kite
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeBroker === "kotak"}
            className={`${styles.tab} ${activeBroker === "kotak" ? styles.tabActive : ""}`}
            onClick={() => setActiveBroker("kotak")}
          >
            Kotak
          </button>
          <button type="button" role="tab" aria-selected={activeBroker === "icici"} className={`${styles.tab} ${activeBroker === "icici" ? styles.tabActive : ""}`} onClick={() => setActiveBroker("icici")}>ICICI</button>
        </div>

        {activeBroker === "icici" ? <IciciConnection /> : activeBroker === "zerodha" ? (
          <div className={styles.tabPanel} role="tabpanel" aria-label="Zerodha Kite setup">
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>Step 1</span>
              <div>
                <h2 className={styles.brokerName}>App setup (one-time)</h2>
                <p className={styles.brokerNote}>
                  API key/secret, registered once against a Kite Connect app.
                </p>
              </div>
              {configured.zerodha ? (
                <StatusBadge kind="positive" label="Configured" />
              ) : (
                <StatusBadge kind="neutral" label="Not configured" />
              )}
            </div>

            {showZerodhaForm ? (
              <>
                <div className={styles.fieldGroup}>
                  <div className={styles.field}>
                    <label htmlFor="zerodha-api-key">API Key</label>
                    <input
                      id="zerodha-api-key"
                      type="text"
                      placeholder="From your Kite Connect app"
                      value={zerodhaApiKey}
                      onChange={onChange(setZerodhaApiKey)}
                      autoComplete="off"
                    />
                  </div>
                  <div className={`${styles.field} ${styles.secretField}`}>
                    <label htmlFor="zerodha-api-secret">API Secret</label>
                    <input
                      id="zerodha-api-secret"
                      type={showZerodhaSecret ? "text" : "password"}
                      placeholder="From your Kite Connect app"
                      value={zerodhaApiSecret}
                      onChange={onChange(setZerodhaApiSecret)}
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className={styles.secretToggle}
                      onClick={() => setShowZerodhaSecret((value) => !value)}
                      aria-label={showZerodhaSecret ? "Hide API secret" : "Show API secret"}
                    >
                      <span className="material-symbols-outlined" aria-hidden="true">
                        {showZerodhaSecret ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="zerodha-redirect-url">Redirect URL to register on Kite Connect</label>
                  <input
                    id="zerodha-redirect-url"
                    type="text"
                    value={redirectUrl}
                    placeholder="Loading…"
                    disabled
                    readOnly
                  />
                </div>
              </>
            ) : (
              <div className={styles.calloutBox}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  check_circle
                </span>
                <span>App credentials are saved and encrypted. Reconfigure to replace them.</span>
                <button
                  type="button"
                  className={styles.smallReconfigureButton}
                  onClick={() => setReconfiguring((current) => ({ ...current, zerodha: true }))}
                >
                  Reconfigure
                </button>
              </div>
            )}

            <div className={styles.stepDivider} />

            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>Step 2</span>
              <div>
                <h2 className={styles.brokerName}>Authorize for today</h2>
                <p className={styles.brokerNote}>
                  Required every trading day -- Kite access tokens expire at
                  the start of the next session.
                </p>
              </div>
              {session.zerodha ? (
                <StatusBadge kind="positive" label={`Authorized until ${formatTimestamp(session.zerodha)}`} />
              ) : (
                <StatusBadge kind="warning" label="Not authorized today" />
              )}
            </div>

            <button
              type="button"
              className={`${styles.button} ${session.zerodha ? styles.buttonSecondary : styles.buttonPrimary}`}
              onClick={() => void handleAuthorizeZerodha()}
              disabled={zerodhaAuthorizeDisabled}
              title={configured.zerodha ? undefined : "Save step 1 (app setup) before authorizing"}
            >
              {authState === "authorizing" ? "Redirecting…" : session.zerodha ? "Re-authorize Zerodha" : "Authorize with Zerodha"}
            </button>

            <div className={styles.calloutBox}>
              <span className="material-symbols-outlined" aria-hidden="true">
                info
              </span>
              <span>
                Authorizing redirects to Zerodha&apos;s own login page, where
                you complete 2FA (TOTP). Your Zerodha client ID, password and
                TOTP are entered there, never in this app.
              </span>
            </div>
          </div>
        ) : (
          <div className={styles.tabPanel} role="tabpanel" aria-label="Kotak setup">
            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>Step 1</span>
              <div>
                <h2 className={styles.brokerName}>App setup (one-time)</h2>
                <p className={styles.brokerNote}>
                  Access token, mobile number and UCC -- no OAuth redirect for
                  this broker.
                </p>
              </div>
              {configured.kotak ? (
                <StatusBadge kind="positive" label="Configured" />
              ) : (
                <StatusBadge kind="neutral" label="Not configured" />
              )}
            </div>

            {showKotakForm ? (
              <>
                <div className={styles.fieldGroup}>
                  <div className={styles.field}>
                    <label htmlFor="kotak-access-token">Access Token (Neo API Key)</label>
                    <input
                      id="kotak-access-token"
                      type="text"
                      placeholder="From the Kotak developer portal"
                      value={kotakAccessToken}
                      onChange={onChange(setKotakAccessToken)}
                      autoComplete="off"
                    />
                  </div>
                  <div className={styles.field}>
                    <label htmlFor="kotak-mobile">Registered Mobile Number</label>
                    <input
                      id="kotak-mobile"
                      type="text"
                      placeholder="+91XXXXXXXXXX"
                      value={kotakMobile}
                      onChange={onChange(setKotakMobile)}
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label htmlFor="kotak-ucc">UCC / Client Code</label>
                  <input
                    id="kotak-ucc"
                    type="text"
                    placeholder="Your Kotak client code"
                    value={kotakUcc}
                    onChange={onChange(setKotakUcc)}
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              <div className={styles.calloutBox}>
                <span className="material-symbols-outlined" aria-hidden="true">
                  check_circle
                </span>
                <span>App credentials are saved and encrypted. Reconfigure to replace them.</span>
                <button
                  type="button"
                  className={styles.smallReconfigureButton}
                  onClick={() => setReconfiguring((current) => ({ ...current, kotak: true }))}
                >
                  Reconfigure
                </button>
              </div>
            )}

            <div className={styles.stepDivider} />

            <div className={styles.stepHeader}>
              <span className={styles.stepBadge}>Step 2</span>
              <div>
                <h2 className={styles.brokerName}>Authorize for today</h2>
                <p className={styles.brokerNote}>
                  Required every trading day -- Kotak sessions expire and
                  must be renewed each morning.
                </p>
              </div>
              {session.kotak ? (
                <StatusBadge kind="positive" label={`Authorized until ${formatTimestamp(session.kotak)}`} />
              ) : (
                <StatusBadge kind="warning" label="Not authorized today" />
              )}
            </div>

            <div className={styles.fieldGroup}>
              <div className={styles.field}>
                <label htmlFor="kotak-totp">TOTP (2FA, today only)</label>
                <input
                  id="kotak-totp"
                  type="text"
                  placeholder="6-digit code"
                  value={kotakTotp}
                  onChange={onChange(setKotakTotp)}
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="kotak-mpin">MPIN (today only)</label>
                <input
                  id="kotak-mpin"
                  type="password"
                  placeholder="6-digit MPIN"
                  value={kotakMpin}
                  onChange={onChange(setKotakMpin)}
                  autoComplete="off"
                  inputMode="numeric"
                  maxLength={6}
                />
              </div>
            </div>
            <p className={styles.sessionNote}>
              TOTP and MPIN are used once per login and are never stored --
              you&apos;ll enter fresh ones every trading day.
            </p>
            <button
              type="button"
              className={`${styles.button} ${session.kotak ? styles.buttonSecondary : styles.buttonPrimary}`}
              onClick={() => void handleAuthorizeKotak()}
              disabled={kotakAuthorizeDisabled}
              title={configured.kotak ? undefined : "Save step 1 (app setup) before authorizing"}
            >
              {authState === "authorizing" ? "Authorizing…" : session.kotak ? "Re-authorize Kotak" : "Authorize for today"}
            </button>
          </div>
        )}
      </div>

      {activeBroker !== "icici" && (!configured[activeBroker] || reconfiguring[activeBroker]) && <div className={`${styles.card} ${styles.footer}`}>
        <span className={styles.footerNote}>
          <span className="material-symbols-outlined" aria-hidden="true">
            lock
          </span>
          {saveError ?? "Saved credentials are encrypted at rest (AES-256-GCM) before being written to PostgreSQL."}
        </span>
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={handleCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.buttonPrimary}`}
            onClick={handleSave}
            disabled={!canSave || saveState === "saving"}
          >
            {saveState === "saving" ? "Saving…" : `Save ${activeBroker === "zerodha" ? "Zerodha" : "Kotak"} configuration`}
          </button>
        </div>
      </div>}
    </main>
  );
}
