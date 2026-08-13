import { spawnSync } from "node:child_process";

import { resolveUv } from "./uv-tool.mjs";

const suites = [
  ...["image-media", "media-local", "avatar-primary"].map((worker) => ({
    label: worker,
    args: [
      "python",
      "-m",
      "unittest",
      "discover",
      "-s",
      `workers/${worker}/tests`,
      "-p",
      "test_*.py",
    ],
  })),
  {
    label: "avatar-fixture",
    args: ["pytest", "-q", "workers/avatar-fixture/tests"],
    env: { PYTHONPATH: "workers/avatar-fixture/src" },
  },
  {
    label: "image-media/transcribe",
    args: [
      "python",
      "-m",
      "unittest",
      "discover",
      "-s",
      "workers/image-media/tests/jobs/transcribe",
      "-p",
      "test_*.py",
    ],
  },
  {
    label: "image-media/span-audio",
    args: [
      "python",
      "-m",
      "unittest",
      "discover",
      "-s",
      "workers/image-media/tests/jobs/span_audio",
      "-p",
      "test_*.py",
    ],
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
  const result = spawnSync(uv, ["run", "--locked", "--no-sync", ...suite.args], {
    env: { ...process.env, ...suite.env },
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Worker tests passed (${suites.length} explicit Python 3.12 suites).`);
