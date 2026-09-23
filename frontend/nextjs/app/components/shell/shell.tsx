"use client";

import { BrokerHealth } from "@/app/app/overview/broker-health";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { formatTimeOnly } from "./format-clock";
import { NAV_GROUPS, type NavItem } from "./nav-items";
import { ShellOverviewContext, type ShellOverview } from "./overview-context";
import styles from "./shell.module.css";
import { useClock } from "./use-clock";
import { ThemeToggle } from "./theme-toggle";
import { AlphaWire } from "./alpha-wire";
import { printEodReport } from "@/app/app/overview/export-client";

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
 * Account context and readiness come from the overview read model.
 * A live account view does not authorize execution; mode switching and
 * execution commands stay disabled until the command service is connected.
 *
 * Nav items whose route doesn't exist yet render as inert "Planned"
 * placeholders instead of real links -- clicking a nav item should
 * never 404.
 */
export function Shell({ children, extraHeaderBar, email, onSignOut }: ShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [{ snapshot, stale }, setOverview] = useState<ShellOverview>({ snapshot: null, stale: false });
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

  const isLive = snapshot?.scope.context === "LIVE";
  const safety = snapshot?.readiness.data;
  const passed = safety ? Object.values(safety.checks).filter((check) => check.status === "passed").length : 0;
  const closedOverview = pathname === "/app/overview" && snapshot?.session.data?.calendarValid && (snapshot.session.data.state === "after-close" || snapshot.session.data.state === "weekend-holiday");
  const officialCloses = snapshot?.prices.data ?? [];
  const bhavcopyMatched = snapshot?.prices.status === "available" && officialCloses.length > 0 && officialCloses.every(quote => quote.priceBasis === "official-close");
  const reauthProvider = snapshot?.configuredProviders?.find(provider => !snapshot.authorizedProviders?.includes(provider));
  const providerName = reauthProvider ? ({ zerodha: "Zerodha", kotak: "Kotak", icici: "ICICI" }[reauthProvider] ?? reauthProvider) : null;
  return (
    <ShellOverviewContext.Provider value={setOverview}>
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skipLink}>
        Skip to content
      </a>

      {closedOverview && <header className={styles.closedShellHeader}>
        <div className={styles.closedBrand}><span className="material-symbols-outlined" aria-hidden="true">monitoring</span><strong>NRAIAlgo</strong></div>
        <div className={styles.closedTerminalTitle}>NRAIAlgo<br/>Terminal</div>
        <div className={styles.closedSessionBadge}><strong>IST {istLabel}</strong><span>Market closed · post-market reconciliation</span></div>
        <div className={styles.closedClocks}>IST {istLabel}<span>|</span> GST {gstLabel}<span>|</span> NY {estLabel}</div>
        <div className={styles.closedHeaderActions}>
          <button type="button" onClick={printEodReport} title="Open the browser print dialog to save this dashboard as PDF"><span className="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>Export EOD PDF</button>
          <span className={bhavcopyMatched ? styles.reconciledBadge : styles.pendingBadge}><span className="material-symbols-outlined" aria-hidden="true">{bhavcopyMatched ? "done_all" : "schedule"}</span>{bhavcopyMatched ? "Bhavcopy matched" : "Bhavcopy pending"}</span>
          <Link className={styles.reauthAction} href={`/app/broker-connections${reauthProvider ? `#${reauthProvider}` : ""}`}><span className="material-symbols-outlined" aria-hidden="true">refresh</span>{providerName ? `Re-auth ${providerName}` : "Broker gateways"}</Link>
        </div>
        <details className={`${styles.accountMenu} ${styles.closedAccountMenu}`}><summary title={email ?? "Account"}><span className="material-symbols-outlined" aria-label="Account">person</span></summary><div><strong>{email ?? "Not signed in"}</strong><Link href="/app/broker-connections">Account settings &amp; broker connections</Link><ThemeToggle />{email && onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}</div></details>
      </header>}

      {!closedOverview && <div className={`${styles.executionStrip} ${isLive ? styles.liveStrip : ""}`} role="status">
        <div className={styles.stripLabel}>
          <span className={styles.stripDot} aria-hidden="true" />
          <span className={styles.stripText}>
            {stale ? "Connection interrupted · showing last received account data" : isLive ? "Latest broker snapshot · read-only workspace" : snapshot ? "Preview account view · execution controls unavailable" : "Account monitoring · awaiting verified session data"}
          </span>
        </div>
        <div className={styles.stripRight}>
          <BrokerHealth snapshot={snapshot} stale={stale} compact />
          <button type="button" className={styles.modeButton} disabled title="Not wired yet">
            <span className={`material-symbols-outlined ${styles.navIcon}`} aria-hidden="true">
              swap_horiz
            </span>
            Execution locked
          </button>
        </div>
      </div>}

      {!closedOverview && <div className={styles.metricsBar}>
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
            <span>NY {estLabel}</span>
            <span>/</span>
            <span>GST {gstLabel}</span>
          </div>

          <div className={styles.ticker}>
            <span className={styles.tickerLabel}>{snapshot?.session.data?.state.replaceAll("-", " ").toUpperCase() ?? "SESSION UNKNOWN"}</span>
          </div>
        </div>

        <div className={styles.accountArea}>
          <details className={styles.accountMenu}><summary title={email ?? "Account"}>{email ?? "Not signed in"}</summary><div><Link href="/app/broker-connections">Account settings & broker connections</Link><ThemeToggle />{email && onSignOut && <button type="button" onClick={onSignOut}>Sign out</button>}</div></details>
          <div className={styles.accountBadgeStack}>

            {!email && <span className={styles.accountSub}>No active session</span>}
          </div>
          <span className={styles.avatar} aria-hidden="true">
            <span className="material-symbols-outlined" aria-label="Account">
              person
            </span>
          </span>
        </div>
      </div>}

      <div className={styles.extraHeaderBar}>{extraHeaderBar}</div>

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
              <span className={styles.safetyValue}>{stale ? "Stale" : safety ? `${passed}/4 passed` : "Unknown"}</span>
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
            <div className={styles.haltButton} title="No order-entry service is enabled">
              <span className="material-symbols-outlined" aria-hidden="true">
                lock
              </span>
              Execution locked
            </div>
          </div>
        </nav>

        <main id="main-content" className={styles.main}>
          {pathname === "/app/overview" && !closedOverview && <AlphaWire enabled={!!email} initiallyCollapsed />}
          {children}
          {pathname !== "/app/overview" && <AlphaWire key={pathname} enabled={!!email} initiallyCollapsed />}
        </main>
      </div>
    </div>
    </ShellOverviewContext.Provider>
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
