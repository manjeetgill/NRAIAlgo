"use client";

import { useEffect, useState } from "react";
import { formatTimestamp } from "../overview/format";
import styles from "./broker-connections.module.css";

export function IciciConnection() {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/v1/broker-credentials/status"), fetch("/v1/broker-auth/status")]).then(async ([config, session]) => {
      if (!config.ok || !session.ok) throw new Error();
      const [c, s] = await Promise.all([config.json(), session.json()]);
      if (!cancelled) { setConfigured(Boolean(c.icici)); setExpiresAt(s.icici ?? null); }
    }).catch(() => { if (!cancelled) setMessage("Could not load ICICI connection status. Reload to retry."); });
    return () => { cancelled = true; };
  }, [version]);

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/v1/broker-credentials/icici", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey, apiSecret }) });
      if (!response.ok) throw new Error();
      setApiKey(""); setApiSecret(""); setConfigured(true); setEditing(false); setExpiresAt(null);
      setMessage("ICICI credentials saved encrypted. Authorize a fresh session below.");
    } catch { setMessage("Could not save ICICI credentials. Check the fields and try again."); }
    finally { setBusy(false); }
  }

  async function openLogin() {
    setBusy(true); setMessage("");
    // Open synchronously so the browser does not block a window after the fetch.
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    try {
      const response = await fetch("/v1/broker-auth/icici/login-url");
      if (!response.ok) throw new Error();
      const { url } = await response.json();
      const target = new URL(url);
      if (target.origin !== "https://api.icicidirect.com") throw new Error();
      if (!popup) { setMessage("Allow popups to open the ICICI authorization page."); return; }
      popup.location.href = target.href;
    } catch { popup?.close(); setMessage("Could not open ICICI login. Save your credentials first."); }
    finally { setBusy(false); }
  }

  async function authorize() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/v1/broker-auth/icici/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionToken }) });
      if (!response.ok) throw new Error();
      setSessionToken(""); setVersion((value) => value + 1);
      setMessage("ICICI authorized for read-only account access.");
    } catch { setMessage("ICICI authorization failed. Check your app credentials and fresh API session token, then retry."); }
    finally { setBusy(false); }
  }

  return <div className={styles.tabPanel} role="tabpanel" aria-label="ICICI setup">
    <h2>ICICI Direct · Breeze</h2>
    <p>Read-only account access. Orders cannot be placed, modified or cancelled here.</p>
    <h3>1. App setup {configured ? "· Saved" : ""}</h3>
    {configured && !editing && <button type="button" onClick={()=>setEditing(true)}>Edit ICICI configuration</button>}
    {(!configured || editing) && <><p>Enter the API key and secret from your Breeze app. Saved secrets are never displayed.</p>
    <div className={styles.fieldGroup}>
      <label className={styles.field}>Breeze API key<input value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" /></label>
      <label className={styles.field}>Breeze API secret<input type="password" value={apiSecret} onChange={(event) => setApiSecret(event.target.value)} autoComplete="new-password" /></label>
    </div>
    <button type="button" className={styles.buttonPrimary} disabled={busy || !apiKey.trim() || !apiSecret.trim()} onClick={save}>Save ICICI configuration</button><button type="button" onClick={()=>{setEditing(false);setApiKey("");setApiSecret("");}}>Cancel</button></>}
    <h3>2. Daily authorization</h3>
    <p>Complete login on ICICI’s own page, then paste its API session token here. Do not enter your brokerage password. This app requires reauthorization by midnight IST; the broker may expire the session sooner.</p>
    <button type="button" className={styles.buttonSecondary} disabled={busy || !configured} onClick={openLogin}>Open ICICI login</button>
    <label className={styles.field}>Breeze API session token<input type="password" value={sessionToken} onChange={(event) => setSessionToken(event.target.value)} autoComplete="off" /></label>
    <button type="button" className={expiresAt ? styles.buttonSecondary : styles.buttonPrimary} disabled={busy || !configured || !sessionToken.trim()} onClick={authorize}>{busy ? "Working…" : expiresAt ? "Re-authorize ICICI" : "Authorize ICICI"}</button>
    {expiresAt && <p>Session saved until {formatTimestamp(expiresAt) + " IST"}. View account data on the dashboard.</p>}
    {message && <p role="status">{message}</p>}
  </div>;
}
