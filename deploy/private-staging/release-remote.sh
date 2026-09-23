#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# == 2 && $2 =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected archive and full commit ID.' >&2; exit 2; }
archive=$1
sha=$2
[[ $archive =~ ^/tmp/nraialgo-release\.[a-zA-Z0-9_]+\.tar$ && -f $archive ]] || { echo 'Invalid release archive.' >&2; exit 2; }
# These paths intentionally preserve the existing installation and its secrets.
base=/opt/nraialgo-staging-f78936c/deploy/private-staging
state=/opt/nraialgo-staging
for command in docker flock curl tar; do command -v "$command" >/dev/null; done
[[ -f $base/compose.yml && -f $base/secrets/vault-key && -f $base/secrets/staging-ca.crt ]] || {
  echo 'Existing staging installation not found. This script never initializes secrets.' >&2; exit 1;
}
mkdir -p "$state/releases" "$state/backups"
exec 9>"$state/deploy.lock"
flock -n 9 || { echo 'Another staging deployment is running.' >&2; exit 1; }
phase=preflight
release=''
on_exit() {
  result=$?
  rm -f "$archive"
  if [[ $result != 0 ]]; then
    echo "Deployment failed during $phase. Release files retained at: $release" >&2
    if [[ $phase == quiesce || $phase == migration || $phase == startup || $phase == verification ]]; then
      echo 'No automatic rollback: schema may have changed. API is being stopped; inspect the backup and logs before recovery.' >&2
      compose stop api || true
    else
      echo 'Failure occurred before migration; the running application was not replaced.' >&2
    fi
  fi
}
trap on_exit EXIT
compose() { docker compose --project-name nraialgo-staging --project-directory "$base" -f "$base/compose.yml" -f "$release/images.yml" "$@"; }
release=$(mktemp -d "$state/releases/$sha.XXXXXX")
tar -xf "$archive" -C "$release" --no-same-owner
[[ -f $release/Dockerfile && -f $release/package-lock.json ]] || { echo 'Incomplete release.' >&2; exit 1; }
tag="$sha-private"
printf 'services:\n  api:\n    image: nraialgo-api:%s\n  web:\n    image: nraialgo-web:%s\n  migrate:\n    image: nraialgo-api:%s\n' "$tag" "$tag" "$tag" > "$release/images.yml"
compose config --quiet
# Fail rather than starting a fresh DB or accidentally deploying to another stack.
db_id=$(compose ps -q db)
[[ -n $db_id && $(docker inspect -f '{{.State.Health.Status}}' "$db_id") == healthy ]] || {
  echo 'Existing database must already be healthy.' >&2; exit 1;
}
phase=build
docker build --target api -t "nraialgo-api:$tag" "$release"
docker build --target web -t "nraialgo-web:$tag" "$release"
phase=backup
backup="$state/backups/$(date -u +%Y%m%dT%H%M%SZ)-$sha"
mkdir "$backup"
# Restricted on-host recovery copies; arrange separate encrypted off-host backup.
tar -czf "$backup/secrets-and-config.tgz" -C "$base" secrets compose.yml Caddyfile init-db.sh
compose images > "$backup/images.txt"
[[ ! -f $state/current ]] || cp "$state/current" "$backup/previous-release"
# Stop all API writes before taking the final database snapshot.
phase=quiesce
compose stop api
phase=migration
compose exec -T db pg_dump -U postgres -d nraialgo -Fc </dev/null > "$backup/database.dump"
[[ -s $backup/database.dump ]]
compose exec -T db pg_restore --list < "$backup/database.dump" > "$backup/database-contents.txt"
echo "Recovery backup: $backup (contains secrets; do not publish)"
compose run --rm --no-deps -T migrate </dev/null
phase=startup
# Never recreate the database/proxy or overlap two feed-owning API processes.
compose up -d --no-deps --no-build --pull never --wait --wait-timeout 120 api web
phase=verification
# The existing proxy can keep old upstream connections briefly during recreation.
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 2 --max-time 10 \
  --cacert "$base/secrets/staging-ca.crt" https://localhost:8443/v1/readiness
curl --fail --silent --show-error --max-time 10 --cacert "$base/secrets/staging-ca.crt" https://localhost:8443/login -o /dev/null
status=$(curl --silent --show-error --max-time 10 --cacert "$base/secrets/staging-ca.crt" https://localhost:8443/v1/overview -o /dev/null -w '%{http_code}')
[[ $status == 401 ]] || { echo "Authentication check failed: HTTP $status" >&2; exit 1; }
status=$(curl --silent --show-error --max-time 10 --cacert "$base/secrets/staging-ca.crt" https://localhost:8443/dev/overview-playground -o /dev/null -w '%{http_code}')
[[ $status == 404 ]] || { echo "Demo route exposed: HTTP $status" >&2; exit 1; }
printf '%s\n' "$release" > "$state/current.new"
mv "$state/current.new" "$state/current"
phase=complete
echo
echo "Deployed $sha. Verify sign-in and broker data in https://localhost:8443."
echo 'Broker credentials are preserved; no broker logins or orders were triggered by this script.'
