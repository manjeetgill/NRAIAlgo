/** Local PostgreSQL bootstrap. Uses a project-owned cluster on loopback port 55433
 * (AlgoTrade's sibling project already owns 55432), so this never touches a
 * Homebrew-wide database or requires Docker. Connection settings live in the
 * gitignored .runtime/ directory; production reads its connection string from an
 * environment variable instead, so this module is dev/test-only.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import pg from "pg";

const projectRoot = fileURLToPath(
  // src/database and dist/database have identical depth in the Node.js workspace.
  new URL("../../../../", import.meta.url),
);
const runtimeDirectory = resolve(projectRoot, ".runtime");
const configurationPath = resolve(runtimeDirectory, "postgres-access.json");
const clusterDirectory = resolve(runtimeDirectory, "postgres");

export interface LocalPostgresConfiguration {
  adminUrl: string;
  applicationUrl: string;
  applicationPassword: string;
  port: number;
}

/** Read the local connection file. Local-only, so it is plaintext behind 0600/0700
 * permissions rather than encrypted at rest -- see the module comment. */
export function readLocalPostgresConfiguration(): LocalPostgresConfiguration | null {
  if (!existsSync(configurationPath)) {
    return null;
  }
  if (
    !lstatSync(configurationPath).isFile() ||
    lstatSync(configurationPath).isSymbolicLink()
  ) {
    throw new Error("Local database configuration must be a regular file.");
  }
  chmodSync(configurationPath, 0o600);
  const config = JSON.parse(
    readFileSync(configurationPath, "utf8"),
  ) as LocalPostgresConfiguration;
  if (
    !config.adminUrl ||
    !config.applicationUrl ||
    !config.applicationPassword ||
    !Number.isInteger(config.port)
  ) {
    throw new Error("Invalid local PostgreSQL configuration.");
  }
  return config;
}

function saveLocalConfiguration(config: LocalPostgresConfiguration) {
  writeFileSync(configurationPath, JSON.stringify(config, null, 2), {
    flag: "wx",
    mode: 0o600,
    flush: true,
  });
}

/** Resolve installed PostgreSQL tools; PG_BIN can point at another local installation. */
function postgresBinaryDirectory(): string {
  const directory = [
    process.env.PG_BIN,
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/lib/postgresql/17/bin",
  ].find((path) => path && existsSync(resolve(path, "pg_ctl")));
  if (!directory) {
    throw new Error(
      "Install PostgreSQL 17 (macOS: brew install postgresql@17), or set PG_BIN.",
    );
  }
  return directory;
}

/** Run a PostgreSQL utility without shell interpolation. Optional passwords travel via stdin only.
 * With no LANG/LC_ALL set, macOS's directory-services locale lookup can spawn threads before
 * postgres forks, which postgres refuses ("postmaster became multithreaded during startup") --
 * pin a plain locale so this starts reliably regardless of the caller's shell environment.
 */
function runPostgresUtility(name: string, args: string[], input?: string) {
  const result = spawnSync(resolve(postgresBinaryDirectory(), name), args, {
    input,
    encoding: "utf8",
    timeout: 45000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, LANG: "C", LC_ALL: "C" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `PostgreSQL ${name} failed. Check .runtime/postgres.log and the configured local port.`,
    );
  }
}

async function isPostgresReachable(adminUrl: string): Promise<boolean> {
  const client = new pg.Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 1000,
  });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Start only this project's cluster and create its app database if missing; return
 * connection settings. PostgreSQL keeps running after the process exits -- call
 * stopLocalPostgres() (or `npm run db:stop --workspace backend/nodejs`) to stop it. */
export async function ensureLocalPostgres(): Promise<LocalPostgresConfiguration> {
  mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  let config = readLocalPostgresConfiguration();
  if (!config) {
    const adminPassword = randomBytes(32).toString("hex"),
      applicationPassword = randomBytes(32).toString("hex"),
      port = 55433;
    config = {
      adminUrl: `postgresql://nraialgo_admin:${adminPassword}@127.0.0.1:${port}/nraialgo`,
      applicationUrl: `postgresql://nraialgo_app:${applicationPassword}@127.0.0.1:${port}/nraialgo`,
      applicationPassword,
      port,
    };
    saveLocalConfiguration(config);
  }
  if (!existsSync(resolve(clusterDirectory, "PG_VERSION"))) {
    const password = decodeURIComponent(new URL(config.adminUrl).password);
    runPostgresUtility(
      "initdb",
      [
        "-D",
        clusterDirectory,
        "-U",
        "nraialgo_admin",
        "--encoding=UTF8",
        "--no-locale",
        "--auth-local=scram-sha-256",
        "--auth-host=scram-sha-256",
        "--pwfile=/dev/stdin",
      ],
      `${password}\n`,
    );
  }
  const adminUrl = new URL(config.adminUrl);
  adminUrl.pathname = "/postgres";
  if (!(await isPostgresReachable(adminUrl.toString()))) {
    runPostgresUtility("pg_ctl", [
      "-D",
      clusterDirectory,
      "-l",
      resolve(runtimeDirectory, "postgres.log"),
      "-o",
      `-h 127.0.0.1 -p ${config.port} -k ${runtimeDirectory}`,
      "-w",
      "-t",
      "30",
      "start",
    ]);
  }
  const client = new pg.Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    if (
      !(
        await client.query(
          "SELECT datname FROM pg_database WHERE datname='nraialgo'",
        )
      ).rows.length
    ) {
      await client.query("CREATE DATABASE nraialgo");
    }
  } finally {
    await client.end();
  }
  return config;
}

/** Stop only this project's cluster; never touch another PostgreSQL service on the machine. */
export function stopLocalPostgres() {
  if (existsSync(resolve(clusterDirectory, "PG_VERSION"))) {
    runPostgresUtility("pg_ctl", [
      "-D",
      clusterDirectory,
      "-m",
      "fast",
      "-w",
      "stop",
    ]);
  }
}

async function runLocalDatabaseCommand() {
  if (process.argv.includes("--stop")) {
    stopLocalPostgres();
    return;
  }
  const config = await ensureLocalPostgres();
  const { openDatabaseStore, runDatabaseMigrations } = await import(
    "./database.js"
  );
  const store = openDatabaseStore(config.adminUrl);
  try {
    await runDatabaseMigrations(store, {
      runtimePassword: config.applicationPassword,
    });
  } finally {
    await store.close();
  }
  console.debug(`Local PostgreSQL ready on 127.0.0.1:${config.port}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  setImmediate(
    () =>
      void runLocalDatabaseCommand().catch((error) => {
        console.error(
          error instanceof Error
            ? error.message
            : "Local PostgreSQL startup failed.",
        );
        process.exitCode = 1;
      }),
  );
}
