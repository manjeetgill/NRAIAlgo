"use client";

import { useSyncExternalStore } from "react";

const key = "nraialgo-theme";
const changed = "nraialgo-theme-change";
function snapshot() { return document.documentElement.dataset.theme === "light" ? "light" : "dark"; }
function subscribe(listener: () => void) {
  function sync(event?: StorageEvent) {
    if (event && event.key !== key && event.key !== null) return;
    try { document.documentElement.dataset.theme = localStorage.getItem(key) === "light" ? "light" : "dark"; }
    catch { /* Restricted storage must not prevent switching this tab. */ }
    listener();
  }
  sync();
  window.addEventListener("storage", sync);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", sync); window.removeEventListener(changed, listener); };
}

/** Presentation only: never changes account context, market state or execution. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  return (
    <button type="button" className="theme-toggle" aria-label="Light theme" aria-pressed={theme === "light"}
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(key, next); } catch { /* Still works without persistence. */ }
        window.dispatchEvent(new Event(changed));
      }}>
      <span aria-hidden="true">{theme === "light" ? "☀" : "☾"}</span>
      {theme === "light" ? "Light" : "Dark"}
    </button>
  );
}
