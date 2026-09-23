import { z } from "zod";
import { calculateDailyMtm, calculateOpenPnl } from "./open-positions";
import type { OpenPositionView } from "./open-positions";
import type { PortfolioRow } from "./portfolio-table";
export const accountSchema = z.object({ accountId: z.string().min(1), asOf: z.string().datetime(), sections: z.record(z.string(), z.object({ status: z.enum(["available", "degraded", "unavailable"]), reason: z.string().optional(), asOf: z.string().datetime().optional(), rows: z.array(z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]))) })) });
export type IciciAccount = z.infer<typeof accountSchema>;
type DataRow = IciciAccount["sections"][string]["rows"][number];
function number(value: DataRow[string] | undefined): number | null {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function paise(value: DataRow[string] | undefined): number | null {
  const parsed = number(value);
  return parsed !== null && Number.isSafeInteger(Math.round(parsed * 100)) ? Math.round(parsed * 100) : null;
}
export function iciciPositions(rows: DataRow[], account: string, asOf: string): OpenPositionView[] {
  return rows.filter(row => number(row.quantity) !== 0).map((row, index) => {
    const quantity = number(row.quantity);
    const side = String(row.action).toLowerCase() === "buy" ? "BUY" : String(row.action).toLowerCase() === "sell" ? "SELL" : null;
    const signedQuantity = quantity === null ? null : side === "SELL" ? -Math.abs(quantity) : side === "BUY" ? Math.abs(quantity) : quantity;
    const average = number(row.average_price);
    const ltp = number(row.ltp);
    const previousClose = number(row.previous_close);
    const liveAsOf = typeof row.live_as_of === "string" ? row.live_as_of : null;
    const liveTimestamp = liveAsOf ? Date.parse(liveAsOf) : NaN;
    const reportedPnl = paise(row.pnl);
    const option = /^(call|put|ce|pe)$/i.test(String(row.right));
    return { details: {...row}, id: `${account}:${index}`, provider: "icici", account, exchange: String(row.exchange_code ?? "Unavailable"), product: String(row.product_type ?? "Unavailable"),
      symbol: [row.stock_code, ...(option ? [row.strike_price, row.right] : [])].filter(value => value != null && value !== "").join(" ") || "Unavailable",
      expiry: row.expiry_date == null ? null : String(row.expiry_date), quantity: signedQuantity,
      average, ltp, previousClose, mtmPaise: calculateDailyMtm(signedQuantity, previousClose, ltp), estimatedPnlPaise: side && ["NSE","BSE","NFO","BFO"].includes(String(row.exchange_code).toUpperCase()) && /^(cash|options|futures)$/i.test(String(row.product_type)) ? calculateOpenPnl(signedQuantity, average, ltp) : null, pnlPaise: reportedPnl, marginPaise: paise(row.margin_amount), side, asOf: liveAsOf ?? asOf, fresh: Number.isFinite(liveTimestamp) && Date.now() - liveTimestamp <= 15000 };
  });
}
export function iciciHoldings(account: IciciAccount | null): PortfolioRow[] {
  return (account?.sections.portfolioholdings?.rows ?? []).map(row => ({
    details: {...row}, name: typeof row.stock_name === "string" ? row.stock_name : undefined, provider: "icici", accountId: account!.accountId, symbol: String(row.stock_code ?? "Unavailable"), exchange: row.exchange_code == null ? null : String(row.exchange_code),
    quantity: number(row.quantity), investedPaise: paise(row.investment_value), marketValuePaise: paise(row.market_value), averagePaise: paise(row.average_price), ltpPaise: paise(row.current_market_price), dayPnlPaise: paise(row.today_holding_pnl_estimate), unrealizedPaise: paise(row.unrealized_holding_pnl),
  }));
}
