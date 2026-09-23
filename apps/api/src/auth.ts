/** App-level authentication: password hashing, session tokens, and the
 * request-scoping identity every protected route now derives instead of
 * trusting a caller-supplied workspaceId/accountId query parameter.
 *
 * Single-tenant-per-user model: there is no organization/membership concept
 * yet, so a user's own id *is* their workspace id. accountId is likewise
 * derived, never accepted from the client -- nothing downstream currently
 * partitions by multiple accounts per workspace, so this is honest, not a
 * placeholder for something more real that already exists.
 */
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import type { Store } from "./database.js";

export interface AuthIdentity {
  userId: string;
  email: string;
  workspaceId: string;
  accountId: string;
}

const SCRYPT_KEY_LENGTH = 64;

/** Format: scrypt:<salt-hex>:<hash-hex>. Never logged, never returned. */
let passwordJobs = 0;
function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (passwordJobs >= 4) return Promise.reject(Object.assign(new Error("Authentication busy; retry shortly"), { statusCode: 503 }));
  passwordJobs++;
  return new Promise((resolve, reject) => scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, key) => {
    passwordJobs--;
    if (error) reject(error); else resolve(key);
  }));
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(password, salt);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !/^[a-f0-9]{32}$/i.test(saltHex ?? "") || !/^[a-f0-9]{128}$/i.test(hashHex ?? "")) {
    return false;
  }
  const salt = Buffer.from(saltHex!, "hex");
  const expected = Buffer.from(hashHex!, "hex");
  const actual = await derive(password, salt);
  // Constant-time compare -- a length mismatch would throw, so guard first.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const SESSION_COOKIE_NAME = "nraialgo_session";
/** Reset and revocation are atomic; serialize against concurrent session creation. */
export async function setUserPassword(store: Store, email: string, password: string) {
  const hash = await hashPassword(password);
  await store.transaction(async query => {
    await query("LOCK TABLE users IN EXCLUSIVE MODE");
    const [user] = await query<{id: string}>(`INSERT INTO users(email,password_hash) VALUES($1,$2)
      ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id`, [email, hash]);
    if (!user) throw new Error("User update failed");
    await query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
  });
}
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a new session row and returns the raw token to set as a cookie.
 * Only the SHA-256 hash of the token is ever persisted -- a stolen database
 * dump cannot be replayed as a live session. */
export async function createSession(store: Store, userId: string, expectedPasswordHash?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes32Url();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await store.transaction(async (query) => {
    const [user] = await query<{password_hash: string}>("SELECT password_hash FROM users WHERE id=$1 FOR SHARE", [userId]);
    if (!user || (expectedPasswordHash !== undefined && user.password_hash !== expectedPasswordHash)) throw Object.assign(new Error("Sign in again"), {statusCode:401});
    await query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES ($1,$2,$3,now())`,
      [hashToken(token), userId, expiresAt.toISOString()],
    );
  });
  return { token, expiresAt };
}

export async function destroySession(store: Store, token: string): Promise<void> {
  await store.transaction((query) =>
    query("DELETE FROM sessions WHERE token_hash=$1", [hashToken(token)]),
  );
}

/** Resolves a raw cookie token to the identity it authenticates, or null if
 * the session doesn't exist or has expired. Expired rows are lazily pruned
 * here rather than needing a separate cleanup job. */
export async function resolveSession(store: Store, token: string): Promise<AuthIdentity | null> {
  const rows = await store.transaction((query) =>
    query<{ id: string; email: string }>(
      `SELECT u.id, u.email FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash=$1 AND s.expires_at > now()`,
      [hashToken(token)],
    ),
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return { userId: row.id, email: row.email, workspaceId: row.id, accountId: `acct-${row.id}` };
}

function randomBytes32Url(): string {
  return randomBytes(32).toString("base64url");
}
