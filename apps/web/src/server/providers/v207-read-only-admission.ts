import { pathToFileURL } from "node:url";

import { runV207ReadOnlyAdmission } from "./v207-live-qualification";

const SAFE_CODE = /\b(?:MAGE|RUNPOD|SERVERLESS|V207)_[A-Z0-9][A-Z0-9_.-]{1,159}\b/u;

async function main(): Promise<void> {
  await runV207ReadOnlyAdmission(process.env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error(message.match(SAFE_CODE)?.[0] ?? "V207_READ_ONLY_ADMISSION_FAILED");
    process.exitCode = 1;
  }
}
