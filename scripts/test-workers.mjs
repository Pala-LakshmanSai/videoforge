import { spawnSync } from "node:child_process";

import { resolveUv } from "./uv-tool.mjs";

const suites = [
  ...["image-media", "avatar-primary", "avatar-repair", "avatar-quality"].map((worker) => ({
    label: worker,
    start: `workers/${worker}/tests`,
  })),
  {
    label: "image-media/transcribe",
    start: "workers/image-media/tests/jobs/transcribe",
  },
  {
    label: "image-media/span-audio",
    start: "workers/image-media/tests/jobs/span_audio",
  },
];
let uv;
try {
  uv = resolveUv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

for (const suite of suites) {
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
      suite.start,
      "-p",
      "test_*.py",
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Worker tests passed (${suites.length} explicit Python 3.12 suites).`);
