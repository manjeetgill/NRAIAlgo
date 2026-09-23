import { buildServer } from "./server.js";
import { openDatabaseStore, runDatabaseMigrations, verifyRuntimeDatabase } from "./database/database.js";
import { loadSecretFiles, validateProductionConfig } from "./production-config.js";
import { readLocalPostgresConfiguration } from "./database/local-database.js";
import { seedNseCalendar, calendarCoverage } from "./market-calendar.js";

// Development bootstraps its database; production uses a separate migration
// job. The long-running API must never receive administrative credentials.
loadSecretFiles();
validateProductionConfig();
const production = process.env.NODE_ENV === "production";
const local = production ? undefined : readLocalPostgresConfiguration();
const adminUrl = process.env.DATABASE_ADMIN_URL ?? local?.adminUrl;
if (!production) {
  const migrationStore = openDatabaseStore(adminUrl);
  try {
    await runDatabaseMigrations(migrationStore, {
      runtimePassword: process.env.DATABASE_URL ? process.env.APP_DATABASE_PASSWORD : local?.applicationPassword,
    });
  } finally {
    await migrationStore.close();
  }
}

// Only after migrations have committed does the API open its own, more
// restricted connection (the nraialgo_app role, which has DML but no DDL).
const store = openDatabaseStore();
if (production) {
  try { await verifyRuntimeDatabase(store); }
  catch { await store.close(); throw new Error("Production database validation failed; check migration and restricted role setup"); }
}

// Idempotent (ON CONFLICT DO NOTHING) -- keeps a rolling window of real
// NSE/EQ session boundaries available, so the calendar the Overview screen
// actually reads from never silently runs dry. This is where the real
// "NSE"/"EQ" calendar gets populated; nothing else does.
//
// Seeded once at startup AND re-run daily (not startup-only): a
// long-running server would otherwise eventually walk past the end of its
// initial window and start reporting every subsequent day as "unknown".
// The 24h cadence is deliberately much coarser than the 90-day window --
// this is topping the window back up, not racing to seed a specific day
// before the Overview screen reads it.
const CALENDAR_SEED_WINDOW_DAYS = 90;
async function reseedCalendar() {
  try {
    await store.transaction((query) => seedNseCalendar(query, { from: new Date(Date.now() - 30 * 86_400_000), days: CALENDAR_SEED_WINDOW_DAYS + 30 }));
    const coverage = await store.transaction(query => calendarCoverage(query));
    if (coverage.status !== "ok") console.error("Exchange calendar coverage expiring; import verified sessions before the coverage ends", coverage);
  } catch (err) {
    // A failed reseed must not crash a running server -- the existing
    // window keeps serving; resolveSessionState already fails closed
    // ("unknown") once/if that window is exhausted.
    console.error("NSE calendar reseed failed:", production ? "Check database connectivity and calendar coverage" : err);
  }
}
await reseedCalendar();
setInterval(() => void reseedCalendar(), 24 * 60 * 60 * 1000).unref();

const app = buildServer(store);
// Deliberately API_PORT, not PORT: dev tooling that launches this alongside
// the frontend (e.g. a preview tool tracking frontend/nextjs's port) can set a
// generic PORT for the whole process tree, which must not also redirect
// where this server binds.
const port = Number(process.env.API_PORT ?? 4000);
// 127.0.0.1, not 0.0.0.0: nothing on the network should reach broker
// credentials/sessions/portfolio data except this host itself. Session
// auth (routes/auth.ts) now guards every data route, but this is a cheap,
// independent layer on top of that -- not a substitute for it.
// HOST opts back into 0.0.0.0 explicitly for a real multi-host deployment.
const host = process.env.HOST ?? "127.0.0.1";

app.listen({ port, host }).catch(async (err: unknown) => {
  // { err }, not a bare positional arg: pino copies a bare Error's .message
  // into the log entry's top-level `msg` field, which the production `err`
  // serializer in server.ts does not cover -- only the nested `err` key is
  // redacted. This is the only call site that isn't already { err }-shaped;
  // every other one (broker-auth.ts, health.ts) already gets this right.
  app.log.error({ err }, "Failed to start listening");
  await app.close();
  await store.close();
  process.exitCode = 1;
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void app.close().then(() => store.close());
  });
}
