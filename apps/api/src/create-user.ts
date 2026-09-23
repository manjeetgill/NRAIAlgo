/** CLI to create (or reset the password of) an app user.
 *
 * There is deliberately no public signup endpoint: this is a single-operator
 * app, not a multi-tenant product, so exposing account creation over HTTP
 * would just be unnecessary attack surface. An operator with database
 * access runs this instead.
 *
 * Usage: npm run create-user --workspace apps/api -- --email you@example.com --password 'a strong password'
 */
import { openDatabaseStore, runDatabaseMigrations, verifyRuntimeDatabase } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { setUserPassword } from "./auth.js";
import { loadSecretFiles } from "./production-config.js";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  loadSecretFiles();
  const email = readArg("email")?.trim().toLowerCase();
  let password = readArg("password");
  if (process.env.NODE_ENV === "production" && password) throw new Error("Use --password-stdin in production; never put passwords in arguments");
  if (process.argv.includes("--password-stdin")) {
    let input = "";
    for await (const chunk of process.stdin) { input += chunk.toString(); if (input.length > 1024) throw new Error("Password input too long"); }
    password = input.replace(/[\r\n]+$/, "");
  }
  if (!email || !password) {
    console.error("Usage: --email <email> --password-stdin (production) or --password <password> (development)");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const local = process.env.NODE_ENV === "production" ? undefined : readLocalPostgresConfiguration();
  const url = process.env.DATABASE_URL ?? local?.adminUrl;
  const store = openDatabaseStore(url);
  try {
    if (process.env.NODE_ENV === "production") await verifyRuntimeDatabase(store);
    if (process.env.NODE_ENV !== "production") await runDatabaseMigrations(store, {
      runtimePassword: process.env.DATABASE_URL ? undefined : local?.applicationPassword,
    });
    await setUserPassword(store, email, password);
    console.log(`User ${email} is ready.`);
  } finally {
    await store.close();
  }
}

void main().catch(() => { console.error("User setup failed. Check arguments, database access and schema; no credentials were logged."); process.exitCode = 1; });
