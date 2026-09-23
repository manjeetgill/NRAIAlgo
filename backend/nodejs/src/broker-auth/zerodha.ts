/** Zerodha Kite Connect OAuth: step 2 (daily authorization) for the broker
 * already set up in step 1. Uses the official `kiteconnect` SDK's own
 * getLoginURL/generateSession -- no hand-rolled checksum computation, same
 * as AlgoTrade's proven zerodha-connection.ts.
 *
 * Kite access tokens expire at 6 AM IST the next day (a documented
 * regulatory requirement, not a guess) -- see kiteconnect's own
 * SessionData.access_token doc comment.
 */
import { KiteConnect, type Connect } from "kiteconnect";
import { z } from "zod";

type LoginUrlClient = Pick<Connect, "getLoginURL">;
export type SessionClient = Pick<Connect, "generateSession">;

/** What a decrypted broker_sessions row must actually contain before it's
 * trusted as a live Zerodha session. A vault key/algorithm change, a
 * partially-written row, or simple bit rot would otherwise surface as a
 * TypeScript-typed value that silently isn't one at runtime -- this parses
 * it instead of casting. */
export const ZerodhaSessionSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
});
export type ZerodhaSession = z.infer<typeof ZerodhaSessionSchema>;

/** Builds the URL to send the browser to for the OAuth redirect. `state` round-trips
 * through Kite's redirect_params back to our callback, unmodified. */
export function createZerodhaLoginUrl(
  apiKey: string,
  state: string,
  factory: (apiKey: string) => LoginUrlClient = (key) => new KiteConnect({ api_key: key }),
): string {
  const url = new URL(factory(apiKey).getLoginURL());
  if (url.protocol !== "https:" || !["kite.zerodha.com", "kite.trade"].includes(url.hostname)) {
    throw new Error("Unexpected Kite login destination.");
  }
  url.searchParams.set("redirect_params", new URLSearchParams({ state }).toString());
  return url.toString();
}

/** Exchanges the callback's one-time request_token for the day's access_token. */
export async function exchangeZerodhaRequestToken(
  apiKey: string,
  apiSecret: string,
  requestToken: string,
  factory: (apiKey: string) => SessionClient = (key) => new KiteConnect({ api_key: key }),
): Promise<ZerodhaSession> {
  const session = await factory(apiKey).generateSession(requestToken, apiSecret);
  return { accessToken: session.access_token, userId: session.user_id, userName: session.user_name };
}

/** The next 06:00 IST after `now` -- when Kite invalidates today's access_token. */
export function nextKiteExpiry(now: Date): Date {
  const IST_OFFSET_MINUTES = 5 * 60 + 30;
  const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const istDateKey = istNow.toISOString().slice(0, 10);
  const sixAmToday = new Date(Date.parse(`${istDateKey}T06:00:00Z`) - IST_OFFSET_MINUTES * 60_000);
  return sixAmToday.getTime() > now.getTime() ? sixAmToday : new Date(sixAmToday.getTime() + 86_400_000);
}
