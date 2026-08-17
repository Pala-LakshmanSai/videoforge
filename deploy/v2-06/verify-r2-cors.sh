#!/bin/sh
set -eu

if [ "$#" -ne 1 ] || [ -z "${EXPECTED_ORIGIN:-}" ]; then
  echo "usage: EXPECTED_ORIGIN=https://exact-origin verify-r2-cors.sh <bucket>" >&2
  exit 2
fi

bucket=$1
case "$bucket" in
  videoforge-v2-06-staging-private) ;;
  *) echo "refusing to inspect an unapproved R2 bucket" >&2; exit 2 ;;
esac

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
config_file=${WRANGLER_CONFIG:-wrangler.staging.jsonc}
if [ ! -f "$repo_root/apps/web/$config_file" ]; then
  echo "Wrangler config not found: $repo_root/apps/web/$config_file" >&2
  exit 2
fi

result_file=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-cors.XXXXXX")
trap 'rm -f "$result_file"' EXIT HUP INT TERM
(
  cd "$repo_root/apps/web"
  pnpm exec wrangler r2 bucket cors list "$bucket" --config "$config_file"
) >"$result_file"
node "$repo_root/deploy/v2-06/verify-r2-cors.mjs" --origin "$EXPECTED_ORIGIN" <"$result_file"
