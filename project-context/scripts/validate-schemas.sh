#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
validator="$script_dir/validate-schemas.cjs"
repo_root="$(cd "$script_dir/../.." && pwd)"
workspace_modules="$repo_root/packages/contracts/node_modules"

if NODE_PATH="$workspace_modules" node -e 'const value = require("ajv/package.json").version; process.exit(value === "8.20.0" ? 0 : 1)' >/dev/null 2>&1; then
  NODE_PATH="$workspace_modules" exec node "$validator"
fi

echo "Ajv 8.20.0 is not installed in packages/contracts; run pnpm install before context validation." >&2
exit 1
