import { createHash } from "node:crypto";
import { request } from "node:https";
import { z } from "zod";

// Protocol: ICICI Direct's official Breeze Python SDK api_util/get_headers.
// Breeze requires GET bodies; fetch deliberately rejects those, so use https.
export const iciciCredentials = z.object({ apiKey: z.string().trim().min(1).max(256), apiSecret: z.string().trim().min(1).max(256) }).strict();
export const iciciSession = z.object({ sessionToken: z.string(), accountId: z.string() });
type Credentials = z.infer<typeof iciciCredentials>;
type Session = z.infer<typeof iciciSession>;
type Endpoint = "customerdetails" | "funds" | "dematholdings" | "portfolioholdings" | "portfoliopositions" | "order";
export type BreezeTransport = (endpoint: Endpoint, body: string, headers: Record<string, string>) => Promise<unknown>;

export function breezeHeaders(credentials: Credentials, session: Session, body: string, now = new Date()) {
  const timestamp = now.toISOString().slice(0, 19) + ".000Z";
  return { "X-AppKey": credentials.apiKey, "X-SessionToken": session.sessionToken,
    "X-Timestamp": timestamp, "X-Checksum": `token ${createHash("sha256").update(timestamp + body + credentials.apiSecret).digest("hex")}` };
}

export const breezeTransport: BreezeTransport = (endpoint, body, headers) => new Promise((resolve, reject) => {
  const req = request(`https://api.icicidirect.com/breezeapi/api/v1/${endpoint}`, {
    method: "GET", headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, (res) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) req.destroy(new Error("Breeze response too large"));
      else chunks.push(chunk);
    });
    res.on("error", () => reject(new Error("Breeze connection failed")));
    res.on("end", () => {
      if (res.statusCode !== 200) return reject(new Error("Breeze request failed"));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("Invalid Breeze response")); }
    });
  });
  const timer = setTimeout(() => req.destroy(new Error("Breeze timed out")), 12_000);
  req.on("close", () => clearTimeout(timer));
  req.on("error", () => reject(new Error("Breeze request failed or timed out")));
  req.end(body);
});

function unwrap(value: unknown): unknown {
  const result = z.object({ Status: z.number(), Error: z.unknown().optional(), Success: z.unknown() }).parse(value);
  if (result.Status !== 200 || result.Error) throw new Error("Breeze rejected request");
  return result.Success;
}

export async function iciciLogin(credentials: Credentials, token: string, transport = breezeTransport): Promise<Session> {
  const result = z.object({ session_token: z.string().min(1) }).parse(unwrap(await transport("customerdetails", JSON.stringify({ SessionToken: token, AppKey: credentials.apiKey }), {})));
  const decoded = Buffer.from(result.session_token, "base64").toString("utf8");
  const [accountId, key, extra] = decoded.split(":");
  if (!accountId || !key || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error("Invalid Breeze session");
  const session = { sessionToken: result.session_token, accountId };
  // Verify API secret with an authenticated, read-only call before saving.
  unwrap(await transport("funds", "{}", breezeHeaders(credentials, session, "{}")));
  return session;
}

const row = z.record(z.string(), z.unknown());

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Equity-only valuation, in INR. Never substitute this for session trading P&L.
 * Breeze's zero cost/quote on a nonzero holding is treated as unavailable. */
export function equityHoldingValuation(item: Record<string, unknown>) {
  const quantity = finiteNumber(item.quantity);
  const average = finiteNumber(item.average_price);
  const price = finiteNumber(item.current_market_price);
  const round = (value: number) => Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) / 100 : null;
  const market = quantity !== null && quantity >= 0 && price !== null && price > 0 ? round(quantity * price) : null;
  const cost = quantity !== null && quantity >= 0 && average !== null && average > 0 ? round(quantity * average) : null;
  const valid = quantity !== null && quantity >= 0 && average !== null && average > 0 && price !== null && price > 0;
  // Breeze change_percentage is price change vs previous close, not return on cost.
  // Estimate on CURRENT quantity only: this is not a trade-adjusted day P&L ledger.
  const change = finiteNumber(item.change_percentage);
  const previousClose = price !== null && price > 0 && change !== null && change > -100 ? price / (1 + change / 100) : null;
  const today = quantity !== null && quantity >= 0 && price !== null && previousClose !== null && Number.isFinite(previousClose)
    ? round(quantity * (price - previousClose)) : null;
  return { investment_value: quantity === 0 ? 0 : cost, market_value: quantity === 0 ? 0 : market,
    today_holding_pnl_estimate: quantity === 0 ? 0 : today,
    unrealized_holding_pnl: quantity === 0 ? 0 : valid ? round(quantity * (price - average)) : null };
}

const fields = {
  funds: ["total_bank_balance", "allocated_equity", "allocated_fno", "unallocated_balance", "block_by_trade_equity", "block_by_trade_fno", "block_by_trade_balance"],
  portfolioholdings: ["stock_code", "exchange_code", "quantity", "average_price", "current_market_price", "booked_profit_loss", "change_percentage"],
  dematholdings: ["stock_code", "stock_ISIN", "quantity", "demat_avail_quantity"],
  portfoliopositions: ["stock_code", "exchange_code", "product_type", "expiry_date", "strike_price", "right", "action", "quantity", "average_price", "ltp", "pnl", "margin_amount"],
  order: ["order_id", "stock_code", "exchange_code", "product_type", "expiry_date", "strike_price", "right", "action", "quantity", "pending_quantity", "average_price", "status"],
} as const;

export async function iciciAccount(credentials: Credentials, session: Session, transport = breezeTransport, now = new Date()) {
  const day = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const sections = await Promise.all((Object.keys(fields) as (keyof typeof fields)[]).map(async (endpoint) => {
    try {
      // Breeze documents order-list coverage for NSE/NFO. Querying BSE here
      // made every otherwise-successful order snapshot look degraded because
      // that exchange is not supported by this API surface.
      const orderExchanges = ["NSE", "NFO"] as const;
      const bodies = endpoint === "order" ? orderExchanges.map((exchange_code) => ({ exchange_code, from_date: `${day}T00:00:00.000Z`, to_date: `${day}T23:59:59.000Z` })) : endpoint === "portfolioholdings" ? [{ exchange_code: "NSE" }] : [{}];
      const batches = await Promise.allSettled(bodies.map(async (payload) => {
        const body = JSON.stringify(payload);
        const data = unwrap(await transport(endpoint, body, breezeHeaders(credentials, session, body, now)));
        return endpoint === "funds" ? [row.parse(data)] : z.array(row).parse(data);
      }));
      const successful = batches.filter((batch) => batch.status === "fulfilled");
      if (!successful.length) throw new Error("No Breeze data received");
      // Explicit allowlist: never forward bank-account identifiers or raw broker payloads.
      const allowedRows: Record<string, string | number | null>[] = successful.flatMap((batch) => batch.value).map((item) => ({
        ...Object.fromEntries(fields[endpoint].map((field) => [field, typeof item[field] === "string" || typeof item[field] === "number" ? item[field] : null])),
        ...(endpoint === "portfolioholdings" ? equityHoldingValuation(item) : {}),
      }));
      const rows = endpoint === "order"
        ? allowedRows.filter((item, index, all) => all.findIndex(candidate => candidate.order_id === item.order_id) === index)
        : allowedRows;
      const failedExchanges = endpoint === "order"
        ? batches.flatMap((batch, index) => batch.status === "rejected" ? [orderExchanges[index]!] : [])
        : [];
      return [endpoint, { status: successful.length === batches.length ? "available" : "degraded", rows,
        ...(successful.length < batches.length ? { reason: `Partial order coverage: ${failedExchanges.join(" and ")} request failed; responding exchanges are shown.` } : {}) }] as const;
    } catch {
      return [endpoint, { status: "unavailable", rows: [], reason: "Breeze data unavailable. Check authorization and retry." }] as const;
    }
  }));
  return { provider: "icici", accountId: session.accountId, asOf: now.toISOString(), sections: Object.fromEntries(sections) };
}
