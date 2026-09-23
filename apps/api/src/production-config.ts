import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

function parseUrl(value: string, label: string) {
  try { return new URL(value); }
  catch { throw new Error(`${label} is not a valid URL`); }
}

/** Mounted secrets are loaded only in the process that needs them. */
export function loadSecretFiles(env: NodeJS.ProcessEnv = process.env) {
  for (const key of ["DATABASE_URL", "DATABASE_ADMIN_URL", "CREDENTIAL_VAULT_KEY", "INITIAL_SETUP_TOKEN", "MARKETAUX_API_TOKEN", "ALPHA_VANTAGE_API_KEY", "MASTODON_ACCESS_TOKEN"] as const) {
    const file = env[`${key}_FILE`];
    if (!file) continue;
    if (env[key]) throw new Error(`Configure ${key} or ${key}_FILE, not both`);
    env[key] = readFileSync(file, "utf8").trim();
    if (!env[key]) throw new Error(`${key}_FILE is empty`);
  }
}

export function validateProductionConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  if (env.DATABASE_ADMIN_URL || env.DATABASE_ADMIN_URL_FILE || env.APP_DATABASE_PASSWORD) {
    throw new Error("The production API must not receive migration credentials");
  }
  const database = parseUrl(env.DATABASE_URL ?? "", "DATABASE_URL");
  if (decodeURIComponent(database.username) !== "nraialgo_app") throw new Error("Production requires the restricted nraialgo_app database user");
  if (!/^[a-f0-9]{64}$/i.test(env.CREDENTIAL_VAULT_KEY ?? "")) throw new Error("A persistent 64-hex-character credential vault key is required");
  for (const key of ["FRONTEND_ORIGIN", "API_PUBLIC_ORIGIN"] as const) {
    const value = env[key];
    const origin = parseUrl(value ?? "", key);
    if (origin.protocol !== "https:" || origin.origin !== value || origin.username || origin.password) throw new Error(`${key} must be an HTTPS origin without a path`);
  }
  if (env.API_PUBLIC_ORIGIN !== env.FRONTEND_ORIGIN) throw new Error("This deployment requires same-origin frontend and API routing");
  if (env.TRUST_PROXY !== "1") throw new Error("Production requires exactly one trusted reverse-proxy hop");
}

export function databaseTlsOptions(url: string, env: NodeJS.ProcessEnv = process.env): Pick<PoolConfig, "connectionString" | "ssl"> {
  if (env.NODE_ENV !== "production") return { connectionString: url };
  const parsed = parseUrl(url, "Database connection");
  if (!env.DATABASE_CA_FILE) throw new Error("Production requires DATABASE_CA_FILE for verified database TLS");
  if (parsed.searchParams.has("sslmode") && parsed.searchParams.get("sslmode") !== "verify-full") throw new Error("Only sslmode=verify-full is allowed in production");
  // pg connection-string SSL parameters otherwise override the explicit ssl object.
  for (const key of ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"]) parsed.searchParams.delete(key);
  return { connectionString: parsed.toString(), ssl: { ca: readFileSync(env.DATABASE_CA_FILE, "utf8"), rejectUnauthorized: true } };
}
