import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issueAccessCode, redeemAccessCode } from "./account-access.js";
import { openDatabaseStore, runDatabaseMigrations, type Store } from "./database.js";
import { readLocalPostgresConfiguration } from "./local-database.js";
import { createSession, resolveSession, setUserPassword, verifyPassword } from "./auth.js";
import { buildServer } from "./server.js";

let admin: Store;
let runtime: Store;
const emails: string[] = [];
function email() { const value = `access-${randomUUID()}@example.com`; emails.push(value); return value; }
const password = "a-new-test-passphrase-123";
beforeAll(async () => {
  const local = readLocalPostgresConfiguration();
  admin = openDatabaseStore(process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_URL ?? local?.adminUrl);
  await runDatabaseMigrations(admin, { runtimePassword: process.env.TEST_DATABASE_RUNTIME_PASSWORD ?? (process.env.DATABASE_URL ? undefined : local?.applicationPassword) });
  runtime = openDatabaseStore();
});
afterAll(async () => {
  for (const value of emails) await admin.transaction(async q => { await q("DELETE FROM account_access_codes WHERE email=$1", [value]); await q("DELETE FROM users WHERE email=$1", [value]); });
  await runtime.close(); await admin.close();
});

describe("owner-issued account access", () => {
  it("allows exactly one concurrent invitation redemption and stores only the token digest", async () => {
    const value = email();
    const code = await issueAccessCode(admin, value, "invite");
    const [saved] = await admin.transaction(q => q<{token_hash: string}>("SELECT token_hash FROM account_access_codes WHERE email=$1", [value]));
    expect(saved!.token_hash).not.toBe(code.token);
    const results = await Promise.all([1, 2].map(() => redeemAccessCode(runtime, value, "invite", code.token, password)));
    expect(results.sort()).toEqual([false, true]);
    const [user] = await runtime.transaction(q => q<{password_hash: string}>("SELECT password_hash FROM users WHERE email=$1", [value]));
    expect(await verifyPassword(password, user!.password_hash)).toBe(true);
  });
  it("rejects wrong email, wrong purpose, expiry and superseded codes", async () => {
    const value = email();
    const first = await issueAccessCode(admin, value, "invite");
    const second = await issueAccessCode(admin, value, "invite");
    expect(await redeemAccessCode(runtime, value, "invite", first.token, password)).toBe(false);
    expect(await redeemAccessCode(runtime, email(), "invite", second.token, password)).toBe(false);
    expect(await redeemAccessCode(runtime, value, "reset", second.token, password)).toBe(false);
    await admin.transaction(q => q("UPDATE account_access_codes SET expires_at=now()-interval '1 second' WHERE email=$1", [value]));
    expect(await redeemAccessCode(runtime, value, "invite", second.token, password)).toBe(false);
  });
  it("revokes sessions on reset and rejects replay", async () => {
    const value = email();
    await setUserPassword(runtime, value, password);
    const [user] = await runtime.transaction(q => q<{id: string}>("SELECT id FROM users WHERE email=$1", [value]));
    const session = await createSession(runtime, user!.id);
    const code = await issueAccessCode(admin, value, "reset");
    expect(await redeemAccessCode(runtime, value, "reset", code.token, "replacement-passphrase-456")).toBe(true);
    expect(await resolveSession(runtime, session.token)).toBeNull();
    expect(await redeemAccessCode(runtime, value, "reset", code.token, password)).toBe(false);
  });
  it("invalidates a recovery code after an administrator changes the password", async () => {
    const value = email();
    await setUserPassword(runtime, value, password);
    const code = await issueAccessCode(admin, value, "reset");
    await setUserPassword(runtime, value, "different-admin-password");
    expect(await redeemAccessCode(runtime, value, "reset", code.token, password)).toBe(false);
    await expect(issueAccessCode(admin, value, "invite")).rejects.toThrow();
    await expect(issueAccessCode(admin, email(), "reset")).rejects.toThrow();
  });
  it("prevents the runtime role from minting codes", async () => {
    await expect(issueAccessCode(runtime, email(), "invite")).rejects.toThrow(/permission denied/);
  });
  it("validates HTTP input and creates an account without automatic login", async () => {
    const value = email();
    const code = await issueAccessCode(admin, value, "invite");
    const app = buildServer(runtime);
    try {
      const bad = await app.inject({method: "POST", url: "/v1/auth/register", payload: {email: value, code: code.token, password: "short"}});
      expect(bad.statusCode).toBe(400);
      const success = await app.inject({method: "POST", url: "/v1/auth/register", payload: {email: value, code: code.token, password}});
      expect(success.statusCode).toBe(201);
      expect(success.headers["cache-control"]).toBe("no-store");
      expect(String(success.headers["set-cookie"])).not.toContain(code.token);
      const replay = await app.inject({method: "POST", url: "/v1/auth/register", payload: {email: value, code: code.token, password}});
      expect(replay.statusCode).toBe(400);
    } finally { await app.close(); }
  });
});
