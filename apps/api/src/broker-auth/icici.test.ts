import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { breezeHeaders, equityHoldingValuation, iciciAccount, iciciLogin, type BreezeTransport } from "./icici.js";

const credentials = { apiKey: "key", apiSecret: "secret" };
const session = { accountId: "user1", sessionToken: Buffer.from("user1:session-key").toString("base64") };
const ok = (Success: unknown) => ({ Success, Status: 200, Error: null });

describe("Breeze read-only protocol", () => {
  it("calculates equity holdings value and unrealized P&L without inventing missing costs", () => {
    expect(equityHoldingValuation({ quantity: "10", average_price: "100", current_market_price: "120" })).toMatchObject({ investment_value: 1000, market_value: 1200, unrealized_holding_pnl: 200, today_holding_pnl_estimate: null });
    expect(equityHoldingValuation({ quantity: "10", average_price: "120", current_market_price: "100" }).unrealized_holding_pnl).toBe(-200);
    for (const average_price of [null, "", "0", "bad"]) expect(equityHoldingValuation({ quantity: "10", average_price, current_market_price: "100" }).unrealized_holding_pnl).toBeNull();
    expect(equityHoldingValuation({ quantity: "0" }).unrealized_holding_pnl).toBe(0);
  });
  it("estimates daily holdings movement separately from cost-based P&L", () => {
    expect(equityHoldingValuation({ quantity: "10", average_price: "50", current_market_price: "110", change_percentage: "10" })).toMatchObject({ today_holding_pnl_estimate: 100, unrealized_holding_pnl: 600 });
    expect(equityHoldingValuation({ quantity: "10", current_market_price: "90", change_percentage: "-10" }).today_holding_pnl_estimate).toBe(-100);
    expect(equityHoldingValuation({ quantity: "10", current_market_price: "100", change_percentage: "0" }).today_holding_pnl_estimate).toBe(0);
    for (const change_percentage of [null, "", "bad", "-100", "-150"]) expect(equityHoldingValuation({ quantity: "10", current_market_price: "100", change_percentage }).today_holding_pnl_estimate).toBeNull();
  });
  it("requests NSE portfolio holdings and retains cost, price, and computed P&L", async () => {
    const result = await iciciAccount(credentials, session, async (endpoint, body) => {
      if (endpoint === "funds") return ok({});
      if (endpoint === "portfolioholdings") {
        expect(JSON.parse(body)).toEqual({ exchange_code: "NSE" });
        return ok([{ stock_code: "TEST", quantity: "2", average_price: "100", current_market_price: "110", bank_account: "private" }]);
      }
      return ok([]);
    });
    expect(result.sections.portfolioholdings?.rows[0]).toMatchObject({ stock_code: "TEST", market_value: 220, unrealized_holding_pnl: 20 });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("signs the exact GET body with a whole-second UTC timestamp", () => {
    const now = new Date("2026-09-22T10:01:02.456Z");
    expect(breezeHeaders(credentials, session, "{}", now)).toEqual({
      "X-AppKey": "key", "X-SessionToken": session.sessionToken,
      "X-Timestamp": "2026-09-22T10:01:02.000Z",
      "X-Checksum": `token ${createHash("sha256").update("2026-09-22T10:01:02.000Z{}secret").digest("hex")}`,
    });
  });
  it("exchanges the API session and verifies the secret with a funds read", async () => {
    const calls: string[] = [];
    const transport: BreezeTransport = async (endpoint, body, headers) => {
      calls.push(endpoint);
      if (endpoint === "customerdetails") {
        expect(JSON.parse(body)).toEqual({ SessionToken: "daily-token", AppKey: "key" });
        expect(headers).toEqual({});
        return ok({ session_token: session.sessionToken });
      }
      expect(headers["X-SessionToken"]).toBe(session.sessionToken);
      return ok({});
    };
    await expect(iciciLogin(credentials, "daily-token", transport)).resolves.toEqual(session);
    expect(calls).toEqual(["customerdetails", "funds"]);
  });
  it("rejects invalid sessions and broker-level errors even on HTTP success", async () => {
    await expect(iciciLogin(credentials, "token", async () => ok({ session_token: "invalid" }))).rejects.toThrow();
    await expect(iciciLogin(credentials, "token", async () => ({ Status: 500, Error: "secret error", Success: null }))).rejects.toThrow("Breeze rejected request");
  });
  it("preserves unknown values, contract identity and strips sensitive fields", async () => {
    const result = await iciciAccount(credentials, session, async (endpoint) => {
      if (endpoint === "funds") return ok({ bank_account: "SECRET-BANK", unallocated_balance: "100.50" });
      if (endpoint === "portfoliopositions") return ok([{ stock_code: "NIFTY", expiry_date: "24-Sep-2026", strike_price: "25000", right: "Call", pnl: null, quantity: "50" }]);
      return ok([]);
    });
    expect(JSON.stringify(result)).not.toContain("SECRET-BANK");
    expect(result.sections.funds?.rows[0]?.total_bank_balance).toBeNull();
    expect(result.sections.portfoliopositions?.rows[0]).toMatchObject({ stock_code: "NIFTY", strike_price: "25000", pnl: null });
  });
  it("isolates failed sections and hides upstream error details", async () => {
    const result = await iciciAccount(credentials, session, async (endpoint) => {
      if (endpoint === "funds") throw new Error("secret-token");
      return ok([]);
    });
    expect(result.sections.funds?.status).toBe("unavailable");
    expect(result.sections.dematholdings?.status).toBe("available");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it("queries only supported order exchanges, deduplicates orders and reports real partial coverage", async () => {
    const exchanges: string[] = [];
    const result = await iciciAccount(credentials, session, async (endpoint, body) => {
      if (endpoint === "funds") return ok({});
      if (endpoint === "order") {
        exchanges.push(JSON.parse(body).exchange_code);
        return ok([{ order_id: "test-order" }]);
      }
      return ok([]);
    });
    expect(exchanges).toEqual(["NSE", "NFO"]);
    expect(result.sections.order?.status).toBe("available");
    expect(result.sections.order?.rows).toHaveLength(1);

    const partial = await iciciAccount(credentials, session, async (endpoint, body) => {
      if (endpoint === "funds") return ok({});
      if (endpoint === "order" && JSON.parse(body).exchange_code === "NFO") throw new Error("Not enabled");
      return endpoint === "order" ? ok([{ order_id: "equity-order" }]) : ok([]);
    });
    expect(partial.sections.order).toMatchObject({ status: "degraded", reason: "Partial order coverage: NFO request failed; responding exchanges are shown." });
  });
});
