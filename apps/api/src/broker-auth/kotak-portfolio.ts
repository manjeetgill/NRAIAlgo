/** Reads real portfolio data through an already-authorized Kotak Neo session
 * (step 2 must have completed first). Uses the same three endpoints
 * AlgoTrade's kotak-market-data-client.ts calls: holdings, positions and
 * limits (funds/margin), with the same Auth/Sid session headers.
 */
import type { HoldingsData, PnlData } from "@nraialgo/contracts";
import type { KotakSession } from "./kotak.js";

const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

/** A required financial field: missing or non-numeric means this whole
 * provider result cannot be trusted, so it throws (caught by the caller and
 * surfaced as a per-provider failure) instead of silently defaulting to 0 --
 * see the review finding that Kotak's numeric() previously converted a
 * missing/malformed field into a fabricated ₹0. */
function requireNumeric(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Kotak response was missing a valid ${field}.`);
  }
  return parsed;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

/** Kotak's portfolio envelope nests rows under data.data in some deployments
 * and data directly in others -- read defensively, but never silently treat
 * a genuinely malformed response as an empty portfolio. */
function extractRows(raw: unknown): Record<string, unknown>[] {
  const envelope = raw as { data?: unknown } | undefined;
  const candidate = Array.isArray(envelope?.data)
    ? envelope.data
    : Array.isArray((envelope?.data as { data?: unknown })?.data)
      ? (envelope!.data as { data: unknown }).data
      : null;
  if (!Array.isArray(candidate)) {
    throw new Error("Kotak portfolio response was not in the expected shape.");
  }
  return candidate as Record<string, unknown>[];
}

async function callKotak(
  fetchImpl: typeof fetch,
  url: string,
  session: KotakSession,
  init: RequestInit = {},
  timeoutMs = 8000,
) {
  const response = await fetchImpl(url, {
    ...init,
    headers: { Auth: session.token, Sid: session.sid, accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Kotak portfolio request failed (HTTP ${response.status})`);
  }
  return response.json();
}

export interface KotakPortfolio {
  holdings: HoldingsData;
  pnl: PnlData;
}

export async function fetchKotakPortfolio(
  session: KotakSession,
  context: "LIVE" | "PAPER",
  now: Date,
  /** Kotak's UCC (from the step-1 saved app credentials, not client input) --
   * real account identity, kept on every holding row so a combined
   * multi-broker list never collapses two brokers' same symbol into one key. */
  accountId: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): Promise<KotakPortfolio> {
  const [holdingsRaw, positionsRaw, limitsRaw] = await Promise.all([
    callKotak(fetchImpl, `${session.baseUrl}/portfolio/v1/holdings`, session, {}, timeoutMs),
    callKotak(fetchImpl, `${session.baseUrl}/quick/user/positions`, session, {}, timeoutMs),
    callKotak(
      fetchImpl,
      `${session.baseUrl}/quick/user/limits`,
      session,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ jData: JSON.stringify({ seg: "ALL", exch: "ALL", prod: "ALL" }) }).toString(),
      },
      timeoutMs,
    ),
  ]);

  const holdings = extractRows(holdingsRaw).map((row) => ({
    provider: "kotak",
    accountId,
    symbol: text(row.displaySymbol || row.symbol),
    quantity: requireNumeric(row.quantity, "holding quantity"),
    pledgedQuantity: row.pledgedQuantity !== undefined ? requireNumeric(row.pledgedQuantity, "pledged quantity") : null,
    marketValuePaise: rupeesToPaise(
      requireNumeric(row.quantity, "holding quantity") *
        requireNumeric(row.closingPrice ?? row.ltp, "holding price"),
    ),
  }));

  const positions = extractRows(positionsRaw);
  const realisedPaise = positions.reduce(
    (sum, row) => sum + rupeesToPaise(requireNumeric(row.realizedPL ?? row.rpnl, "realized P&L")),
    0,
  );
  const unrealisedPaise = positions.reduce(
    (sum, row) => sum + rupeesToPaise(requireNumeric(row.unrealizedPL ?? row.urpnl, "unrealized P&L")),
    0,
  );
  const grossPaise = realisedPaise + unrealisedPaise;
  // Kotak's limits/positions calls carry no per-trade charges breakdown --
  // unknown (null), never a fabricated 0/gross, until a real source exists.
  const chargesPaise = null;
  const netPaise = null;

  const limits = (limitsRaw as { data?: Record<string, unknown> })?.data ?? {};
  const availableMarginPaise = rupeesToPaise(requireNumeric(limits.Net, "available margin (Net)"));
  const usedMarginPaise = rupeesToPaise(requireNumeric(limits.MarginUsed, "used margin (MarginUsed)"));
  const collateralPaise = rupeesToPaise(requireNumeric(limits.CollateralValue, "collateral (CollateralValue)"));
  const nowIso = now.toISOString();

  return {
    holdings: {
      holdings,
      collateralPaise,
      usedMarginPaise,
      availableMarginPaise,
      accountAsOf: nowIso,
      valuationAsOf: nowIso,
    },
    pnl: {
      period: "session",
      currency: "INR",
      // See zerodha-portfolio.ts: no strategy/deployment capital-configuration
      // feature exists yet -- available margin is a different concept and
      // must not stand in for it, so this stays null (unknown).
      baseCapital: { context: context === "LIVE" ? "live" : "paper", amountPaise: null },
      realisedPaise,
      unrealisedPaise,
      grossPaise,
      chargesPaise,
      netPaise,
      valuationAsOf: nowIso,
      reconciliationStatus: "provisional",
    },
  };
}
