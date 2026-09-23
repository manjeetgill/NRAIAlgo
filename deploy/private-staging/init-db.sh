#!/bin/bash
set -euo pipefail
app_password="$(< /run/secrets/app_password)"
psql -v ON_ERROR_STOP=1 --username postgres --dbname nraialgo --set=app_password="$app_password" <<'SQL'
CREATE ROLE nraialgo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
