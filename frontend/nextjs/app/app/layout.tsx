"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Shell } from "@/app/components/shell/shell";

/**
 * Auth gate for every /app/* screen. Checks GET /v1/auth/me on mount; an
 * unauthenticated caller is sent to /login before any protected screen (or
 * the data it would fetch) ever renders. The backend independently rejects
 * unauthenticated requests to every data route too (see routes/*.ts's
 * requireAuth) -- this is the UX-level mirror of that, not a substitute
 * for it.
 */
export default function AppSectionLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkSession() {
      try {
        const response = await fetch("/v1/auth/me");
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          router.replace("/login");
          return;
        }
        const body = await response.json();
        setEmail(body.email);
        setChecked(true);
      } catch {
        if (!cancelled) {
          router.replace("/login");
        }
      }
    }
    void checkSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function handleSignOut() {
    await fetch("/v1/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!checked) {
    return null;
  }

  return (
    <Shell email={email} onSignOut={() => void handleSignOut()}>
      {children}
    </Shell>
  );
}
