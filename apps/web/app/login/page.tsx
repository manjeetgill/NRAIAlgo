"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

/**
 * The only public route under /app's authentication boundary. Every other
 * screen now requires a session (see app/app/layout.tsx's auth gate) --
 * this is where that session is created. There is deliberately no signup
 * link here: this is a single-operator app, and account creation happens
 * out-of-band via `npm run create-user --workspace apps/api`, not over HTTP.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setState("submitting");
    setError(null);
    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Sign in failed (HTTP ${response.status})`);
      }
      router.replace("/app/overview");
    } catch (caught) {
      setState("error");
      setError(caught instanceof Error ? caught.message : "Sign in failed");
    }
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
        <h1 className={styles.title}>NRAIAlgo</h1>
        <p className={styles.subtitle}>Sign in to your workspace</p>

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
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <button type="submit" className={styles.submit} disabled={state === "submitting"}>
          {state === "submitting" ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
