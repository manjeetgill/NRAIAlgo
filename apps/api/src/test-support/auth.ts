/** Shared test helper: creates (or reuses) a test user, logs in through the
 * real /v1/auth/login route, and returns the session cookie header plus the
 * workspaceId that session resolves to (= the user's id) -- every protected
 * route test needs this instead of a bare workspaceId query parameter now. */
import type { FastifyInstance } from "fastify";
import type { Store } from "../database.js";
import { hashPassword } from "../auth.js";

const TEST_PASSWORD = "correct horse battery staple 42";

export async function loginTestUser(
  app: FastifyInstance,
  store: Store,
  email: string,
): Promise<{ cookie: string; workspaceId: string }> {
  const rows = await store.transaction((query) =>
    query<{ id: string }>(
      `INSERT INTO users (email, password_hash) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash
       RETURNING id`,
      [email, hashPassword(TEST_PASSWORD)],
    ),
  );
  const workspaceId = rows[0]?.id;
  if (!workspaceId) {
    throw new Error(`Could not create test user ${email}`);
  }
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password: TEST_PASSWORD },
  });
  const sessionCookie = response.cookies.find((cookie) => cookie.name === "nraialgo_session");
  if (response.statusCode !== 200 || !sessionCookie) {
    throw new Error(`Test login for ${email} failed unexpectedly (HTTP ${response.statusCode})`);
  }
  return { cookie: `${sessionCookie.name}=${sessionCookie.value}`, workspaceId };
}
