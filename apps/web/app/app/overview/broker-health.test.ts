import { expect, it } from "vitest";
import { OVERVIEW_SNAPSHOT_FIXTURES } from "@nraialgo/contracts";
import { brokerHealth } from "./broker-health";
it("separates configuration, authorization, portfolio and order health", () => {
 const snapshot=structuredClone(OVERVIEW_SNAPSHOT_FIXTURES["market-open"]);
 snapshot.configuredProviders=["zerodha"];
 snapshot.authorizedProviders=[];
 snapshot.connections.data=[];
 snapshot.brokerReconciliation={};
 expect(brokerHealth(snapshot,"kotak")).toBe("Not configured");
 expect(brokerHealth(snapshot,"zerodha")).toBe("Authorization required");
 snapshot.authorizedProviders=["zerodha"];
 expect(brokerHealth(snapshot,"zerodha")).toBe("Authorized · awaiting data");
 snapshot.brokerReconciliation.zerodha={status:"confirmed",accountId:"Z1",asOf:snapshot.generatedAt};
 delete snapshot.brokerOrders;
 expect(brokerHealth(snapshot,"zerodha")).toBe("Partially connected");
 expect(brokerHealth(snapshot,"zerodha",true)).toBe("Degraded");
});
