#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
validator="$script_dir/validate-schemas.cjs"

if node -e 'require("ajv/dist/2020")' >/dev/null 2>&1; then
  exec node "$validator"
fi

ajv_cache="${TMPDIR:-/tmp}/videoforge-context-ajv-8.20.0"
if [ ! -f "$ajv_cache/node_modules/ajv/package.json" ]; then
  echo "Ajv 8.20.0 is not installed in the workspace; caching it outside the repository for schema validation." >&2
  npm install --prefix "$ajv_cache" --no-audit --no-fund --silent ajv@8.20.0
fi

NODE_PATH="$ajv_cache/node_modules" exec node "$validator"
