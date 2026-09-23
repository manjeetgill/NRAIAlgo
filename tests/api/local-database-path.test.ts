import { expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// Validate path resolution without reading credentials or opening a database.
vi.mock("node:fs", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs")>(),
  existsSync: vi.fn(() => false),
}));

it("keeps local PostgreSQL configuration in the repository runtime directory", async () => {
  const actual = await vi.importActual<typeof import("../../backend/nodejs/src/database/local-database.js")>(
    "../../backend/nodejs/src/database/local-database.js",
  );
  expect(actual.readLocalPostgresConfiguration()).toBeNull();
  expect(existsSync).toHaveBeenCalledWith(
    fileURLToPath(new URL("../../.runtime/postgres-access.json", import.meta.url)),
  );
});
