"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";
import { ThemeToggle } from "@/app/components/shell/theme-toggle";
import { AccountAccessForm } from "./account-access-form";

/** First-user setup and subsequent owner-issued account access stay server-gated. */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "invite" | "reset">("login");
  const [visible, setVisible] = useState(false);
  const [retry, setRetry] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ needsSetup: boolean; setupEnabled: boolean } | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const [checkFailed, setCheckFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let active = true;
    fetch("/v1/auth/setup", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Setup status unavailable");
        const status = await response.json();
        if (typeof status.needsSetup !== "boolean" || typeof status.setupEnabled !== "boolean") throw new Error("Invalid setup status");
        if (active) setSetup(status);
      }).catch(() => { if (active) setCheckFailed(true); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [retry]);
  const creating = setup?.needsSetup === true;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (state === "submitting" || !setup || (creating && !setup.setupEnabled)) return;
    if (creating && password !== confirmation) { setError("Passwords do not match."); return; }
    setState("submitting");
    setError(null);
    try {
      const response = await fetch(creating ? "/v1/auth/setup" : "/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(creating ? { email, password, setupToken } : { email, password }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        if (creating && response.status === 409) { setSetup({ needsSetup: false, setupEnabled: false }); setSetupToken(""); setPassword(""); setConfirmation(""); }
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Sign in failed (HTTP ${response.status})`);
      }
      if (creating) {
        setSetup({ needsSetup: false, setupEnabled: false });
        setSetupToken(""); setPassword(""); setConfirmation("");
        setNotice("Account created. Sign in with your new password.");
        setState("idle");
        return;
      }
      router.replace("/app/overview");
    } catch (caught) {
      setState("error");
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.themeControl}><ThemeToggle /></div>
      {mode !== "login" ? <AccountAccessForm mode={mode} initialEmail={email} onBack={(value, message) => { setEmail(value); setMode("login"); setPassword(""); setConfirmation(""); setError(null); setState("idle"); setVisible(false); setNotice(message ?? ""); }} /> : <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
        <span className={styles.eyebrow}>Private trading workspace</span>
        <h1 className={styles.title}>NRAIAlgo</h1>
        <p className={styles.subtitle}>{creating ? "Create your first workspace user" : "Sign in to your workspace"}</p>
        {!setup && <p role="status">{checkFailed ? "Cannot check setup status. Reload the page to retry." : "Checking workspace setup…"}</p>}
        {checkFailed && <button type="button" className={styles.textButton} onClick={() => { setCheckFailed(false); setRetry(value => value + 1); }}>Retry connection</button>}
        {creating && !setup.setupEnabled && <p role="alert">Ask your deployment administrator to configure INITIAL_SETUP_TOKEN, then reload this page. Public signup is disabled.</p>}
        {notice && <p role="status">{notice}</p>}

        <div className={styles.field}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type={visible ? "text" : "password"}
            autoComplete={creating ? "new-password" : "current-password"}
            minLength={creating ? 12 : undefined}
            maxLength={creating ? 256 : undefined}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="button" className={styles.textButton} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide password" : "Show password"}</button>

        {creating && <>
          <div className={styles.field}>
            <label htmlFor="confirm-password">Confirm password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          </div>
          <div className={styles.field}>
            <label htmlFor="setup-key">Setup key</label>
            <input id="setup-key" type="password" autoComplete="off" required minLength={32} maxLength={256} value={setupToken} onChange={event => setSetupToken(event.target.value)} />
            <p>Use the one-time setup key supplied by your deployment administrator. Passwords must contain at least 12 characters.</p>
          </div>
        </>}

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={state === "submitting" || !setup || (creating && !setup.setupEnabled)}>
          {state === "submitting" ? (creating ? "Creating user…" : "Signing in…") : (creating ? "Create user" : "Sign in")}
        </button>
        {!creating && <nav className={styles.accessLinks} aria-label="Account access">
          <button type="button" className={styles.textButton} disabled={state === "submitting"} onClick={() => { setPassword(""); setMode("reset"); }}>Forgot password?</button>
          <button type="button" className={styles.textButton} disabled={state === "submitting"} onClick={() => { setPassword(""); setMode("invite"); }}>Use an owner-issued access code</button>
        </nav>}
        <p className={styles.footnote}>Broker credentials are connected separately after sign-in. Never enter your broker password here.</p>
      </form>}
    </main>
  );
}
