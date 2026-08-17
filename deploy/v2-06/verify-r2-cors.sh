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
case "$config_file" in
  /*) config_path=$config_file ;;
  *) config_path=$repo_root/apps/web/$config_file ;;
esac
if [ ! -f "$config_path" ]; then
  echo "Wrangler config not found: $config_path" >&2
  exit 2
fi

result_file=$(mktemp "${TMPDIR:-/tmp}/videoforge-v2-06-cors.XXXXXX")
trap 'rm -f "$result_file"' EXIT HUP INT TERM
(
  cd "$repo_root/apps/web"
  pnpm exec wrangler r2 bucket cors list "$bucket" --config "$config_path"
) >"$result_file"
node "$repo_root/deploy/v2-06/verify-r2-cors.mjs" --origin "$EXPECTED_ORIGIN" <"$result_file"
