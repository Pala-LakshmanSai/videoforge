import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const result = spawnSync(process.execPath, ["scripts/python-sync.mjs"], {
  cwd: repoRoot,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
