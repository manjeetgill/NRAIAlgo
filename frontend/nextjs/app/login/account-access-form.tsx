"use client";

import { useState, type FormEvent } from "react";
import styles from "./login.module.css";

export function AccountAccessForm({ mode, initialEmail, onBack }: { mode: "invite" | "reset"; initialEmail: string; onBack: (email: string, notice?: string) => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invite = mode === "invite";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setError(""); setBusy(true);
    try {
      const response = await fetch(invite ? "/v1/auth/register" : "/v1/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, code: code.trim() }), signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? "Unable to complete this request. Please try again.");
      }
      onBack(email, invite ? "Account created. Sign in with your new password." : "Password reset. Existing sessions have been signed out. Sign in with your new password.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request failed."); setBusy(false); }
  }

  return <form className={styles.card} onSubmit={event => void submit(event)}>
    <span className={styles.eyebrow}>NRAIAlgo · Private workspace</span>
    <h1 className={styles.title}>{invite ? "Create your account" : "Reset your password"}</h1>
    <p className={styles.subtitle}>{invite ? "Join with an invitation from the app owner." : "Recover access using a code from the app owner."}</p>
    <div className={styles.help}>
      {invite ? "Ask the owner for an invitation code issued to your email. It expires after 24 hours. Your account has its own workspace; it does not grant access to the owner's brokerage accounts." : "Contact the owner to verify your identity and receive a recovery code. It expires after 30 minutes."}
      <p>Email delivery is not configured. No automated email will be sent. Each code can be used once.</p>
    </div>
    <fieldset disabled={busy} className={styles.fields}>
      <div className={styles.field}><label htmlFor="access-email">Email</label><input id="access-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></div>
      <div className={styles.field}><label htmlFor="access-code">{invite ? "Invitation code" : "Recovery code"}</label><input id="access-code" type="password" autoComplete="off" required minLength={43} maxLength={43} value={code} onChange={event => setCode(event.target.value.trim())} /></div>
      <div className={styles.field}><label htmlFor="access-password">New password</label><input id="access-password" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={event => setPassword(event.target.value)} /><small>Use 12–256 characters. A unique passphrase is recommended.</small></div>
      <div className={styles.field}><label htmlFor="access-confirmation">Confirm new password</label><input id="access-confirmation" type={visible ? "text" : "password"} autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></div>
      <button type="button" className={styles.textButton} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide passwords" : "Show passwords"}</button>
    </fieldset>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <button type="submit" className={styles.submit} disabled={busy}>{busy ? "Saving…" : invite ? "Create account" : "Reset password"}</button>
    <button type="button" className={styles.textButton} disabled={busy} onClick={() => onBack(email)}>Back to sign in</button>
  </form>;
}
