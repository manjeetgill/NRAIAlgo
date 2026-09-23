import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildOverviewSnapshot, loadOverviewInputs, type SnapshotDeps } from "./build-overview-snapshot.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { seedNseCalendar } from "./market-calendar.js";
import { credentialVault } from "./credential-vault.js";
import type { PriceQuote } from "@nraialgo/contracts";

const vault = credentialVault({ CREDENTIAL_VAULT_KEY: "e".repeat(64) } as NodeJS.ProcessEnv);
const EXCHANGE = "TEST";
const SEGMENT = "EQ";
const SCOPE = {
  workspaceId: "ws-test",
  accountId: "acct-test",
  exchange: EXCHANGE,
  segment: SEGMENT,
  context: "PAPER" as const,
};

const FAKE_QUOTES: PriceQuote[] = [
  { instrumentId: "NSE:NIFTY50", label: "NIFTY 50", value: 23346.4, priceBasis: "official-close", sourceAsOf: "2026-09-18T10:00:00.000Z", receivedAt: "2026-09-19T06:00:00.000Z", fresh: false },
];

// Hermetic by default: every test uses these fixtures/mocks instead of a
// real NSE/Zerodha/Kotak network call. build-overview-snapshot.smoke.test.ts
// is where the real, opt-in connectivity checks live instead.
const FAKE_DEPS: SnapshotDeps = {
  fetchNseIndexCloses: async () => FAKE_QUOTES,
  fetchZerodhaPortfolio: async () => {
    throw new Error("not stubbed for this test");
  },
  fetchKotakPortfolio: async () => {
    throw new Error("not stubbed for this test");
  },
};

let store: Store;

beforeAll(async () => {
  const local = readLocalPostgresConfiguration();
  const migrationStore = openDatabaseStore(process.env.DATABASE_URL ?? local?.adminUrl);
  try {
    await runDatabaseMigrations(migrationStore, {
      runtimePassword: process.env.DATABASE_URL ? undefined : local?.applicationPassword,
    });
  } finally {
    await migrationStore.close();
  }
  store = openDatabaseStore();
});

afterAll(async () => {
  await store.close();
});

beforeEach(async () => {
  await store.transaction(async (query) => {
    await query("DELETE FROM market_calendar WHERE exchange=$1", [EXCHANGE]);
    // 2026-09-18 (Fri) is a real NSE trading day -- see nse-bhavcopy.test.ts.
    await seedNseCalendar(query, {
      from: new Date("2026-09-18T00:00:00Z"),
      days: 6,
      exchange: EXCHANGE,
      segment: SEGMENT,
    });
  });
});

afterEach(async () => {
  await store.transaction(async (query) => {
    await query("DELETE FROM market_calendar WHERE exchange=$1", [EXCHANGE]);
    await query("DELETE FROM broker_app_credentials WHERE workspace_id=$1", [SCOPE.workspaceId]);
    await query("DELETE FROM broker_sessions WHERE workspace_id=$1", [SCOPE.workspaceId]);
  });
});

async function snapshotFor(now: Date, deps: SnapshotDeps = FAKE_DEPS) {
  const inputs = await store.transaction((query) => loadOverviewInputs(query, vault, SCOPE, now));
  return buildOverviewSnapshot(inputs, now, SCOPE, deps);
}

async function saveZerodhaSession(accessToken = "not-a-real-token") {
  await store.transaction(async (query) => {
    await query(
      `INSERT INTO broker_app_credentials (workspace_id, provider, ciphertext, updated_at)
       VALUES ($1,'zerodha',$2,now())
       ON CONFLICT (workspace_id, provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, updated_at=now()`,
      [SCOPE.workspaceId, vault.seal(`${SCOPE.workspaceId}:zerodha`, { apiKey: "test-key", apiSecret: "test-secret-value" })],
    );
    await query(
      `INSERT INTO broker_sessions (workspace_id, provider, ciphertext, expires_at, updated_at)
       VALUES ($1,'zerodha',$2,$3,now())`,
      [
        SCOPE.workspaceId,
        vault.seal(`${SCOPE.workspaceId}:zerodha:session`, { accessToken, userId: "AB1234", userName: "Test User" }),
        new Date(Date.now() + 3_600_000).toISOString(),
      ],
    );
  });
}

async function saveKotakSession() {
  await store.transaction(async (query) => {
    await query(
      `INSERT INTO broker_app_credentials (workspace_id, provider, ciphertext, updated_at)
       VALUES ($1,'kotak',$2,now())
       ON CONFLICT (workspace_id, provider) DO UPDATE SET ciphertext=EXCLUDED.ciphertext, updated_at=now()`,
      [SCOPE.workspaceId, vault.seal(`${SCOPE.workspaceId}:kotak`, { accessToken: "tok", mobileNumber: "+919876543210", ucc: "UCC001" })],
    );
    await query(
      `INSERT INTO broker_sessions (workspace_id, provider, ciphertext, expires_at, updated_at)
       VALUES ($1,'kotak',$2,$3,now())`,
      [
        SCOPE.workspaceId,
        vault.seal(`${SCOPE.workspaceId}:kotak:session`, { token: "t", sid: "s", baseUrl: "https://neo.example" }),
        new Date(Date.now() + 3_600_000).toISOString(),
      ],
    );
  });
}

describe("buildOverviewSnapshot -- prices panel", () => {
  it("uses the injected NSE adapter for the last completed session, not a real network call", async () => {
    // Saturday, so Friday 2026-09-18 is the last completed session.
    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"));

    expect(snapshot.session.status).toBe("available");
    expect(snapshot.session.data?.lastCompletedSession).toBe("2026-09-18");
    expect(snapshot.prices.status).toBe("available");
    expect(snapshot.prices.source).toBe("nse-bhavcopy");
    expect(snapshot.prices.data?.[0]?.value).toBe(23346.4);
  });

  it("reports prices as unavailable with a clear reason when no session has completed yet", async () => {
    // Friday itself, before market open -- nothing has completed on this
    // calendar window yet.
    const snapshot = await snapshotFor(new Date("2026-09-18T02:00:00Z"));

    expect(snapshot.prices.status).toBe("unavailable");
    expect(snapshot.prices.reason).toBe("NO_COMPLETED_SESSION_ON_CALENDAR");
  });

  it("reports prices as unavailable (not partial) when the NSE adapter throws", async () => {
    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"), {
      ...FAKE_DEPS,
      fetchNseIndexCloses: async () => {
        throw new Error("NSE bhavcopy for 2026-09-18 was missing: INDIA VIX");
      },
    });

    expect(snapshot.prices.status).toBe("unavailable");
    expect(snapshot.prices.reason).toContain("INDIA VIX");
  });

  it("still honestly reports account-dependent panels as unavailable -- no broker session exists", async () => {
    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"));

    expect(snapshot.pnl.status).toBe("unavailable");
    expect(snapshot.pnl.reason).toBe("NO_AUTHORIZED_BROKER_SESSION");
    expect(snapshot.holdings.status).toBe("unavailable");
    expect(snapshot.holdings.reason).toBe("NO_AUTHORIZED_BROKER_SESSION");
    expect(snapshot.deployment.status).toBe("unavailable");
    expect(snapshot.deployment.reason).toBe("NO_STRATEGY_ENGINE");
    expect(snapshot.connections.status).toBe("unavailable");
    expect(snapshot.connections.reason).toBe("NO_VERIFIED_BROKER_READS");
    expect(snapshot.activity.status).toBe("unavailable");
    expect(snapshot.activity.reason).toBe("NO_AUDIT_LOG_CONFIGURED");
  });
});

describe("buildOverviewSnapshot -- portfolio panels (broker adapters injected)", () => {
  it("reports a real adapter failure honestly, never falling back to 'no session'", async () => {
    await saveZerodhaSession();

    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"), {
      ...FAKE_DEPS,
      fetchZerodhaPortfolio: async () => {
        throw new Error("Invalid access token");
      },
    });

    expect(snapshot.pnl.status).toBe("unavailable");
    expect(snapshot.pnl.reason).toContain("Zerodha");
    expect(snapshot.pnl.reason).not.toBe("NO_AUTHORIZED_BROKER_SESSION");
  });

  it("marks a Zerodha portfolio timeout as a provider failure, not a crash", async () => {
    await saveZerodhaSession();

    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"), {
      ...FAKE_DEPS,
      fetchZerodhaPortfolio: async () => {
        throw new Error("Zerodha portfolio read timed out after 8000ms");
      },
    });

    expect(snapshot.pnl.status).toBe("unavailable");
    expect(snapshot.pnl.reason).toContain("timed out");
  });

  it("returns 'degraded', not 'available', when one broker succeeds and another fails", async () => {
    await saveZerodhaSession();
    await saveKotakSession();

    const workingHoldings = {
      holdings: [{ provider: "zerodha", accountId: "AB1234", symbol: "RELIANCE", quantity: 5, pledgedQuantity: null, marketValuePaise: 500_000 }],
      collateralPaise: 0,
      usedMarginPaise: 0,
      availableMarginPaise: 100_000_00,
      accountAsOf: "2026-09-19T06:00:00.000Z",
      valuationAsOf: "2026-09-19T06:00:00.000Z",
    };
    const workingPnl = {
      period: "session",
      currency: "INR" as const,
      baseCapital: { context: "live" as const, amountPaise: null },
      realisedPaise: 0,
      unrealisedPaise: 500_00,
      grossPaise: 500_00,
      chargesPaise: null,
      netPaise: null,
      valuationAsOf: "2026-09-19T06:00:00.000Z",
      reconciliationStatus: "provisional" as const,
    };

    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"), {
      ...FAKE_DEPS,
      fetchZerodhaPortfolio: async () => ({ holdings: workingHoldings, pnl: workingPnl }),
      fetchKotakPortfolio: async () => {
        throw new Error("Kotak portfolio request failed (HTTP 503)");
      },
    });

    expect(snapshot.pnl.status).toBe("degraded");
    expect(snapshot.pnl.reason).toContain("Kotak");
    expect(snapshot.pnl.reason).toContain("totals include only zerodha");
    expect(snapshot.holdings.status).toBe("degraded");
    expect(snapshot.holdings.data?.holdings).toHaveLength(1);
    // The data that DID succeed must still be there -- degraded never drops it.
    expect(snapshot.holdings.data?.holdings[0]?.provider).toBe("zerodha");
  });

  it("keeps chargesPaise/netPaise/baseCapital null in the combined result when a provider reports them as unknown", async () => {
    await saveZerodhaSession();

    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"), {
      ...FAKE_DEPS,
      fetchZerodhaPortfolio: async () => ({
        holdings: {
          holdings: [],
          collateralPaise: 0,
          usedMarginPaise: 0,
          availableMarginPaise: 100_000_00,
          accountAsOf: "2026-09-19T06:00:00.000Z",
          valuationAsOf: "2026-09-19T06:00:00.000Z",
        },
        pnl: {
          period: "session",
          currency: "INR" as const,
          baseCapital: { context: "live" as const, amountPaise: null },
          realisedPaise: 0,
          unrealisedPaise: 0,
          grossPaise: 0,
          chargesPaise: null,
          netPaise: null,
          valuationAsOf: "2026-09-19T06:00:00.000Z",
          reconciliationStatus: "provisional" as const,
        },
      }),
    });

    expect(snapshot.pnl.status).toBe("available");
    expect(snapshot.pnl.data?.chargesPaise).toBeNull();
    expect(snapshot.pnl.data?.netPaise).toBeNull();
    expect(snapshot.pnl.data?.baseCapital.amountPaise).toBeNull();
  });

  it("fails closed (treats the session as absent) when a decrypted session row doesn't match the expected shape", async () => {
    // A malformed/corrupted record, not a valid ZerodhaSession -- missing userId.
    await store.transaction(async (query) => {
      await query(
        `INSERT INTO broker_app_credentials (workspace_id, provider, ciphertext, updated_at)
         VALUES ($1,'zerodha',$2,now())`,
        [SCOPE.workspaceId, vault.seal(`${SCOPE.workspaceId}:zerodha`, { apiKey: "k", apiSecret: "s" })],
      );
      await query(
        `INSERT INTO broker_sessions (workspace_id, provider, ciphertext, expires_at, updated_at)
         VALUES ($1,'zerodha',$2,$3,now())`,
        [
          SCOPE.workspaceId,
          vault.seal(`${SCOPE.workspaceId}:zerodha:session`, { accessToken: "tok" }),
          new Date(Date.now() + 3_600_000).toISOString(),
        ],
      );
    });

    const snapshot = await snapshotFor(new Date("2026-09-19T06:00:00Z"));

    expect(snapshot.pnl.status).toBe("unavailable");
    expect(snapshot.pnl.reason).toBe("NO_AUTHORIZED_BROKER_SESSION");
  });
});
