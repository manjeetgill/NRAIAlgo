import { readFileSync } from "node:fs";
import pg from "pg";
import { defineConfig } from "vitest/config";

const LOCAL_TEST_DATABASE = "nraialgo_test";

function databaseUrl(base: string, database: string): string {
  const parsed = new URL(base);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/**
 * Integration tests perform migrations and delete fixture rows. They must never
 * inherit the development or production database. CI already supplies an
 * ephemeral Postgres service; local runs get a separate database in the
 * project-owned cluster.
 */
async function configureTestDatabase(): Promise<void> {
  const supplied = process.env.DATABASE_URL;
  if (supplied) {
    const name = new URL(supplied).pathname.replace(/^\//, "");
    if (process.env.CI !== "true" && !name.endsWith("_test")) {
      throw new Error("Refusing to run integration tests without a dedicated *_test DATABASE_URL.");
    }
    return;
  }

  const configPath = new URL("../../.runtime/postgres-access.json", import.meta.url);
  const local = JSON.parse(readFileSync(configPath, "utf8")) as { adminUrl: string; applicationUrl: string };
  const maintenance = new pg.Client({ connectionString: databaseUrl(local.adminUrl, "postgres") });
  await maintenance.connect();
  try {
    const existing = await maintenance.query("SELECT 1 FROM pg_database WHERE datname=$1", [LOCAL_TEST_DATABASE]);
    if (existing.rowCount === 0) await maintenance.query(`CREATE DATABASE ${LOCAL_TEST_DATABASE}`);
  } finally {
    await maintenance.end();
  }
  process.env.TEST_DATABASE_ADMIN_URL = databaseUrl(local.adminUrl, LOCAL_TEST_DATABASE);
  process.env.TEST_DATABASE_RUNTIME_PASSWORD = local.applicationUrl
    ? decodeURIComponent(new URL(local.applicationUrl).password)
    : "";
  process.env.DATABASE_URL = databaseUrl(local.applicationUrl, LOCAL_TEST_DATABASE);
}

await configureTestDatabase();

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Database integration files share migrations and a small set of fixtures.
    // Serial files keep the release gate deterministic; individual tests within
    // a file may still exercise application-level concurrency explicitly.
    fileParallelism: false,
    // *.smoke.test.ts hits real external services (NSE's live archive, and
    // would hit real broker endpoints if real credentials were supplied) --
    // excluded from the normal suite so `npm test` never depends on network
    // access or third-party uptime. Run them explicitly with `npm run test:smoke`.
    exclude: ["**/node_modules/**", "src/**/*.smoke.test.ts"],
  },
});
