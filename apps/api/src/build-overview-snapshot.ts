/** Assembles a real OverviewSnapshot.
 *
 * - session is genuinely computed from PostgreSQL (see market-calendar.ts).
 * - prices is genuinely fetched from NSE's own published index-close
 *   archives (see nse-bhavcopy.ts) for the last completed trading day. This
 *   is real official data with no broker credentials involved -- but it is
 *   end-of-day only, never a live tick, and the panel says so via priceBasis.
 * - pnl and holdings are read through whichever broker(s) have an
 *   unexpired step-2 session (broker_sessions), combined across brokers
 *   when more than one is connected. With no session for either broker,
 *   they stay honestly "unavailable" -- NSE's public archives have no
 *   concept of an individual account, so only a real broker session can
 *   fill these. If one broker succeeds and another fails, the panel is
 *   "degraded", not silently narrowed to "available" -- see
 *   buildPortfolioPanels.
 * - deployment stays unavailable regardless of broker sessions: it
 *   describes a strategy/worker engine, which does not exist in this
 *   project at all yet -- a broker session cannot supply it.
 * - connections and activity stay unavailable: they describe live
 *   streaming feed status and an audit-event log, neither of which is
 *   wired up yet (broker sessions here are used for on-demand portfolio
 *   reads, not a persistent stream).
 *
 * Deliberately split into two phases so a broker/NSE network call is never
 * made while holding a PostgreSQL transaction open: loadOverviewInputs does
 * only PostgreSQL reads plus in-memory decryption (fast, no network);
 * buildOverviewSnapshot does the actual NSE/broker network calls, after
 * that transaction has already committed and released its connection back
 * to the (5-connection) pool. See routes/overview.ts's caller.
 */
import type { OverviewSnapshot, Scope, HoldingsData, PnlData } from "@nraialgo/contracts";
import type { Query } from "./database.js";
import type { credentialVault } from "./credential-vault.js";
import { resolveSessionState } from "./market-calendar.js";
import { fetchNseIndexCloses } from "./nse-bhavcopy.js";
import { fetchZerodhaPortfolio } from "./broker-auth/zerodha-portfolio.js";
import { fetchKotakPortfolio } from "./broker-auth/kotak-portfolio.js";
import { ZerodhaSessionSchema } from "./broker-auth/zerodha.js";
import { KotakSessionSchema } from "./broker-auth/kotak.js";
import { z } from "zod";

const NO_SESSION: [string, string] = ["none", "NO_AUTHORIZED_BROKER_SESSION"];

const ZerodhaAppCredentialsSchema = z.object({ apiKey: z.string().min(1), apiSecret: z.string().min(1) });
const KotakAppCredentialsSchema = z.object({
  accessToken: z.string().min(1),
  mobileNumber: z.string().min(1),
  ucc: z.string().min(1),
});

function unavailablePanel(source: string, reason: string) {
  return {
    status: "unavailable" as const,
    source,
    asOf: null,
    version: 0,
    data: null,
    reason,
  };
}

/** Real adapters by default; a test passes fixtures/mocks here instead so
 * the normal suite never makes a real NSE/Zerodha/Kotak network call --
 * only an explicitly opt-in smoke test should exercise the real ones. */
export interface SnapshotDeps {
  fetchNseIndexCloses: typeof fetchNseIndexCloses;
  fetchZerodhaPortfolio: typeof fetchZerodhaPortfolio;
  fetchKotakPortfolio: typeof fetchKotakPortfolio;
}
const REAL_DEPS: SnapshotDeps = { fetchNseIndexCloses, fetchZerodhaPortfolio, fetchKotakPortfolio };

async function buildPricesPanel(
  session: OverviewSnapshot["session"],
  nowIso: string,
  deps: SnapshotDeps,
): Promise<OverviewSnapshot["prices"]> {
  const lastCompletedSession = session.status === "available" ? session.data.lastCompletedSession : null;
  if (!lastCompletedSession) {
    return unavailablePanel("nse-bhavcopy", "NO_COMPLETED_SESSION_ON_CALENDAR");
  }
  try {
    const quotes = await deps.fetchNseIndexCloses(lastCompletedSession);
    return { status: "available", source: "nse-bhavcopy", asOf: nowIso, version: 1, reason: null, data: quotes };
  } catch (caught) {
    return unavailablePanel(
      "nse-bhavcopy",
      caught instanceof Error ? caught.message : `NSE bhavcopy fetch failed for ${lastCompletedSession}`,
    );
  }
}

function combineHoldings(parts: HoldingsData[]): HoldingsData {
  return {
    holdings: parts.flatMap((part) => part.holdings),
    collateralPaise: parts.reduce((sum, part) => sum + part.collateralPaise, 0),
    usedMarginPaise: parts.reduce((sum, part) => sum + part.usedMarginPaise, 0),
    availableMarginPaise: parts.reduce((sum, part) => sum + part.availableMarginPaise, 0),
    accountAsOf: parts[0]!.accountAsOf,
    valuationAsOf: parts[0]!.valuationAsOf,
  };
}

/** chargesPaise/netPaise/baseCapital are unknown (null) for every provider
 * today (see the portfolio adapters), so the combined total is unknown too
 * whenever any part is -- summing null as if it were 0 would fabricate a
 * reconciled figure no provider actually computed. */
function combinePnl(parts: PnlData[]): PnlData {
  const realisedPaise = parts.reduce((sum, part) => sum + part.realisedPaise, 0);
  const unrealisedPaise = parts.reduce((sum, part) => sum + part.unrealisedPaise, 0);
  const grossPaise = parts.reduce((sum, part) => sum + part.grossPaise, 0);
  const anyChargesUnknown = parts.some((part) => part.chargesPaise === null);
  const chargesPaise = anyChargesUnknown ? null : parts.reduce((sum, part) => sum + (part.chargesPaise ?? 0), 0);
  const anyBaseCapitalUnknown = parts.some((part) => part.baseCapital.amountPaise === null);
  return {
    period: "session",
    currency: "INR",
    baseCapital: {
      context: parts[0]!.baseCapital.context,
      amountPaise: anyBaseCapitalUnknown
        ? null
        : parts.reduce((sum, part) => sum + (part.baseCapital.amountPaise ?? 0), 0),
    },
    realisedPaise,
    unrealisedPaise,
    grossPaise,
    chargesPaise,
    netPaise: chargesPaise === null ? null : grossPaise - chargesPaise,
    valuationAsOf: parts[0]!.valuationAsOf,
    reconciliationStatus: "provisional",
  };
}

async function loadDecrypted<T>(
  query: Query,
  vault: ReturnType<typeof credentialVault>,
  table: "broker_sessions" | "broker_app_credentials",
  context: string,
  workspaceId: string,
  provider: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const whereExpiry = table === "broker_sessions" ? " AND expires_at > now()" : "";
  const [row] = await query<{ ciphertext: string }>(
    `SELECT ciphertext FROM ${table} WHERE workspace_id=$1 AND provider=$2${whereExpiry}`,
    [workspaceId, provider],
  );
  if (!row) {
    return null;
  }
  // Parsed, not cast: a vault key/algorithm change or a partially-written
  // row would otherwise surface as a TypeScript-typed value that silently
  // isn't one at runtime. A malformed record is treated as no session at
  // all (fails closed) rather than crashing the whole snapshot.
  const result = schema.safeParse(vault.open(context, row.ciphertext));
  return result.success ? result.data : null;
}

export interface ZerodhaInputs {
  apiKey: string;
  accessToken: string;
  accountId: string;
}
export interface KotakInputs {
  session: z.infer<typeof KotakSessionSchema>;
  accountId: string;
}
export interface OverviewInputs {
  session: OverviewSnapshot["session"];
  zerodha: ZerodhaInputs | null;
  kotak: KotakInputs | null;
}

/** PostgreSQL-only phase: session/calendar reads plus decrypting whatever
 * credentials/sessions already exist. No network call happens in here, so
 * this can safely run inside a short-lived transaction. */
export async function loadOverviewInputs(
  query: Query,
  vault: ReturnType<typeof credentialVault>,
  scope: Scope,
  now: Date,
): Promise<OverviewInputs> {
  const nowIso = now.toISOString();

  // resolveSessionState always returns a valid SessionData -- "unknown" is a
  // real data value (an unseeded calendar day), not an absence of data. Only
  // a genuine failure to reach the calendar makes this panel itself unavailable.
  let session: OverviewSnapshot["session"];
  try {
    const data = await resolveSessionState(query, now, scope.exchange, scope.segment);
    session = { status: "available", source: "market-calendar", asOf: nowIso, version: 1, data, reason: null };
  } catch {
    session = unavailablePanel("market-calendar", "CALENDAR_SERVICE_UNAVAILABLE");
  }

  const zerodhaSession = await loadDecrypted(
    query,
    vault,
    "broker_sessions",
    `${scope.workspaceId}:zerodha:session`,
    scope.workspaceId,
    "zerodha",
    ZerodhaSessionSchema,
  );
  let zerodha: ZerodhaInputs | null = null;
  if (zerodhaSession) {
    const credentials = await loadDecrypted(
      query,
      vault,
      "broker_app_credentials",
      `${scope.workspaceId}:zerodha`,
      scope.workspaceId,
      "zerodha",
      ZerodhaAppCredentialsSchema,
    );
    if (credentials) {
      zerodha = { apiKey: credentials.apiKey, accessToken: zerodhaSession.accessToken, accountId: zerodhaSession.userId };
    }
  }

  const kotakSession = await loadDecrypted(
    query,
    vault,
    "broker_sessions",
    `${scope.workspaceId}:kotak:session`,
    scope.workspaceId,
    "kotak",
    KotakSessionSchema,
  );
  let kotak: KotakInputs | null = null;
  if (kotakSession) {
    const credentials = await loadDecrypted(
      query,
      vault,
      "broker_app_credentials",
      `${scope.workspaceId}:kotak`,
      scope.workspaceId,
      "kotak",
      KotakAppCredentialsSchema,
    );
    if (credentials) {
      kotak = { session: kotakSession, accountId: credentials.ucc };
    }
  }

  return { session, zerodha, kotak };
}

async function buildPortfolioPanels(
  inputs: OverviewInputs,
  scope: Scope,
  now: Date,
  deps: SnapshotDeps,
): Promise<{ pnl: OverviewSnapshot["pnl"]; holdings: OverviewSnapshot["holdings"]; connectedProviders: string[] }> {
  const holdingsParts: HoldingsData[] = [];
  const pnlParts: PnlData[] = [];
  const connectedProviders: string[] = [];
  const attemptedProviders: string[] = [];
  const errors: string[] = [];

  if (inputs.zerodha) {
    attemptedProviders.push("zerodha");
    try {
      const portfolio = await deps.fetchZerodhaPortfolio(
        inputs.zerodha.apiKey,
        inputs.zerodha.accessToken,
        scope.context,
        now,
        inputs.zerodha.accountId,
      );
      holdingsParts.push(portfolio.holdings);
      pnlParts.push(portfolio.pnl);
      connectedProviders.push("zerodha");
    } catch (caught) {
      errors.push(`Zerodha: ${caught instanceof Error ? caught.message : "portfolio read failed"}`);
    }
  }

  if (inputs.kotak) {
    attemptedProviders.push("kotak");
    try {
      const portfolio = await deps.fetchKotakPortfolio(inputs.kotak.session, scope.context, now, inputs.kotak.accountId);
      holdingsParts.push(portfolio.holdings);
      pnlParts.push(portfolio.pnl);
      connectedProviders.push("kotak");
    } catch (caught) {
      errors.push(`Kotak: ${caught instanceof Error ? caught.message : "portfolio read failed"}`);
    }
  }

  const nowIso = now.toISOString();
  if (!holdingsParts.length) {
    const [source, defaultReason] = NO_SESSION;
    const reason = errors.length ? errors.join("; ") : defaultReason;
    return {
      pnl: unavailablePanel(source, reason),
      holdings: unavailablePanel(source, reason),
      connectedProviders,
    };
  }

  const source = connectedProviders.join("+");
  // A provider we attempted but that failed is a partial result, not a
  // clean one: the combined totals only reflect the providers that
  // actually succeeded, and that gap must be stated, never dropped.
  const isPartial = attemptedProviders.length > connectedProviders.length;
  const reason = isPartial ? `${errors.join("; ")}; totals include only ${connectedProviders.join(" and ")}` : null;

  return {
    pnl: isPartial
      ? { status: "degraded" as const, source, asOf: nowIso, version: 1, reason: reason!, data: combinePnl(pnlParts) }
      : { status: "available" as const, source, asOf: nowIso, version: 1, reason: null, data: combinePnl(pnlParts) },
    holdings: isPartial
      ? {
          status: "degraded" as const,
          source,
          asOf: nowIso,
          version: 1,
          reason: reason!,
          data: combineHoldings(holdingsParts),
        }
      : {
          status: "available" as const,
          source,
          asOf: nowIso,
          version: 1,
          reason: null,
          data: combineHoldings(holdingsParts),
        },
    connectedProviders,
  };
}

/** Network phase: NSE + broker calls, using inputs already read from
 * PostgreSQL by loadOverviewInputs. No PostgreSQL transaction is open while
 * this runs. */
export async function buildOverviewSnapshot(
  inputs: OverviewInputs,
  now: Date,
  scope: Scope,
  deps: SnapshotDeps = REAL_DEPS,
): Promise<OverviewSnapshot> {
  const nowIso = now.toISOString();

  const prices = await buildPricesPanel(inputs.session, nowIso, deps);
  const { pnl, holdings, connectedProviders } = await buildPortfolioPanels(inputs, scope, now, deps);
  const hasBrokerSession = connectedProviders.length > 0;

  return {
    schemaVersion: 1,
    snapshotId: `snap-${now.getTime()}`,
    serverTime: nowIso,
    generatedAt: nowIso,
    scope,
    calendarVersion: "v1",
    sourceWatermarks: { accountVersion: 0, eventCursor: "none" },
    session: inputs.session,
    prices,
    pnl,
    holdings,
    // No strategy/worker engine exists in this project -- a broker session
    // reads portfolio data on demand, it does not run or supervise anything.
    deployment: unavailablePanel("none", "NO_STRATEGY_ENGINE"),
    readiness: {
      status: "available",
      source: "readiness-service",
      asOf: nowIso,
      version: 1,
      reason: null,
      data: {
        checks: {
          totp: { status: "unknown", reason: "No authenticated user session yet" },
          priceFeed: { status: "unknown", reason: "Only EOD reference prices available; no live feed" },
          brokerSessions: hasBrokerSession
            ? { status: "passed", reason: null }
            : { status: "unknown", reason: NO_SESSION[1] },
          riskLimits: { status: "unknown", reason: "NO_RISK_LIMIT_CONFIGURED" },
        },
        liveTradeEligible: false,
      },
    },
    // Streaming-feed status and an audit-event log are separate features
    // from on-demand portfolio reads and are not wired up yet.
    connections: unavailablePanel("none", "NO_LIVE_STREAM_CONFIGURED"),
    activity: unavailablePanel("none", "NO_AUDIT_LOG_CONFIGURED"),
  };
}
