#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo 'Usage: bash deploy-staging.sh [--dry-run] <commit>'
  echo 'Optional: STAGING_SSH_TARGET=root@139.59.64.197 STAGING_SSH_KEY=/path/to/key'
}
dry_run=false
if [[ ${1:-} == --dry-run ]]; then dry_run=true; shift; fi
if [[ $# != 1 || $1 == -* ]]; then usage; exit 2; fi
repo=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
sha=$(git -C "$repo" rev-parse --verify "$1^{commit}")
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full Git commit ID.' >&2; exit 1; }
target=${STAGING_SSH_TARGET:-root@139.59.64.197}
key=${STAGING_SSH_KEY:-$HOME/.ssh/id_ed25519}
[[ $target =~ ^[a-zA-Z0-9_.-]+@[a-zA-Z0-9.-]+$ ]] || { echo 'Invalid SSH target.' >&2; exit 2; }
git -C "$repo" cat-file -e "$sha:deploy/private-staging/release-remote.sh"
echo "Release: $sha"
echo "Destination: $target (private staging only)"
echo 'Only committed files are included. Existing database and secrets are preserved.'
if [[ -n $(git -C "$repo" status --porcelain) ]]; then
  echo 'NOTE: working tree has changes; they will NOT be deployed.'
fi
if $dry_run; then
  echo 'Dry run: no SSH connection, upload, build, or deployment performed.'
  exit 0
fi
work=$(mktemp -d "${TMPDIR:-/tmp}/nraialgo-release.XXXXXX")
trap 'rm -f "$work/release.tar"; if [[ -d "$work/deploy" ]]; then rm -rf "$work/deploy"; fi; rmdir "$work"' EXIT
git -C "$repo" archive --format=tar --output="$work/release.tar" "$sha"
tar -xf "$work/release.tar" -C "$work" deploy/private-staging/release-remote.sh
ssh_opts=(-i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -o ServerAliveInterval=30)
upload=$(ssh "${ssh_opts[@]}" "$target" 'umask 077; mktemp /tmp/nraialgo-release.XXXXXX.tar')
[[ $upload =~ ^/tmp/nraialgo-release\.[a-zA-Z0-9_]+\.tar$ ]] || { echo 'Unexpected upload path.' >&2; exit 1; }
scp "${ssh_opts[@]}" "$work/release.tar" "$target:$upload"
# Upload the selected commit's helper as a FILE. Docker commands may read stdin;
# executing a script through `bash -s` lets them swallow the remaining script.
scp "${ssh_opts[@]}" "$work/deploy/private-staging/release-remote.sh" "$target:$upload.sh"
ssh -n "${ssh_opts[@]}" "$target" "bash '$upload.sh' '$upload' '$sha' </dev/null; result=\$?; rm -f '$upload.sh'; exit \$result"
