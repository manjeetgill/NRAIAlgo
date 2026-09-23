import { z } from "zod";
import { issueAccessCode } from "./account-access.js";
import { openDatabaseStore } from "./database/database.js";
import { readLocalPostgresConfiguration } from "./database/local-database.js";
import { loadSecretFiles } from "./production-config.js";

async function main() {
  loadSecretFiles();
  const args = process.argv.slice(2);
  const email = z.string().trim().toLowerCase().email().max(254).parse(args[args.indexOf("--email") + 1]);
  const purpose = z.enum(["invite", "reset"]).parse(args[args.indexOf("--purpose") + 1]);
  const url = process.env.DATABASE_ADMIN_URL ?? (process.env.NODE_ENV !== "production" ? readLocalPostgresConfiguration()?.adminUrl : undefined);
  if (!url) throw new Error("Administrator database connection required");
  const store = openDatabaseStore(url);
  try {
    const result = await issueAccessCode(store, email, purpose);
    console.log(`Deliver privately to ${email}. Purpose: ${purpose}. Expires: ${result.expiresAt.toISOString()}\nCode: ${result.token}`);
  } finally { await store.close(); }
}
void main().catch(() => { console.error("Unable to issue code. Check email, purpose, account eligibility, schema and administrator access."); process.exitCode = 1; });
