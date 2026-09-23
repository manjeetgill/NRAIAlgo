import { readFileSync } from "node:fs";
import { openDatabaseStore, verifyRuntimeDatabase } from "./database.js";
import { importCalendar } from "../market-calendar.js";
import { loadSecretFiles } from "../production-config.js";

async function main() {
  loadSecretFiles();
  const file = process.argv[2];
  if (!file) throw new Error("Provide a verified calendar JSON file");
  const data: unknown = JSON.parse(readFileSync(file, "utf8"));
  const store = openDatabaseStore();
  try {
    if (process.env.NODE_ENV === "production") await verifyRuntimeDatabase(store);
    await store.transaction(query => importCalendar(query, data));
    console.log("Verified calendar import committed");
  } finally { await store.close(); }
}
void main().catch(() => { console.error("Calendar import failed; check JSON, session boundaries and database access"); process.exitCode=1; });
