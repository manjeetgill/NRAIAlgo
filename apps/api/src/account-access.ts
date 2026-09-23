import { createHash, randomBytes } from "node:crypto";
import type { Store } from "./database.js";
import { hashPassword } from "./auth.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export type AccessPurpose = "invite" | "reset";

/** Offline admin operation only; never expose code issuance to anonymous HTTP. */
export async function issueAccessCode(store: Store, email: string, purpose: AccessPurpose) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + (purpose === "reset" ? 30 * 60_000 : 24 * 60 * 60_000));
  await store.transaction(async query => {
    await query("LOCK TABLE users IN EXCLUSIVE MODE");
    const [user] = await query<{password_hash: string}>("SELECT password_hash FROM users WHERE email=$1", [email]);
    if (purpose === "invite" ? !!user : !user) throw new Error("Account is not eligible for this code type");
    await query(`INSERT INTO account_access_codes(token_hash,email,purpose,password_version,expires_at)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(email,purpose) DO UPDATE SET
      token_hash=EXCLUDED.token_hash,password_version=EXCLUDED.password_version,expires_at=EXCLUDED.expires_at,created_at=now()`,
    [digest(token), email, purpose, user ? digest(user.password_hash) : null, expiresAt.toISOString()]);
  });
  return { token, expiresAt };
}

export async function redeemAccessCode(store: Store, email: string, purpose: AccessPurpose, token: string, password: string) {
  const passwordHash = await hashPassword(password);
  return store.transaction(async query => {
    // Same lock order as password reset/setup prevents replay and login/reset races.
    await query("LOCK TABLE users IN EXCLUSIVE MODE");
    const [code] = await query<{password_version: string | null}>(`DELETE FROM account_access_codes
      WHERE token_hash=$1 AND email=$2 AND purpose=$3 AND expires_at > now() RETURNING password_version`, [digest(token), email, purpose]);
    if (!code) return false;
    const [user] = await query<{id: string; password_hash: string}>("SELECT id,password_hash FROM users WHERE email=$1", [email]);
    if (purpose === "invite") {
      if (user) return false;
      await query("INSERT INTO users(email,password_hash) VALUES($1,$2)", [email, passwordHash]);
    } else {
      if (!user || digest(user.password_hash) !== code.password_version) return false;
      await query("UPDATE users SET password_hash=$1 WHERE id=$2", [passwordHash, user.id]);
      await query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
    }
    await query("DELETE FROM account_access_codes WHERE email=$1", [email]);
    return true;
  });
}
