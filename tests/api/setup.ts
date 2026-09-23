import { vi } from "vitest";

// Fail closed when invoked directly, even in CI. Only the runner provisions
// these ephemeral credentials; there is no application-DB fallback.
if (!process.env.NRAIALGO_TEST_DATABASE?.startsWith("nraialgo-tests-") ||
    !process.env.TEST_DATABASE_ADMIN_URL || !process.env.DATABASE_URL) {
  throw new Error("Run API tests with npm test or npm run test:api; a disposable database is required.");
}

vi.mock("../../apps/api/src/local-database.js", () => ({
  readLocalPostgresConfiguration() { throw new Error("Tests cannot read application database configuration."); },
}));

vi.mock("pg", async importOriginal => {
  const actual = await importOriginal<typeof import("pg")>();
  const allowed = new Set([process.env.DATABASE_URL, process.env.TEST_DATABASE_ADMIN_URL]);
  const guard = (options?: { connectionString?: string | undefined }) => {
    if (!options?.connectionString || !allowed.has(options.connectionString)) {
      throw new Error("Tests can connect only to their disposable database.");
    }
  };
  class Pool extends actual.default.Pool {
    constructor(options?: import("pg").PoolConfig) { guard(options); super(options); }
  }
  class Client extends actual.default.Client {
    constructor(options?: import("pg").ClientConfig) { guard(options); super(options); }
  }
  return { ...actual, Pool, Client, default: { ...actual.default, Pool, Client } };
});
