import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveUv } from "../../../scripts/uv-tool.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
let uv;
try {
  uv = resolveUv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const result = spawnSync(
  uv,
  [
    "run",
    "--locked",
    "--no-sync",
    "python",
    "-m",
    "pytest",
    "-q",
    "packages/contracts/python/tests",
  ],
  {
    cwd: repoRoot,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
