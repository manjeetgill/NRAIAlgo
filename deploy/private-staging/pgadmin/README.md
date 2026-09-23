# Private database browser

PostgreSQL remains in its existing container and persistent volume. This separate
Compose project adds pgAdmin on the same Droplet, connected to the existing
`nraialgo-staging_default` network. It does not restart the application.

## Access from your Mac

Keep this SSH tunnel running in a terminal:

```sh
ssh -N -L 127.0.0.1:8444:127.0.0.1:8444 root@139.59.64.197
```

Open https://localhost:8444 using a browser that trusts the private staging CA.
Do not bypass certificate warnings. Login email: `admin@example.com`.
Retrieve the generated password privately in your terminal:

```sh
ssh root@139.59.64.197 'cat /opt/nraialgo-pgadmin/secrets/login-password'
```

Expand Servers → Private staging → NRAIAlgo staging (read only) → Databases →
nraialgo → Schemas. `public` contains the application tables. The connection can
read calendar, news, and schema-version tables. `db_browser` contains safe views
of users and broker connection metadata, excluding password hashes and tokens.
Credential/session tables cannot be read with this connection. Use View/Edit
Data → All Rows to browse an allowed table or view; writes are denied.

## Operations

Installation location: `/opt/nraialgo-pgadmin`. Run `bash install.sh` once after
copying this directory there. It requires the existing private staging deployment
and TLS files under `/opt/nraialgo-staging-f78936c/deploy/private-staging`.
It refuses to overwrite existing secrets or reinitialize an existing browser role.
Secrets are generated only on the host and excluded from Git.

```sh
cd /opt/nraialgo-pgadmin
docker compose ps
docker compose logs --tail=50 pgadmin
docker compose up -d --wait
```

Port 8444 is bound only to the Droplet loopback interface. Do not expose it, or
PostgreSQL port 5432, publicly. pgAdmin settings persist in a separate Docker
volume. The web login is an administrator of pgAdmin, not a PostgreSQL superuser.
The database role has SELECT grants on an explicit allowlist; newly created
tables are not automatically accessible. Review grants when migrations add tables.

The UI uses a copy of the staging HTTPS certificate. Renew its copied certificate
and key alongside staging TLS, preserve ownership 5050, and restart pgAdmin.
Database backups and browser-role recreation are separate from pgAdmin settings;
retain protected backups of the server secrets and this installation procedure.
