/** Reads real portfolio data through an already-authorized Zerodha session
 * (step 2 must have completed first). Uses the official kiteconnect SDK's
 * own getHoldings/getPositions/getMargins -- same calls AlgoTrade's
 * zerodha-connection.ts makes.
 */
import { KiteConnect, type Connect } from "kiteconnect";
import { PositionRowSchema, type PositionRow, type HoldingsData, type PnlData } from "@nraialgo/contracts";

export type PortfolioClient = Pick<Connect, "setAccessToken" | "getHoldings" | "getPositions" | "getMargins">;

export interface ZerodhaPortfolio {
  holdings: HoldingsData;
  pnl: PnlData;
  positions?: PositionRow[];
}

const rupeesToPaise = (rupees: number) => Math.round(rupees * 100);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

export async function fetchZerodhaPortfolio(
  apiKey: string,
  accessToken: string,
  context: "LIVE" | "PAPER",
  now: Date,
  /** Zerodha's own Kite user id (from the session, not client input) --
   * real account identity, kept on every holding row so a combined
   * multi-broker list never collapses two brokers' "RELIANCE" into one key. */
  accountId: string,
  factory: (apiKey: string) => PortfolioClient = (key) => new KiteConnect({ api_key: key }),
  timeoutMs = 8000,
): Promise<ZerodhaPortfolio> {
  const client = factory(apiKey);
  client.setAccessToken(accessToken);
  const [holdingsRaw, positions, margins] = await withTimeout(
    Promise.all([client.getHoldings(), client.getPositions(), client.getMargins()]),
    timeoutMs,
    "Zerodha portfolio read",
  );

  const holdings = holdingsRaw.map((holding) => ({
    provider: "zerodha",
    accountId,
    symbol: holding.tradingsymbol,
    // Pledged shares remain owned but are excluded from Kite's free quantity.
    // Report total owned units; pledgedQuantity identifies the pledged subset.
    quantity: holding.quantity + (holding.collateral_quantity ?? 0),
    pledgedQuantity: holding.collateral_quantity ?? null,
    marketValuePaise: rupeesToPaise(holding.last_price * (holding.quantity + (holding.collateral_quantity ?? 0))),
  }));

  const equity = margins.equity;
  if (!equity) throw new Error("Zerodha equity margin data unavailable");
  const availableMarginPaise = rupeesToPaise(equity.net);
  const usedMarginPaise = rupeesToPaise(equity.utilised.debits);
  const collateralPaise = rupeesToPaise(equity.available.collateral);

  const realisedPaise = positions.net.reduce((sum, position) => sum + rupeesToPaise(position.realised), 0);
  const unrealisedPaise = positions.net.reduce((sum, position) => sum + rupeesToPaise(position.unrealised), 0);
  const grossPaise = realisedPaise + unrealisedPaise;
  // Kite's holdings/positions/margins calls carry no per-trade charges
  // breakdown -- charges/net are unknown (null), never a fabricated 0/gross,
  // until a real source (contract note / ledger read) exists for them.
  const chargesPaise = null;
  const netPaise = null;
  // Receipt time, not the request-start time: tick projection must never
  // apply a quote that predates the position baseline we just received.
  const nowIso = new Date(Math.max(now.getTime(), Date.now())).toISOString();

  return {
    positions: positions.net.filter((position) => position.quantity !== 0).map((position) => PositionRowSchema.parse({
      provider: "zerodha", accountId, instrumentToken: position.instrument_token,
      exchange: position.exchange, symbol: position.tradingsymbol, product: position.product,
      quantity: position.quantity, multiplier: position.multiplier, averagePrice: position.average_price,
      lastPrice: position.last_price, pnlPaise: rupeesToPaise(position.realised + position.unrealised),
      asOf: nowIso, fresh: false,
    })),
    holdings: {
      holdings,
      collateralPaise,
      usedMarginPaise,
      availableMarginPaise,
      accountAsOf: nowIso,
      valuationAsOf: nowIso,
      brokerBalances: [{ provider: "zerodha", accountId, availableMarginPaise, usedMarginPaise, collateralPaise, asOf: nowIso }],
    },
    pnl: {
      period: "session",
      currency: "INR",
      // No strategy/deployment capital-configuration feature exists yet --
      // available margin is a different concept and must not stand in for
      // it, so this stays null (unknown) rather than fabricated.
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
