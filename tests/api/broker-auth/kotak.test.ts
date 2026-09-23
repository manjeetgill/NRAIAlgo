import { describe, expect, it } from "vitest";
import { kotakDailyLogin, kotakSessionExpiry, KotakLoginError } from "../../../apps/api/src/broker-auth/kotak.js";

// mpin deliberately shares no digit substring with mobileNumber/totp, so a
// leaked-MPIN assertion can't pass by coincidental overlap.
const INPUT = { accessToken: "app-token", mobileNumber: "+919876543210", ucc: "ABC123", totp: "112233", mpin: "998877" };

function fakeFetch(responses: Record<string, unknown>): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const key = href.includes("tradeApiValidate") ? "validate" : "login";
    if (key === "login") {
      expect(body).toEqual({ mobileNumber: INPUT.mobileNumber, ucc: INPUT.ucc, totp: INPUT.totp });
      expect((init?.headers as Record<string, string>).Authorization).toBe(INPUT.accessToken);
    } else {
      expect(body).toEqual({ mpin: INPUT.mpin });
      expect((init?.headers as Record<string, string>).sid).toBe("sid-1");
      expect((init?.headers as Record<string, string>).Auth).toBe("token-1");
    }
    return { ok: true, json: async () => responses[key] } as Response;
  }) as typeof fetch;
}

describe("kotakDailyLogin", () => {
  it("completes the real two-step sequence: TOTP login, then MPIN validation", async () => {
    const fetchImpl = fakeFetch({
      login: { data: { status: "success", kType: "View", token: "token-1", sid: "sid-1" } },
      validate: {
        data: { status: "success", kType: "Trade", token: "token-2", sid: "sid-2", baseUrl: "https://neo.example/api" },
      },
    });

    const session = await kotakDailyLogin(INPUT, fetchImpl);

    expect(session).toEqual({ token: "token-2", sid: "sid-2", baseUrl: "https://neo.example/api" });
  });

  it("fails at TOTP_LOGIN when the first step is rejected", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ data: { status: "error" } }),
    })) as unknown as typeof fetch;

    await expect(kotakDailyLogin(INPUT, fetchImpl)).rejects.toMatchObject({
      stage: "TOTP_LOGIN",
    } satisfies Partial<KotakLoginError>);
  });

  it("fails at MPIN_VERIFY when the MPIN step is rejected, even if login succeeded", async () => {
    const fetchImpl = fakeFetch({
      login: { data: { status: "success", kType: "View", token: "token-1", sid: "sid-1" } },
      validate: { data: { status: "error" } },
    });

    await expect(kotakDailyLogin(INPUT, fetchImpl)).rejects.toMatchObject({ stage: "MPIN_VERIFY" });
  });

  it("never sends the MPIN in the first (TOTP) request", async () => {
    let firstRequestBody = "";
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = typeof url === "string" ? url : url.toString();
      if (!href.includes("tradeApiValidate")) {
        firstRequestBody = init?.body as string;
        return { ok: true, json: async () => ({ data: { status: "success", kType: "View", token: "t", sid: "s" } }) } as Response;
      }
      return { ok: true, json: async () => ({ data: { status: "success", kType: "Trade", token: "t2", sid: "s2", baseUrl: "https://x" } }) } as Response;
    }) as typeof fetch;

    await kotakDailyLogin(INPUT, fetchImpl);

    expect(firstRequestBody).not.toContain(INPUT.mpin);
  });
});

describe("kotakSessionExpiry", () => {
  it("caps the session at 8 hours from login", () => {
    const now = new Date("2026-09-21T05:00:00Z");
    expect(kotakSessionExpiry(now).toISOString()).toBe("2026-09-21T13:00:00.000Z");
  });
});
