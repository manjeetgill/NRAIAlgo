"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { formatTimeOnly } from "./format-clock";
import { NAV_GROUPS, type NavItem } from "./nav-items";
import { MOCK_INDEX_TICKER } from "./shell-data";
import styles from "./shell.module.css";
import { useClock } from "./use-clock";

export interface ShellProps {
  children: ReactNode;
  /**
   * Optional fourth header bar. Only the dev playground passes one (its
   * market-state switcher) -- the production shell renders nothing
   * here, since the spec is explicit that a state switcher must never
   * ship wired into a production build.
   */
  extraHeaderBar?: ReactNode;
  /** Signed-in user's email; omitted by the dev playground (no auth gate
   * there), in which case the account area falls back to its old
   * unauthenticated presentation rather than claiming a real session. */
  email?: string | null;
  onSignOut?: () => void;
}

/**
 * Persistent app shell: execution-mode strip, clocks/ticker/account
 * bar, sidebar navigation, wrapping every /app/* screen. Visual
 * structure matches the approved "Institutional Pro" design system in
 * detail (colors, density, grouping) -- see nav-items.ts for why its
 * group labels differ from the written spec's.
 *
 * Every value here is presentation only and, for now, fixed to Paper
 * mode: there is no real trading backend, so the execution strip, the
 * "Switch to Live" control, and the account badge cannot honestly
 * claim anything else. The reference design shows a working Live/Paper
 * toggle with a red Live banner; this shell deliberately does not
 * implement that toggle, since flipping it would be presentation
 * claiming a capability (live capital risk) that doesn't exist yet.
 *
 * Nav items whose route doesn't exist yet render as inert "Planned"
 * placeholders instead of real links -- clicking a nav item should
 * never 404.
 */
export function Shell({ children, extraHeaderBar, email, onSignOut }: ShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const nowMs = useClock();

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawerOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  const istLabel = nowMs === 0 ? "--:--:--" : formatTimeOnly(new Date(nowMs), "Asia/Kolkata");
  const estLabel = nowMs === 0 ? "--:--:--" : formatTimeOnly(new Date(nowMs), "America/New_York");
  const gstLabel = nowMs === 0 ? "--:--:--" : formatTimeOnly(new Date(nowMs), "Asia/Dubai");

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>

      <div className={styles.executionStrip} role="status">
        <div className={styles.stripLabel}>
          <span className={styles.stripDot} aria-hidden="true" />
          <span className={styles.stripText}>
            Paper mode: orders are simulated, real money is not at risk.
          </span>
        </div>
        <div className={styles.stripRight}>
          <div className={styles.stripPings}>
            <span>Zerodha: --</span>
            <span>&middot;</span>
            <span>Kotak Neo: --</span>
          </div>
          <button type="button" className={styles.modeButton} disabled title="Not wired yet">
            <span className={`material-symbols-outlined ${styles.navIcon}`} aria-hidden="true">
              swap_horiz
            </span>
            Switch to live (locked)
          </button>
        </div>
      </div>

      <div className={styles.metricsBar}>
        <div className={styles.clockGroup}>
          <button
            type="button"
            className={styles.drawerToggle}
            aria-label={drawerOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((open) => !open)}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              menu
            </span>
          </button>

          <div className={styles.istClock}>
            <span className={styles.liveDot} aria-hidden="true" />
            <span className={styles.clockValue}>IST {istLabel}</span>
          </div>

          <div className={styles.secondaryClocks}>
            <span>EST {estLabel}</span>
            <span>/</span>
            <span>GST {gstLabel}</span>
          </div>

          <div className={styles.ticker}>
            {MOCK_INDEX_TICKER.map((item) => (
              <span key={item.label} className={styles.tickerItem}>
                <span className={styles.tickerLabel}>{item.label}</span>
                <span className={styles.tickerValue}>{item.value}</span>
                <span className={item.direction === "up" ? styles.tickerUp : styles.tickerDown}>
                  {item.changePercent}
                </span>
              </span>
            ))}
          </div>
        </div>

        <div className={styles.accountArea}>
          <div className={styles.accountBadgeStack}>
            <span className={styles.accountBadge}>{email ?? "Not signed in"}</span>
            {email && onSignOut ? (
              <button type="button" className={styles.accountSub} onClick={onSignOut}>
                Sign out
              </button>
            ) : (
              <span className={styles.accountSub}>No active session</span>
            )}
          </div>
          <span className={styles.avatar} aria-hidden="true">
            <span className="material-symbols-outlined" aria-label="Account">
              person
            </span>
          </span>
        </div>
      </div>

      {extraHeaderBar}

      <div className={styles.body}>
        {drawerOpen && (
          <button
            type="button"
            aria-label="Dismiss navigation overlay"
            className={styles.backdropOpen}
            onClick={() => setDrawerOpen(false)}
          />
        )}

        <nav
          className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`}
          aria-label="Primary"
        >
          <div className={styles.sidebarTop}>
            <div className={styles.logoHeader}>
              <span className={styles.brandMark} aria-hidden="true">
                N
              </span>
              <div>
                <div className={styles.brandName}>NRAIAlgo</div>
                <div className={styles.brandSubtitle}>Institutional Pro</div>
              </div>
            </div>

            <div className={styles.safetyPill}>
              <span className={styles.safetyLabel}>Session Safety</span>
              <span className={styles.safetyValue}>Not connected</span>
            </div>

            <div className={styles.nav}>
              {NAV_GROUPS.map((group) => (
                <div key={group.label} className={styles.navGroup}>
                  <div className={styles.navGroupLabel}>{group.label}</div>
                  <ul className={styles.navList}>
                    {group.items.map((item) => (
                      <li key={item.href}>
                        <NavLink
                          item={item}
                          active={pathname === item.href}
                          onNavigate={() => setDrawerOpen(false)}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.killswitchArea}>
            <div className={styles.riskCapRow}>
              <span>Session Risk Cap</span>
              <span className={styles.riskCapValue}>Not set</span>
            </div>
            <button type="button" className={styles.haltButton} disabled title="Not wired yet">
              <span className="material-symbols-outlined" aria-hidden="true">
                warning
              </span>
              Halt all trading
            </button>
          </div>
        </nav>

        <main id="main-content" className={styles.main}>
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  if (!item.built) {
    return (
      <span className={styles.navPlaceholder}>
        <span className={styles.navPlaceholderLabel}>
          <span className={`material-symbols-outlined ${styles.navIcon}`} aria-hidden="true">
            {item.icon}
          </span>
          {item.label}
        </span>
        <span className={styles.plannedTag}>Planned</span>
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`}
      onClick={onNavigate}
    >
      <span className={`material-symbols-outlined ${styles.navIcon}`} aria-hidden="true">
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}
