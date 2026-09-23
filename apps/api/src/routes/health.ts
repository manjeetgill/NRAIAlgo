import type { FastifyInstance } from "fastify";
import type { Store } from "../database.js";

/**
 * Liveness check only.
 *
 * This must never depend on Postgres, Redis, or any other downstream
 * service. It only proves the process is up and accepting requests --
 * that's what a load balancer or orchestrator uses to decide whether to
 * route traffic here at all. Downstream health (this file's other route,
 * /v1/readiness) belongs on a separate route since those dependencies exist.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
}

/**
 * Readiness check: proves the database is actually reachable and reports
 * which schema_migrations version it's on, so a deploy can be verified
 * against "did the migration I expect actually run" rather than just
 * "is the process alive." Deliberately public (no session exists before a
 * deployment can even be checked) and carries no account/business data.
 */
export function readinessRoutes(store: Store) {
  return async function routes(app: FastifyInstance): Promise<void> {
    app.get("/v1/readiness", async (request, reply) => {
      try {
        const [row] = await store.transaction((query) =>
          query<{ max: number | null }>("SELECT MAX(version) as max FROM schema_migrations"),
        );
        return { status: "ok", schemaVersion: row?.max ?? null };
      } catch (error) {
        request.log.error({ err: error }, "Readiness check: database unreachable");
        return reply.code(503).send({ status: "unavailable", schemaVersion: null });
      }
    });
  };
}
