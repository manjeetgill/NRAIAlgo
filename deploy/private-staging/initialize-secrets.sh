#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ -e secrets ]; then echo 'Secrets already exist; refusing to overwrite.'; exit 1; fi
umask 077
mkdir -p secrets/db-tls secrets/web-tls
openssl rand -hex 32 > secrets/postgres-password
openssl rand -hex 32 > secrets/app-password
openssl rand -hex 32 > secrets/vault-key
openssl rand -hex 32 > secrets/setup-token
printf 'postgresql://postgres:%s@db:5432/nraialgo\n' "$(<secrets/postgres-password)" > secrets/database-admin-url
printf 'postgresql://nraialgo_app:%s@db:5432/nraialgo\n' "$(<secrets/app-password)" > secrets/database-url
openssl req -x509 -newkey rsa:3072 -nodes -days 365 -subj '/CN=db' -addext 'subjectAltName=DNS:db' -keyout secrets/db-tls/db.key -out secrets/db-tls/db.crt 2>/dev/null
openssl req -x509 -newkey rsa:3072 -nodes -days 365 -subj '/CN=NRAIAlgo Private Staging CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' -keyout secrets/staging-ca.key -out secrets/staging-ca.crt 2>/dev/null
openssl req -newkey rsa:3072 -nodes -subj '/CN=localhost' -keyout secrets/web-tls/localhost.key -out secrets/localhost.csr 2>/dev/null
printf '%s\n' 'subjectAltName=DNS:localhost,IP:127.0.0.1' 'basicConstraints=critical,CA:FALSE' 'keyUsage=critical,digitalSignature,keyEncipherment' 'extendedKeyUsage=serverAuth' > secrets/localhost.ext
openssl x509 -req -in secrets/localhost.csr -CA secrets/staging-ca.crt -CAkey secrets/staging-ca.key -CAcreateserial -days 90 -extfile secrets/localhost.ext -out secrets/web-tls/localhost.crt 2>/dev/null
chown -R 999:999 secrets/db-tls
chmod 755 secrets/db-tls
chmod 644 secrets/db-tls/db.crt
chown 1000:1000 secrets/database-url secrets/database-admin-url secrets/vault-key secrets/setup-token
chmod 400 secrets/database-url secrets/database-admin-url secrets/vault-key secrets/setup-token
chmod 444 secrets/app-password secrets/postgres-password
echo 'Generated new staging-only secrets and TLS certificates; values not printed.'
