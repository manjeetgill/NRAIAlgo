# DigitalOcean deployment

This is a single-operator, single-API deployment for the implemented read-only
broker dashboard. It does not enable order execution or claim high availability.
Never scale the API above one instance: live-feed ownership and caches are
process-local. Run heavy backtests elsewhere during market hours.

## Buy and configure

- Ubuntu 24.04 LTS x64 Droplet, initially 4 vCPU / 8 GB, Bangalore (BLR1).
- Managed PostgreSQL in the same region/VPC, initially 1 vCPU / 2 GB.
  Use a dedicated database for this app, not a database shared with other apps.
- SSH keys, daily Droplet backups, database backups and monitoring alerts.
- A domain/subdomain with an A record pointing at the Droplet. Do not add an AAAA
  record unless IPv6 is configured. Start with DNS-only routing, without another proxy.
- Cloud Firewall: public TCP 80/443; SSH only from your administrator IPs.
  Do not publish API 4000, web 3010 or database ports. Allow necessary outbound
  HTTPS, DNS, time synchronization and the managed database's connection port.
- Database trusted sources: only the Droplet/private VPC sources required by this
  deployment, not all public IPs. Use its private hostname and downloaded CA.

Install Docker Engine, Buildx and the Compose plugin using the
[official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
Do not rely on UFW alone for Docker-published ports; enforce the Cloud Firewall.
Clone the repository on the Droplet. Keep the checkout and secrets accessible
only to the deployment operator/root. Docker access is effectively root access.

## Database and secrets (operator action required)

Create the dedicated database and the `nraialgo_app` user through the DigitalOcean
database console. Keep the administrative user separate. The migration job owns
schema changes and grants runtime DML access; the API rejects elevated runtime
roles or incompatible schemas. The app user must not own the database/schema,
inherit an administrator role, or have CREATE on the public schema.

In `deploy/digitalocean`, copy `.env.example` to `.env` and set:

| Setting | Value |
| --- | --- |
| APP_DOMAIN | Your actual hostname, without scheme/path |
| ACME_EMAIL | Your certificate contact email |
| RELEASE_TAG | An immutable release identifier, normally the committed Git revision |

The Compose configuration sets both public origins to `https://APP_DOMAIN` and
uses exactly one trusted proxy hop. Never put passwords in `.env`, build arguments
or committed files. Create the following files with a secure editor or secret
manager, without printing their contents:

| File under `deploy/digitalocean/secrets/` | Contents / consumer |
| --- | --- |
| database-url | PostgreSQL URL using `nraialgo_app`; API and user-bootstrap command |
| database-admin-url | Administrative PostgreSQL URL; migration job only |
| database-ca.crt | Downloaded managed PostgreSQL CA certificate; all DB clients |
| vault-key | Persistent 32-byte key encoded as 64 hex characters; API only |

Percent-encode special characters in database URL usernames/passwords. Use
`sslmode=verify-full` (or omit it: verified TLS is enforced regardless). Other
sslmode values are rejected. CA verification must never be disabled.
`APP_DATABASE_PASSWORD` is not needed here: provision the user in DigitalOcean;
the migration only grants permissions. Neither it nor administrative credentials
may be supplied to the running API.

For a NEW database, generate the vault key directly into the protected file:

```bash
mkdir -p secrets
chmod 700 secrets
umask 077
# Run only if vault-key does not exist. Never overwrite an existing vault key.
( set -o noclobber; openssl rand -hex 32 > secrets/vault-key )
```

Container processes run as UID/GID 1000. After creating all four files, arrange
read access for that UID without making them world-readable:

```bash
sudo chown 1000:1000 secrets/database-url secrets/database-admin-url secrets/database-ca.crt secrets/vault-key
sudo chmod 0400 secrets/database-url secrets/database-admin-url secrets/database-ca.crt secrets/vault-key
```

File-backed Compose secrets are read-only mounts, not an encrypted secret store.
Protect the host and backups accordingly. Preserve the existing vault key if
importing encrypted records; otherwise re-enter broker credentials intentionally.
Back up this key separately from PostgreSQL, encrypted and off-host. Losing it
means stored broker credentials and sessions cannot be decrypted.

## First deployment

Before publishing a release, run `npm ci`, `npm audit --omit=dev --audit-level=moderate`,
and the CI checks from the committed checkout. The root dependency override pins
Kite Connect's transitive `mocha > serialize-javascript` to 7.0.5, fixing
GHSA-5c6j-r48x-rmvq and GHSA-qj8w-gfj5-8c6v without downgrading the broker SDK.
Keep this override until Kite's dependency tree resolves to a patched serializer;
do not use `npm audit fix --force` to downgrade Kite automatically.

Run from `deploy/digitalocean` after all files above exist:

```bash
docker compose --env-file .env config --quiet
docker compose --env-file .env build api web
docker compose --env-file .env run --rm --no-deps migrate
```

Do not continue if migration exits nonzero. It waits for SQL to finish under an
advisory lock; it never starts an API process. Database reachability is required
at migration time. Runtime startup checks the schema rather than re-running DDL.

### Option A: first-user screen

After migrations, create a random setup key in a protected file (only for a new
installation; never overwrite an existing file):

```bash
( umask 077; set -o noclobber; openssl rand -hex 32 > secrets/initial-setup-token )
sudo chown 1000:1000 secrets/initial-setup-token
sudo chmod 0400 secrets/initial-setup-token
docker compose --env-file .env -f compose.yml -f compose.setup.yml up -d --wait api web caddy
```

Read the key through your secure operator tooling and visit `/login` over HTTPS.
On an empty database, it shows **Create your first workspace user**, with email,
password, confirmation and setup key. After creation, sign in normally. The API
locks user creation transactionally and refuses setup once any user exists.
This is not public signup and cannot reset an existing user's password.
Remove the key from the running API after setup:

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate api
```

For local development, supply `INITIAL_SETUP_TOKEN` (32–256 characters; generate
32 random bytes) to the API process, or `INITIAL_SETUP_TOKEN_FILE` pointing to a
protected file, and restart it. Never use a `NEXT_PUBLIC_` variable or commit the
key. With no configured key, browser setup is disabled. Existing users always
see the usual sign-in form; use the CLI below for additional users or recovery.

### Option B: operator CLI

Create the first user with a password on stdin, never in argv/history. Use Bash:

```bash
read -r -s -p 'New application password: ' app_password
printf '\n'
printf '%s' "$app_password" | docker compose --env-file .env run --rm -T --no-deps admin --email you@example.com --password-stdin
unset app_password
docker compose --env-file .env up -d --wait api web caddy
```

Passwords must have at least 12 characters. This command also resets the password
if the email already exists. It runs compiled JavaScript without development
dependencies and does not run migrations. It is not a public signup endpoint.

Caddy obtains/renews public TLS certificates once DNS and ports are correct.
Its certificate storage persists in named volumes. Never use `down -v` on a
running deployment. Only Caddy exposes public ports; broker SDK children have no
network listener. No real broker secrets are included in images.

## Broker registration and acceptance checks

1. In Kite Connect's developer console, set the exact redirect URL to
   `https://YOUR_HOST/v1/broker-auth/zerodha/callback`. Changing an environment
   variable does not update broker registration. Development localhost and
   production registrations must be managed deliberately.
2. Kotak uses TOTP login then MPIN validation, not a Zerodha-style OAuth callback.
   Verify the production API subscription, TOTP registration and any account/IP
   restrictions in your broker console. Do not copy an invented callback URL.
3. Visit `/login` over HTTPS and sign in. Check the session cookie is Secure and
   HttpOnly. `/v1/overview` without authentication must return 401.
4. `/v1/readiness` must return 200 with the release schema version (currently 12).
   `/dev/overview-playground` must not expose a production preview.
5. Save credentials through the authenticated broker UI, then explicitly
   authorize each broker. Do not paste credentials into commands/logs.
6. Verify both accounts, positions and margins against broker portals. During an
   open session check fresh ticks and P&L estimates; after close verify honest
   timestamps/stale states. Do not place orders as a deployment smoke test.
7. Restart the API and confirm login/data recovery, then test loss and restoration
   of connectivity in a non-trading environment. No screen should invent data.

## Updates, rollback and operations

- Build and test the new immutable tag before the maintenance window. Retain the
  previous images. Back up the DB and vault key before a schema-changing release.
- Stop the API before applying release migrations, then replace API/web together:
  `docker compose --env-file .env stop api`, run `migrate`, then `up -d --wait`.
  This intentionally allows downtime and avoids overlapping feed owners.
- For a schema-compatible rollback, restore the previous RELEASE_TAG and use
  `up -d --no-build --wait`. Migrations are forward-only; an older image will
  reject an incompatible schema. Never blindly roll back or overwrite a live DB.
  Restore to a separate database and verify it before an approved cutover.
- Configure external HTTPS readiness monitoring and CPU/RAM/disk alerts. Docker
  restarts crashed processes, but an `unhealthy` status alone does not restart a
  container. Alert and investigate; do not repeatedly restart broker sessions.
- Logs have rotation limits. OAuth callback query strings and sensitive error
  objects are suppressed; do not enable raw proxy/SDK access logging.
- Review exchange-calendar coverage before each new year/special session. The
  application fails closed on unknown sessions; server clock alone is not proof.
- Test off-host restoration of PostgreSQL, vault key and deployment configuration.
  A single Droplet and single-node database are not an HA/disaster-recovery plan.
- Rebuild regularly for base-image/security updates and validate before release.
  Live broker acceptance, DigitalOcean networking, public TLS issuance and
  recovery drills remain required on the actual infrastructure.

### Calendar maintenance (schema 9)

Startup seeds 30 days of lookback and 90 days ahead, only for years covered by
the bundled verified holiday data. `/v1/calendar-health` returns 503 when fewer
than 45 consecutive calendar dates are present, or storage is unavailable.
Monitor this endpoint separately from process readiness. A daily server warning
also reports incomplete coverage; it does not deliver an external notification.

Before a new year or announced special session, prepare a JSON file from the
exchange's verified EQ session notice. Its fields are `source` (HTTPS notice URL),
`version` (notice/revision identifier), and `days` (an array). Each day contains
`day` (YYYY-MM-DD), `trading` (boolean), `reason` (string or null), `preOpen`, `open`,
and `close` (ISO timestamps with offsets, or null). Closed days require a reason
and null boundaries. Trading boundaries must be ordered and on that IST date;
use equal preOpen/open if no separate pre-open phase applies.

From the deployment directory, after running migrations:

```sh
docker compose --env-file .env run --rm --no-deps --entrypoint node \
  --volume "$PWD/verified-calendar.json:/tmp/calendar.json:ro" \
  admin apps/api/dist/import-calendar.js /tmp/calendar.json
```

The import validates the complete file and commits atomically. It replaces only
listed dates, including weekend/special sessions. Generated seeds cannot overwrite
imports or legacy/manual rows. Schema 9 preserves existing rows as unmanaged;
correct any old erroneous dates through an explicit verified import. No unverified
future dates or special-session times are invented. Coverage measures presence,
not whether an operator's source has been independently verified.

Password changes through the administrative create-user command now revoke all
existing sessions for that user. Authentication is asynchronous with bounded
password work and per-IP/per-account attempt limits. Account limits are in-memory,
consistent with the supported single-API deployment; multiple replicas require a
shared limiter and feed ownership design first.

References: [database TLS and trusted sources](https://docs.digitalocean.com/products/databases/postgresql/how-to/secure/),
[least-privilege database roles](https://docs.digitalocean.com/products/databases/postgresql/how-to/modify-user-privileges/),
[Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https),
[Kite login flow](https://kite.trade/docs/connect/v3/user/).
