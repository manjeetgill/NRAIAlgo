import { KiteConnect, type Connect } from "kiteconnect";
import { BrokerOrdersPanelSchema, type OverviewSnapshot } from "@nraialgo/contracts";
import type { ZerodhaInputs } from "../build-overview-snapshot.js";

/** Same-day broker order book, not an immutable NRAIAlgo audit ledger. */
export async function fetchZerodhaOrders(
  credentials: ZerodhaInputs,
  factory: (key: string) => Pick<Connect, "setAccessToken" | "getOrders"> = key => new KiteConnect({ api_key: key, timeout: 8000 }),
): Promise<NonNullable<OverviewSnapshot["brokerOrders"]>> {
  const client = factory(credentials.apiKey);
  client.setAccessToken(credentials.accessToken);
  try {
    const orders = await client.getOrders();
    return BrokerOrdersPanelSchema.parse({ status: "available", source: "zerodha-order-book", asOf: new Date().toISOString(), version: 1, reason: null,
      data: orders.slice().reverse().map(order => ({ details: Object.fromEntries(["order_type","price","trigger_price","pending_quantity","cancelled_quantity","status_message","status_message_raw","validity","order_timestamp","exchange_timestamp"].filter(key=>["string","number"].includes(typeof (order as unknown as Record<string,unknown>)[key])).map(key=>[key,(order as unknown as Record<string,string|number>)[key]!])), orderId: order.order_id, symbol: order.tradingsymbol, exchange: order.exchange, product: order.product, side: order.transaction_type, status: order.status, quantity: order.quantity, filledQuantity: order.filled_quantity, averagePrice: order.average_price })) });
  } catch {
    // Never expose raw SDK errors or authenticated URLs to the browser.
    return { status: "unavailable", source: "zerodha-order-book", asOf: null, version: 0, reason: "Order book unavailable; verify broker session", data: null };
  }
}
