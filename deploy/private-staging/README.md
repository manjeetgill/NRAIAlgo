# Private SSH-only staging

This profile was prepared for the 2-vCPU / 2-GB Ubuntu 24.04 Droplet at
139.59.64.197. It uses the tested application snapshot `f78936c`, not the newer
uncommitted application changes. Images are tagged `f78936c-private`.

The release directory on the host is `/opt/nraialgo-staging-f78936c`.
Run Compose commands in its `deploy/private-staging` directory.

Only SSH is publicly reachable. The proxy binds `127.0.0.1:8443`; PostgreSQL,
API and frontend have no published ports. PostgreSQL uses a named volume,
verified TLS and a separate restricted API role. This is single-host staging,
not a production/high-availability deployment. No broker credentials are copied.

## Setup and access

Run `bash initialize-secrets.sh` only for a new installation. It refuses to
overwrite existing secrets. Build API and web sequentially on this small host,
start `db`, run the `migrate` service, then start `api web proxy`.

From your Mac, keep this SSH tunnel running:

```bash
ssh -i ~/.ssh/id_ed25519 -o ExitOnForwardFailure=yes -N -L 127.0.0.1:8443:127.0.0.1:8443 root@139.59.64.197
```

Open `https://localhost:8443/login`. HTTPS uses a staging-only CA; first securely
copy `secrets/staging-ca.crt` using SSH and explicitly trust that CA in your Mac's
login keychain, restricted to SSL for localhost:

```bash
security add-trusted-cert -r trustRoot -p ssl -s localhost -k ~/Library/Keychains/login.keychain-db /Users/manjeet/Documents/ChatGPT/Algo/nraialgo-staging-ca.crt
```

Never bypass browser certificate warnings or disable validation.
The leaf certificate lasts 90 days and the CA 365 days; renew before expiry.
Never copy the CA private key or database/broker secrets to the browser.

Retrieve the one-time setup token privately through SSH from
`secrets/setup-token`, then create your first user in the login screen. Do not
paste the token or passwords into chat. After setup, remove the
`INITIAL_SETUP_TOKEN_FILE` environment entry and `setup_token` secret from the
API service and recreate only the API. Retain the vault key permanently.

Broker OAuth callback registration may need changing for this HTTPS localhost
origin. Do not change a working local registration or connect a funded account
without explicitly deciding which broker application this staging uses.

## Operations

### Deploy a committed application release from your Mac

From the repository root, commit your intended application changes and run tests,
type checks, lint and `npm audit --omit=dev`. Then:

```bash
bash deploy-staging.sh --dry-run HEAD
bash deploy-staging.sh HEAD
```

You may replace `HEAD` with a specific commit ID. GitHub push is not required:
the script uploads `git archive` of that commit over verified SSH. Uncommitted
files and untracked files are excluded. The selected commit must contain the
release helper introduced with this deployment tooling.

By default it uses `root@139.59.64.197` and `~/.ssh/id_ed25519`. Set
`STAGING_SSH_TARGET` or `STAGING_SSH_KEY` explicitly if these change. A dry run
validates the local commit only; it does not contact the host or predict migration
success. Unlock your SSH key with `ssh-add` first if necessary.

The command builds sequentially before downtime, saves a restricted on-host
backup of the existing secrets/configuration, stops the API, dumps PostgreSQL,
runs the new migration image, and starts the new API/web images. It checks
readiness, the login page, unauthenticated access rejection and demo-route hiding.
It does not sign in as you or initiate broker login/order requests. Existing
broker sessions may reconnect normally when the API starts.

Application images are tagged with the full commit ID plus `-private`. Operational
Compose configuration stays in the original directory; release-specific image
overrides and source archives are under `/opt/nraialgo-staging/releases/`.
`/opt/nraialgo-staging/current` records the most recent successful release directory.
The script deliberately does NOT apply changes to database/proxy/network/secret
configuration: those require a separately reviewed maintenance operation.

Backups are under `/opt/nraialgo-staging/backups/`, root-only. They contain secrets
and are not encrypted at rest by this script; keep the host secure and arrange
encrypted off-host backups separately. Old releases/images/backups are retained;
monitor disk usage and review retention manually.

If a build fails, the running application remains unchanged. If stopping the API,
the database backup, migration, startup or verification fails, the script leaves
the API stopped rather than guessing a rollback. Inspect the reported phase and
backup path. Never rerun initialization or restore a backup over a live database.
An older application may reject a newer schema. Test restoration into a separate
database before an explicitly approved recovery/cutover. Re-running the same
commit creates a separate attempt directory; only one deployment can run at once.

After success, verify sign-in, holdings, prices and broker connections yourself.
The server remains private; keep the SSH tunnel running on your Mac.

Tooling tests (no SSH connection or Docker daemon required):

```bash
python3 -m unittest discover -s deploy/private-staging/tests -p 'test_*.py'
```

- `docker compose ps` checks service health.
- `docker compose restart api` tests a process restart without removing data.
- Never run `docker compose down -v`: that deletes the staging database.
- Back up PostgreSQL and the vault key separately, encrypted and off-host.
- Local backup/restore drills do not replace an off-host disaster recovery test.
- Keep exactly one API instance. The profile does not implement live orders.
- Review resource usage before connecting brokers or adding workload. Swap is
  build headroom, not a substitute for adequate RAM.
- Apply OS updates and verify recovery before any production promotion.

This profile's image tags deliberately identify the deployed snapshot. For a new
release, use a new immutable tag and test migrations before replacing services.
