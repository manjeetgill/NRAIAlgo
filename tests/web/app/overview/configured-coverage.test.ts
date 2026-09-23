import { expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "../../../fixtures/overview";
import { hasCoreCoverage, selectedProviders } from "../../../../apps/web/app/app/overview/broker-view";
it("requires configured brokers only, but never ignores an expired configured broker", () => {
 const snapshot = structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
 snapshot.configuredProviders = ["zerodha"];
 snapshot.brokerReconciliation = { zerodha: { accountId: "Z1", status: "confirmed", asOf: snapshot.generatedAt } };
 expect(selectedProviders(snapshot, "all")).toEqual(["zerodha"]);
 expect(hasCoreCoverage(snapshot, "all", "holdings")).toBe(true);
 snapshot.configuredProviders.push("kotak");
 expect(hasCoreCoverage(snapshot, "all", "holdings")).toBe(false);
 expect(hasCoreCoverage(snapshot, "zerodha", "holdings")).toBe(true);
 snapshot.configuredProviders = [];
 expect(hasCoreCoverage(snapshot, "all", "holdings")).toBe(false);
});
