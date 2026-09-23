"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import styles from "./toast.module.css";

export type ToastKind = "success" | "error";
interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastContextValue {
  show: (text: string, kind: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 5000;

/**
 * Minimal toast system: a fixed stack in the corner, auto-dismissed after a
 * few seconds. Deliberately just success/error -- every save/authorize
 * action in this app already has its own inline status text for detail;
 * the toast is only the "something just happened" signal so an action
 * never resolves silently.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);
  const nextId = useRef(0);

  const show = useCallback((text: string, kind: ToastKind) => {
    const id = nextId.current++;
    setMessages((current) => [...current, { id, kind, text }]);
    setTimeout(() => {
      setMessages((current) => current.filter((message) => message.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={styles.stack} role="status" aria-live="polite">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.toast} ${message.kind === "success" ? styles.success : styles.error}`}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              {message.kind === "success" ? "check_circle" : "error"}
            </span>
            {message.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Throws outside a ToastProvider rather than silently no-op-ing -- a
 * toast call that never renders anywhere is worse than a loud crash while
 * building the feature that forgot to mount the provider. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast() must be used inside a ToastProvider.");
  }
  return context;
}
