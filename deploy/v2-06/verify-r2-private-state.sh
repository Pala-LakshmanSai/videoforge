#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: verify-r2-private-state.sh <bucket> <wrangler-config>" >&2
  exit 2
fi

bucket=$1
config=$2
tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/videoforge-v2-06-r2-state.XXXXXX")
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT HUP INT TERM

pnpm --filter @videoforge/web exec wrangler r2 bucket info "$bucket" --json --config "$config" \
  >"$tmp_dir/info.json"
pnpm --filter @videoforge/web exec wrangler r2 bucket dev-url get "$bucket" --config "$config" \
  >"$tmp_dir/dev-url.txt"
pnpm --filter @videoforge/web exec wrangler r2 bucket lifecycle list "$bucket" --config "$config" \
  >"$tmp_dir/lifecycle.txt"

node - "$tmp_dir/info.json" "$bucket" <<'NODE'
const fs = require("node:fs");
const [file, expectedBucket] = process.argv.slice(2);
const info = JSON.parse(fs.readFileSync(file, "utf8"));
if (info.name !== expectedBucket || info.default_storage_class !== "Standard") {
  throw new Error("R2 bucket identity or Standard storage class is not exact");
}
NODE

if ! grep -qi "public access via the r2.dev URL is disabled" "$tmp_dir/dev-url.txt"; then
  echo "R2 public dev-url access is not proven disabled" >&2
  exit 1
fi
if grep -Eiq "DeleteObject|Expire|expiration|delete objects|delete all" "$tmp_dir/lifecycle.txt"; then
  echo "R2 lifecycle contains an automatic object deletion rule" >&2
  exit 1
fi
if ! grep -qi "Abort incomplete multipart uploads after 7 days" "$tmp_dir/lifecycle.txt"; then
  echo "R2 lifecycle does not show only the expected multipart-abort rule" >&2
  exit 1
fi
echo "V2-06 R2 private state verified: Standard bucket, public dev-url disabled, no final-object expiry, multipart abort only."
