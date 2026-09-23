import { openDatabaseStore, runDatabaseMigrations } from "./database.js";
import { loadSecretFiles } from "./production-config.js";

loadSecretFiles();
if (!process.env.DATABASE_ADMIN_URL) throw new Error("DATABASE_ADMIN_URL_FILE is required for the one-off migration");
const store = openDatabaseStore(process.env.DATABASE_ADMIN_URL);
try {
  await runDatabaseMigrations(store, { runtimeRole: "nraialgo_app" });
  console.log("Database migrations and runtime grants are ready.");
} catch {
  console.error("Migration failed. Check database permissions, connectivity and the CA certificate.");
  process.exitCode = 1;
} finally {
  await store.close();
}
