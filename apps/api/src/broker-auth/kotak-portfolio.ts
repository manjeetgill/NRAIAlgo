/** Reads real portfolio data through an already-authorized Kotak Neo session
 * (step 2 must have completed first). Production reads use the official
 * Python SDK bridge. The injectable HTTP seam is retained for existing
 * response-normalization tests only; there is no runtime HTTP fallback.
 */
import { PositionRowSchema, type PositionRow, type HoldingsData, type PnlData } from "@nraialgo/contracts";
import type { KotakSession } from "./kotak.js";
import { kotakSdkRequest } from "./kotak-sdk.js";
import { z } from "zod";

const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

/** A required financial field: missing or non-numeric means this whole
 * provider result cannot be trusted, so it throws (caught by the caller and
 * surfaced as a per-provider failure) instead of silently defaulting to 0 --
 * see the review finding that Kotak's numeric() previously converted a
 * missing/malformed field into a fabricated ₹0. */
function requireNumeric(value: unknown, field: string): number {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) throw new Error(`Kotak response was missing a valid ${field}.`);
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
  positions?: PositionRow[];
}

export async function fetchKotakPortfolio(
  session: KotakSession,
  context: "LIVE" | "PAPER",
  now: Date,
  /** Kotak's UCC (from the step-1 saved app credentials, not client input) --
   * real account identity, kept on every holding row so a combined
   * multi-broker list never collapses two brokers' same symbol into one key. */
  accountId: string,
  fetchImpl: typeof fetch | undefined = undefined,
  timeoutMs = 8000,
  appAccessToken?: string,
): Promise<KotakPortfolio> {
  // Production uses the official Python SDK. Injected HTTP readers are only
  // a compatibility seam for normalization tests, never an automatic fallback.
  const sdk = fetchImpl ? null : z.object({holdings:z.unknown(),positions:z.unknown(),limits:z.unknown(),quotes:z.array(z.unknown())}).parse(await kotakSdkRequest('portfolio',{session,accountId,appAccessToken}));
  const [holdingsRaw, positionsRaw, limitsRaw] = sdk ? [sdk.holdings,sdk.positions,sdk.limits] : await Promise.all([
    callKotak(fetchImpl!, `${session.baseUrl}/portfolio/v1/holdings`, session, {}, timeoutMs),
    callKotak(fetchImpl!, `${session.baseUrl}/quick/user/positions`, session, {}, timeoutMs),
    callKotak(
      fetchImpl!,
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

  // Neo's portfolio endpoint also returns derivatives (including short options).
  // These are accounted for by the positions endpoint, never demat holdings.
  const holdings = extractRows(holdingsRaw).filter((row) => {
    const segment = text(row.exchangeSegment).toLowerCase();
    const type = text(row.instrumentType).toLowerCase();
    return !/(?:_fo|_cd|_co|_com)$/.test(segment) && !/option|future|derivative/.test(type);
  }).map((row) => {
    const quantity = requireNumeric(row.quantity, "holding quantity");
    const price = requireNumeric(row.closingPrice ?? row.ltp, "holding price");
    if (quantity < 0 || price < 0) throw new Error("Kotak demat holding has a negative quantity or price");
    return {
    provider: "kotak",
    accountId,
    symbol: text(row.displaySymbol || row.symbol),
    quantity,
    pledgedQuantity: row.pledgedQuantity !== undefined ? requireNumeric(row.pledgedQuantity, "pledged quantity") : null,
    marketValuePaise: rupeesToPaise(quantity * price),
  };
  });

  const positions = extractRows(positionsRaw);
  const limitsEnvelope = limitsRaw as { data?: Record<string, unknown> };
  const limits = limitsEnvelope.data ?? limitsRaw as Record<string, unknown>;
  const nativePositions = positions.length > 0 && positions.every(row => row.cfBuyQty !== undefined);
  const quotes = new Map<string, number>();
  if (nativePositions) {
    const symbols = positions.filter(row => requireNumeric(row.cfBuyQty, "carry buy quantity") + requireNumeric(row.flBuyQty, "buy quantity") !== requireNumeric(row.cfSellQty, "carry sell quantity") + requireNumeric(row.flSellQty, "sell quantity")).map(row => `${text(row.exSeg)}|${text(row.tok)}`);
    if (symbols.length && !appAccessToken) throw new Error("Kotak quote app credential unavailable");
    // Bounded quote batches; these tokens belong to Kotak, never to Kite.
    if(sdk) for(const raw of sdk.quotes){
      const quote=raw as Record<string,unknown>;
      quotes.set(`${text(quote.exchange)}|${text(quote.exchange_token)}`,requireNumeric(quote.ltp,'quote LTP'));
    }
    for (let start = 0; !sdk && start < symbols.length; start += 50) {
      const response = await fetchImpl!(`https://mis.kotaksecurities.com/script-details/1.0/quotes/neosymbol/${encodeURIComponent(symbols.slice(start, start + 50).join(','))}/ltp`, { headers: { Authorization: appAccessToken! }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`Kotak quotes failed (HTTP ${response.status})`);
      const body = await response.json();
      if (!Array.isArray(body)) throw new Error("Kotak quotes response was not an array");
      for (const quote of body) quotes.set(`${text(quote.exchange)}|${text(quote.exchange_token)}`, requireNumeric(quote.ltp, "quote LTP"));
    }
  }
  const nowIso = new Date(Math.max(now.getTime(), Date.now())).toISOString();
  const normalized: PositionRow[] = [];
  let nativeGrossPaise = 0;
  if (nativePositions) for (const row of positions) {
    const n = (key: string) => requireNumeric(row[key], key);
    const buyQty = n("cfBuyQty") + n("flBuyQty");
    const sellQty = n("cfSellQty") + n("flSellQty");
    const quantity = buyQty - sellQty; // Underlying units, not lots (same as Kite).
    const buyAmount = n("cfBuyAmt") + n("buyAmt");
    const sellAmount = n("cfSellAmt") + n("sellAmt");
    const multiplier = n("multiplier") * n("genNum") / n("genDen") * n("prcNum") / n("prcDen");
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw new Error("Invalid Kotak position multiplier");
    const lastPrice = quantity === 0 ? 0 : quotes.get(`${text(row.exSeg)}|${text(row.tok)}`);
    if (lastPrice === undefined || lastPrice < 0) throw new Error("Kotak position quote unavailable");
    const pnlPaise = rupeesToPaise(sellAmount - buyAmount + quantity * lastPrice * multiplier);
    nativeGrossPaise += pnlPaise;
    if (quantity !== 0) normalized.push(PositionRowSchema.parse({
      provider: "kotak", accountId, instrumentToken: n("tok"), exchange: text(row.exSeg), symbol: text(row.trdSym), product: text(row.prod),
      quantity, multiplier, averagePrice: quantity > 0 ? buyAmount / (buyQty * multiplier) : sellAmount / (sellQty * multiplier),
      lastPrice, pnlPaise, asOf: nowIso, fresh: false,
    }));
  }
  const realisedPaise = nativePositions ? rupeesToPaise(requireNumeric(limits.RealizedMtomPrsnt, "realized MTM")) : positions.reduce(
    (sum, row) => sum + rupeesToPaise(requireNumeric(row.realizedPL ?? row.rpnl, "realized P&L")),
    0,
  );
  const unrealisedPaise = nativePositions ? nativeGrossPaise - realisedPaise : positions.reduce(
    (sum, row) => sum + rupeesToPaise(requireNumeric(row.unrealizedPL ?? row.urpnl, "unrealized P&L")),
    0,
  );
  const grossPaise = realisedPaise + unrealisedPaise;
  // Kotak's limits/positions calls carry no per-trade charges breakdown --
  // unknown (null), never a fabricated 0/gross, until a real source exists.
  const chargesPaise = null;
  const netPaise = null;

  const availableMarginPaise = rupeesToPaise(requireNumeric(limits.Net, "available margin (Net)"));
  const usedMarginPaise = rupeesToPaise(requireNumeric(limits.MarginUsed, "used margin (MarginUsed)"));
  const collateralPaise = rupeesToPaise(requireNumeric(limits.CollateralValue, "collateral (CollateralValue)"));

  return {
    ...(nativePositions || positions.length === 0 ? { positions: normalized } : {}),
    holdings: {
      holdings,
      collateralPaise,
      usedMarginPaise,
      availableMarginPaise,
      accountAsOf: nowIso,
      valuationAsOf: nowIso,
      brokerBalances: [{ provider: "kotak", accountId, availableMarginPaise, usedMarginPaise, collateralPaise, asOf: nowIso }],
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
