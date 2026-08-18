import { spawnSync } from "node:child_process";

import { resolveUv } from "./uv-tool.mjs";

let uv;
try {
  uv = resolveUv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const pythonRoots = ["apps/media-worker-desktop", "packages/contracts/python", "workers"];

for (const args of [
  ["run", "--locked", "--no-sync", "ruff", "check", ...pythonRoots],
  ["run", "--locked", "--no-sync", "ruff", "format", "--check", ...pythonRoots],
]) {
  const result = spawnSync(uv, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
