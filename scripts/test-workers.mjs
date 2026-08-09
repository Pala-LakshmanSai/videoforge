import { spawnSync } from "node:child_process";

import { resolveUv } from "./uv-tool.mjs";

const workers = ["image-media", "avatar-primary", "avatar-repair", "avatar-quality"];
let uv;
try {
  uv = resolveUv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

for (const worker of workers) {
  const result = spawnSync(
    uv,
    [
      "run",
      "--locked",
      "--no-sync",
      "python",
      "-m",
      "unittest",
      "discover",
      "-s",
      `workers/${worker}/tests`,
      "-p",
      "test_*.py",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Worker health tests passed (${workers.length} isolated Python 3.12 lanes).`);
