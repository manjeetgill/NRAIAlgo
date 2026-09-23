/** CLI to create (or reset the password of) an app user.
 *
 * There is deliberately no public signup endpoint: this is a single-operator
 * app, not a multi-tenant product, so exposing account creation over HTTP
 * would just be unnecessary attack surface. An operator with database
 * access runs this instead.
 *
 * Usage: npm run create-user --workspace apps/api -- --email you@example.com --password 'a strong password'
 */
import { openDatabaseStore, runDatabaseMigrations } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { hashPassword } from "./auth.js";

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const email = readArg("email")?.trim().toLowerCase();
  const password = readArg("password");
  if (!email || !password) {
    console.error("Usage: --email <email> --password <password>");
    process.exitCode = 1;
    return;
  }
  if (password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exitCode = 1;
    return;
  }

  const local = readLocalPostgresConfiguration();
  const url = process.env.DATABASE_URL ?? local?.adminUrl;
  const store = openDatabaseStore(url);
  try {
    await runDatabaseMigrations(store, {
      runtimePassword: process.env.DATABASE_URL ? undefined : local?.applicationPassword,
    });
    const passwordHash = hashPassword(password);
    await store.transaction((query) =>
      query(
        `INSERT INTO users (email, password_hash) VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash`,
        [email, passwordHash],
      ),
    );
    console.log(`User ${email} is ready.`);
  } finally {
    await store.close();
  }
}

void main();
