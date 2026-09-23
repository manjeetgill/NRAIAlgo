import type { ReactNode } from "react";
import styles from "./kpi-card.module.css";

export interface KpiCardProps {
  label: string;
  value: string;
  change: string;
  changePercent: string;
  direction: "up" | "down";
  /** Top-right tag; defaults to "Live". After Close/Weekend use "Close 15:30" or "Fri 25 Sep close" instead, since those prices are frozen, not live. */
  tag?: string;
  /** Optional caption line under the change, e.g. "Closing prices. They stay fixed until the next open." */
  caption?: string;
}

/** A single headline-quote tile (index/instrument watch value). */
export function KpiCard({ label, value, change, changePercent, direction, tag = "Live", caption }: KpiCardProps) {
  return (
    <div className={styles.card}>
      <div className={styles.headerRow}>
        <span className={styles.label}>{label}</span>
        <span className={styles.liveTag}>{tag}</span>
      </div>
      <div className={styles.value}>{value}</div>
      <div className={direction === "up" ? styles.changeUp : styles.changeDown}>
        {change} ({changePercent})
      </div>
      {caption && <div className={styles.caption}>{caption}</div>}
    </div>
  );
}

export function KpiCardGrid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
