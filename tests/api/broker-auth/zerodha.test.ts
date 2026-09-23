import { describe, expect, it } from "vitest";
import {
  createZerodhaLoginUrl,
  exchangeZerodhaRequestToken,
  nextKiteExpiry,
  type SessionClient,
} from "../../../apps/api/src/broker-auth/zerodha.js";

describe("createZerodhaLoginUrl", () => {
  it("builds the real Kite login URL and round-trips state via redirect_params", () => {
    const url = createZerodhaLoginUrl("my_api_key", "abc123state");

    const parsed = new URL(url);
    expect(parsed.hostname).toBe("kite.zerodha.com");
    expect(parsed.searchParams.get("api_key")).toBe("my_api_key");
    expect(parsed.searchParams.get("redirect_params")).toBe("state=abc123state");
  });

  it("rejects an SDK that returns a login URL on an unexpected host", () => {
    expect(() =>
      createZerodhaLoginUrl("key", "state", () => ({
        getLoginURL: () => "https://evil.example.com/phish",
      })),
    ).toThrow(/Unexpected Kite login destination/);
  });
});

describe("exchangeZerodhaRequestToken", () => {
  it("exchanges a request token for the session's access token via generateSession", async () => {
    // The real SessionData interface has many more fields (broker, exchanges,
    // products, ...) that this adapter doesn't read -- only cast the mock's
    // return value, not weaken the adapter's real parameter type.
    const session = await exchangeZerodhaRequestToken(
      "key",
      "secret",
      "the-request-token",
      () =>
        ({
          generateSession: async (requestToken: string, apiSecret: string) => {
            expect(requestToken).toBe("the-request-token");
            expect(apiSecret).toBe("secret");
            return { access_token: "the-access-token", user_id: "AB1234", user_name: "Test User" };
          },
        }) as unknown as SessionClient,
    );

    expect(session).toEqual({ accessToken: "the-access-token", userId: "AB1234", userName: "Test User" });
  });
});

describe("nextKiteExpiry", () => {
  it("returns today's 06:00 IST when now is before it", () => {
    const now = new Date("2026-09-21T00:00:00Z"); // 05:30 IST
    expect(nextKiteExpiry(now).toISOString()).toBe("2026-09-21T00:30:00.000Z"); // 06:00 IST
  });

  it("returns tomorrow's 06:00 IST when now is after it", () => {
    const now = new Date("2026-09-21T10:00:00Z"); // 15:30 IST
    expect(nextKiteExpiry(now).toISOString()).toBe("2026-09-22T00:30:00.000Z");
  });
});
