import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const root = path.join(repositoryRoot, "apps/web/dist-cloudflare");
const forbidden = [
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "selectedGpuSku",
  "startPod",
  "deletePod",
  "purge-queue",
  "/workspace/models",
  "avatar_repair_profile_id",
  "echo_avatar",
  "NVIDIA RTX A6000",
  "NVIDIA GeForce RTX 4090",
  "legacy_compatibility_fixture",
];
const clientForbidden = [
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "NVIDIA RTX A6000",
  "avatar_repair_profile_id",
  "echo_avatar",
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else if (/\.(?:js|mjs)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

const failures = [];
for (const file of await filesBelow(root)) {
  if (
    !file.includes("videoforge_production_runtime") &&
    !file.includes(`${path.sep}client${path.sep}`)
  ) {
    continue;
  }
  const source = await readFile(file, "utf8");
  const tokens = file.includes("videoforge_production_runtime") ? forbidden : clientForbidden;
  for (const token of tokens) {
    if (source.includes(token)) failures.push(`${file} contains ${token}`);
  }
}

if (failures.length > 0) {
  console.error(`V2-05 production bundle quarantine failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("V2-05 production worker and client bundles contain no superseded routing vocabulary.");
