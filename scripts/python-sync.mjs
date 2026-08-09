import { spawnSync } from "node:child_process";

import { ensureUv } from "./uv-tool.mjs";

let uv;
try {
  uv = ensureUv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const result = spawnSync(uv, ["sync", "--locked", "--all-packages", "--all-groups"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
