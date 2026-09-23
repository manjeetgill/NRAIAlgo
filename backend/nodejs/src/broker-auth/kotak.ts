/** Kotak Neo official Python SDK login: step 2 (daily authorization) for the broker
 * already set up in step 1. No OAuth redirect -- a two-step sequence
 * (TOTP login, then MPIN validation). An injected HTTP reader is retained
 * only for legacy protocol tests; production always uses the SDK bridge.
 *
 * Kotak Neo sessions are short-lived; this caps the stored expiry at 8
 * hours from login, matching the same cap AlgoTrade's client applies.
 */
import { z } from "zod";
import {KotakSdkError,kotakSdkRequest} from './kotak-sdk.js';

export class KotakLoginError extends Error {
  constructor(public readonly stage: "TOTP_LOGIN" | "MPIN_VERIFY" | "UNEXPECTED_RESPONSE", message: string) {
    super(message);
  }
}

/** What a decrypted broker_sessions row must actually contain before it's
 * trusted as a live Kotak session -- parsed, not cast; see
 * zerodha.ts's ZerodhaSessionSchema for the same reasoning. */
export const KotakSessionSchema = z.object({
  token: z.string().min(1),
  sid: z.string().min(1),
  baseUrl: z.string().url(),
});
export type KotakSession = z.infer<typeof KotakSessionSchema>;

interface KotakLoginResponse {
  data?: { status?: string; kType?: string; token?: string; sid?: string; baseUrl?: string };
}

async function callKotak(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 8000,
): Promise<KotakLoginResponse> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Kotak request failed (HTTP ${response.status})`);
  }
  return (await response.json()) as KotakLoginResponse;
}

export async function kotakDailyLogin(
  input: { accessToken: string; mobileNumber: string; ucc: string; totp: string; mpin: string },
  fetchImpl?: typeof fetch,
): Promise<KotakSession> {
  if(!fetchImpl) {
    try {
      const parsed=KotakSessionSchema.safeParse(await kotakSdkRequest('login',input));
      if(!parsed.success)throw new KotakSdkError('SDK_INVALID_RESPONSE');
      return parsed.data;
    } catch(error) {
      if(error instanceof KotakSdkError && (error.code==='TOTP_LOGIN'||error.code==='MPIN_VERIFY')) throw new KotakLoginError(error.code,error.message);
      throw error;
    }
  }
  const headers = {
    Authorization: input.accessToken,
    "neo-fin-key": "neotradeapi",
    "Content-Type": "application/json",
  };

  const first = await callKotak(fetchImpl, "https://mis.kotaksecurities.com/login/1.0/tradeApiLogin", headers, {
    mobileNumber: input.mobileNumber,
    ucc: input.ucc,
    totp: input.totp,
  });
  if (first.data?.status !== "success" || first.data.kType !== "View" || !first.data.token || !first.data.sid) {
    throw new KotakLoginError("TOTP_LOGIN", "Kotak rejected the access token, mobile number, UCC or TOTP.");
  }

  const second = await callKotak(
    fetchImpl,
    "https://mis.kotaksecurities.com/login/1.0/tradeApiValidate",
    { ...headers, sid: first.data.sid, Auth: first.data.token },
    { mpin: input.mpin },
  );
  if (second.data?.status !== "success" || second.data.kType !== "Trade" || !second.data.token || !second.data.sid) {
    throw new KotakLoginError("MPIN_VERIFY", "Kotak rejected the MPIN.");
  }
  if (!second.data.baseUrl) {
    throw new KotakLoginError("UNEXPECTED_RESPONSE", "Kotak's response did not include a session base URL.");
  }

  return { token: second.data.token, sid: second.data.sid, baseUrl: second.data.baseUrl };
}

export function kotakSessionExpiry(now: Date): Date {
  return new Date(now.getTime() + 8 * 3_600_000);
}
