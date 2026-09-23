import { afterEach, expect, it, vi } from "vitest";
import { buildServer } from "../../apps/api/src/server.js";
import type { Store } from "../../apps/api/src/database.js";
const store: Store = { transaction: vi.fn(async () => { throw new Error("Unexpected database access"); }), close: async () => {} };
afterEach(() => vi.unstubAllEnvs());
it("rejects cross-origin mutation requests before database access", async () => {
  vi.stubEnv("FRONTEND_ORIGIN", "https://app.example.test");
  const app = buildServer(store);
  try {
    for (const headers of [{ origin: "https://attacker.test" }, { "sec-fetch-site": "cross-site" }, { origin: "null" }]) {
      const response = await app.inject({ method: "POST", url: "/v1/auth/login", headers, payload: { email: "test@example.test", password: "test" } });
      expect(response.statusCode).toBe(403);
    }
    const response = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: "https://app.example.test" }, payload: {} });
    expect(response.statusCode).toBe(400);
  } finally { await app.close(); }
});
it("marks protected responses no-store including unauthenticated errors", async () => {
  const app = buildServer(store);
  try {
    const response = await app.inject({ method: "GET", url: "/v1/broker-auth/icici/account" });
    expect(response.statusCode).toBe(401);
    expect(response.headers["cache-control"]).toBe("no-store");
  } finally { await app.close(); }
});
