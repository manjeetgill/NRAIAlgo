import { describe, expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "@nraialgo/contracts";
import { withIciciOverviewStatus } from "./icici-overview-status";
import { brokerHealth } from "./broker-health";

describe("ICICI overview status overlay", () => {
  it("turns a verified Breeze read into shared readiness and connection evidence", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.connections = { status: "unavailable", source: "none", asOf: null, version: 0, data: null, reason: "NO_VERIFIED_BROKER_READS" };
    snapshot.readiness.data!.checks.brokerSessions = { status: "unknown", reason: "NO_AUTHORIZED_BROKER_SESSION" };
    snapshot.pnl = { status: "unavailable", source: "none", asOf: null, version: 0, data: null, reason: "NO_AUTHORIZED_BROKER_SESSION" };
    snapshot.configuredProviders = ["icici"];
    const result = withIciciOverviewStatus(snapshot, { accountId: "IC1", asOf: snapshot.generatedAt, sections: { ...Object.fromEntries(["funds", "portfolioholdings", "portfoliopositions"].map(key => [key, { status: "available", rows: [] }])), order: { status: "degraded", rows: [], reason: "One exchange order request failed" } } });
    expect(result.connections.data).toEqual([{ source: "ICICI account REST", status: "connected", latencyMs: null, asOf: snapshot.generatedAt }]);
    expect(brokerHealth(result, "icici")).toBe("Connected");
    expect(result.readiness.data!.checks.brokerSessions).toEqual({ status: "passed", reason: null });
    expect(result.pnl.reason).toContain("ICICI session verified");
    expect(snapshot.connections.reason).toBe("NO_VERIFIED_BROKER_READS");
  });
  it("does not turn failed authorization into a pass or label stale data connected", () => {
    const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["after-close"]);
    snapshot.configuredProviders = ["zerodha", "icici"];
    snapshot.readiness.data!.checks.brokerSessions = { status: "failed", reason: "Expired" };
    const result = withIciciOverviewStatus(snapshot, { accountId: "IC1", asOf: snapshot.generatedAt, sections: {} }, true);
    expect(result.connections.data!.at(-1)!.status).toBe("degraded");
    expect(result.readiness.data!.checks.brokerSessions.status).toBe("failed");
  });
});
