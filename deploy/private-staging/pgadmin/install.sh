#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
base=/opt/nraialgo-staging-f78936c/deploy/private-staging
[[ ! -e secrets ]] || { echo 'pgAdmin secrets already exist; refusing reinitialization.' >&2; exit 1; }
[[ -f $base/secrets/staging-ca.crt ]]
existing_role=$(docker exec nraialgo-staging-db-1 psql -U postgres -d nraialgo -Atc "SELECT 1 FROM pg_roles WHERE rolname='nraialgo_browser'")
[[ -n "$existing_role" ]] && {
  echo 'Database browser role already exists; inspect it before installation.' >&2; exit 1;
}
mkdir secrets
openssl rand -hex 32 > secrets/login-password
openssl rand -hex 32 > secrets/database-password
printf 'db:5432:nraialgo:nraialgo_browser:%s\n' "$(<secrets/database-password)" > secrets/pgpass
install -m 600 "$base/secrets/web-tls/localhost.key" secrets/server.key
install -m 644 "$base/secrets/web-tls/localhost.crt" secrets/server.crt
install -m 644 "$base/secrets/staging-ca.crt" secrets/staging-ca.crt
install -m 644 "$base/secrets/db-tls/db.crt" secrets/db.crt
chown 5050:5050 secrets/login-password secrets/pgpass secrets/server.key secrets/server.crt secrets/db.crt
# Send the generated password over stdin, never in argv or logs. It is hex only.
{
  printf "\\set browser_password '%s'\n" "$(<secrets/database-password)"
  cat <<'SQL'
BEGIN;
CREATE ROLE nraialgo_browser LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 4 PASSWORD :'browser_password';
ALTER ROLE nraialgo_browser SET default_transaction_read_only = on;
ALTER ROLE nraialgo_browser SET statement_timeout = '15s';
ALTER ROLE nraialgo_browser SET idle_in_transaction_session_timeout = '30s';
GRANT CONNECT ON DATABASE nraialgo TO nraialgo_browser;
GRANT USAGE ON SCHEMA public TO nraialgo_browser;
GRANT SELECT ON public.schema_migrations, public.market_calendar, public.calendar_metadata, public.alpha_wire_items, public.alpha_wire_poll_state TO nraialgo_browser;
CREATE SCHEMA db_browser AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA db_browser FROM PUBLIC;
CREATE VIEW db_browser.users AS SELECT id,email,created_at FROM public.users;
CREATE VIEW db_browser.broker_sessions AS SELECT workspace_id,provider,expires_at,updated_at FROM public.broker_sessions;
CREATE VIEW db_browser.broker_credentials AS SELECT workspace_id,provider,updated_at FROM public.broker_app_credentials;
GRANT USAGE ON SCHEMA db_browser TO nraialgo_browser;
GRANT SELECT ON ALL TABLES IN SCHEMA db_browser TO nraialgo_browser;
COMMIT;
SQL
} | docker exec -i nraialgo-staging-db-1 psql -U postgres -d nraialgo -v ON_ERROR_STOP=1
docker compose config --quiet
docker compose run --rm --no-deps --user 0 --entrypoint /bin/sh pgadmin -c 'chown 5050:5050 /var/lib/pgadmin/storage /var/lib/pgadmin/storage/admin_example.com'
docker compose up -d --wait --wait-timeout 180
echo 'pgAdmin installed. Read the login password privately from secrets/login-password.'
