import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "../database/database.js";
import type { credentialVault } from "../credential-vault.js";
import { requireAuth } from "./auth.js";
import { iciciCredentials } from "../broker-auth/icici.js";

const zerodhaCredentials = z
  .object({
    apiKey: z.string().trim().min(1).max(256),
    apiSecret: z.string().trim().min(16).max(128),
  })
  .strict();

const kotakCredentials = z
  .object({
    accessToken: z.string().trim().min(8).max(4096),
    mobileNumber: z.string().trim().regex(/^\+91[0-9]{10}$/),
    ucc: z.string().trim().min(1).max(32),
  })
  .strict();

const PROVIDER_SCHEMAS = { zerodha: zerodhaCredentials, kotak: kotakCredentials, icici: iciciCredentials } as const;
type Provider = keyof typeof PROVIDER_SCHEMAS;

/**
 * Setup-only (step 1). This persists app-level credentials encrypted at
 * rest; it never authenticates against Zerodha/Kotak's own servers and
 * never issues a broker session -- that is step 2 (daily authorization),
 * which still requires the actual OAuth/session-login adapter (build order
 * step 4) and is not implemented here.
 *
 * workspaceId comes from the authenticated session (request.auth, set by
 * requireAuth), never from a client-supplied query parameter -- otherwise
 * any caller could write or read any other workspace's credential status.
 */
export function brokerCredentialsRoutes(store: Store, vault: ReturnType<typeof credentialVault>) {
  return async function routes(app: FastifyInstance): Promise<void> {
    app.addHook("preHandler", requireAuth(store));

    app.post<{ Params: { provider: string } }>(
      "/v1/broker-credentials/:provider",
      // Writes encrypted app credentials -- tighter than the global default
      // so a script can't hammer this trying provider combinations.
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const provider = request.params.provider;
        if (!Object.hasOwn(PROVIDER_SCHEMAS, provider)) {
          return reply.badRequest("Unknown broker provider.");
        }
        const body = PROVIDER_SCHEMAS[provider as Provider].safeParse(request.body);
        if (!body.success) {
          return reply.badRequest("Invalid credentials for this provider.");
        }
        const workspaceId = request.auth!.workspaceId;
        const context = `${workspaceId}:${provider}`;
        const ciphertext = vault.seal(context, body.data);
        await store.transaction(async (query) => {
          await query(
            `INSERT INTO broker_app_credentials (workspace_id, provider, ciphertext, updated_at)
             VALUES ($1,$2,$3,now())
             ON CONFLICT (workspace_id, provider)
             DO UPDATE SET ciphertext=EXCLUDED.ciphertext, updated_at=now()`,
            [workspaceId, provider, ciphertext],
          );
          // An old session must never be paired with a newly configured broker app.
          await query("DELETE FROM broker_sessions WHERE workspace_id=$1 AND provider=$2", [workspaceId, provider]);
        });
        return reply.code(204).send();
      },
    );

    /** Whether each provider has saved credentials -- never the credentials themselves. */
    app.get("/v1/broker-credentials/status", async (request) => {
      const workspaceId = request.auth!.workspaceId;
      const rows = await store.transaction((query) =>
        query<{ provider: string; updated_at: string }>(
          "SELECT provider, updated_at FROM broker_app_credentials WHERE workspace_id=$1",
          [workspaceId],
        ),
      );
      const status = Object.fromEntries(
        Object.keys(PROVIDER_SCHEMAS).map((provider) => [
          provider,
          rows.find((row) => row.provider === provider)?.updated_at ?? null,
        ]),
      );
      return status;
    });
  };
}
