// All database integration tests run against a new, disposable Docker cluster.
// Application database URLs, secret files and local .runtime files are never read.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
const [selection = "all", ...filters] = process.argv.slice(2);
const projects = selection === "all" ? ["api", "contracts", "web"] : [selection];
if (projects.some(name => !["api", "contracts", "web", "smoke"].includes(name))) {
  throw new Error("Choose all, api, contracts, web, or smoke.");
}
const env = { ...process.env, NODE_ENV: "test" };
for (const key of Object.keys(env)) {
  if (/^(DATABASE_|TEST_DATABASE_|APP_DATABASE_|PG|CREDENTIAL_VAULT_|INITIAL_SETUP_TOKEN)/.test(key)) delete env[key];
}
let container;
let child;
let stopping = false;
const docker = args => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).trim();
function cleanup() {
  if (!container) return;
  const target = container;
  container = undefined;
  try { docker(["rm", "--force", "--volumes", target]); }
  catch { console.error(`Could not remove disposable test container ${target}. Remove it with docker rm -fv ${target}.`); process.exitCode = 1; }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  stopping = true;
  child?.kill(signal);
  cleanup();
  process.exit(signal === "SIGINT" ? 130 : 143);
});
try {
  if (projects.includes("api")) {
    container = `nraialgo-tests-${randomUUID()}`;
    const password = randomBytes(24).toString("hex");
    console.log("Starting disposable PostgreSQL for tests (no application data or volumes).");
    // Use tmpfs: fixture writes exist only inside this isolated container.
    docker(["run", "--detach", "--rm", "--name", container,
      "--label", "nraialgo.purpose=isolated-tests",
      "--publish", "127.0.0.1::5432", "--tmpfs", "/var/lib/postgresql/data",
      "--env", "POSTGRES_DB=nraialgo_test", "--env", "POSTGRES_USER=test_admin",
      "--env", `POSTGRES_PASSWORD=${password}`, "postgres:17"]);
    let ready = false;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      try { docker(["exec", container, "pg_isready", "-U", "test_admin", "-d", "nraialgo_test"]); ready = true; break; }
      catch { await delay(500); }
    }
    if (!ready) throw new Error("Disposable PostgreSQL failed to start.");
    const binding = docker(["port", container, "5432/tcp"]);
    if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error("Test database must bind only to localhost.");
    env.TEST_DATABASE_ADMIN_URL = `postgresql://test_admin:${password}@${binding}/nraialgo_test`;
    env.TEST_DATABASE_RUNTIME_PASSWORD = randomBytes(24).toString("hex");
    env.DATABASE_URL = `postgresql://nraialgo_app:${env.TEST_DATABASE_RUNTIME_PASSWORD}@${binding}/nraialgo_test`;
    env.NRAIALGO_TEST_DATABASE = container;
  }
  const args = [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--config", "tests/vitest.config.ts",
    ...projects.flatMap(name => ["--project", name]), ...filters];
  child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
} catch (error) {
  // Do not echo Docker argv: they contain the disposable password.
  console.error(error instanceof Error && !('stderr' in error) ? error.message : "Test runner could not start. Ensure Docker is running and postgres:17 is available.");
  process.exitCode = 1;
} finally { cleanup(); }
