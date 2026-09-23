import styles from "./status-badge.module.css";

export type StatusBadgeKind = "positive" | "negative" | "warning" | "neutral";

// CSS module imports type as an index signature, so under
// noUncheckedIndexedAccess every lookup is `string | undefined` even
// for class names we know exist -- `?? ""` documents that these are
// trusted, self-authored keys rather than arbitrary external input.
const KIND_CLASS: Record<StatusBadgeKind, string> = {
  positive: styles.positive ?? "",
  negative: styles.negative ?? "",
  warning: styles.warning ?? "",
  neutral: styles.neutral ?? "",
};

/**
 * Small colored pill for a discrete status value (readiness, feed
 * health, broker authentication, worker status, ...). Deliberately
 * generic: each screen maps its own domain-specific status enum onto
 * one of the four visual `kind`s rather than this component knowing
 * about any particular domain.
 */
export function StatusBadge({ kind, label }: { kind: StatusBadgeKind; label: string }) {
  return <span className={`${styles.badge} ${KIND_CLASS[kind]}`}>{label}</span>;
}
