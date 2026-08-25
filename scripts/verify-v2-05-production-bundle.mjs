import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const bundleDirectory = process.env.VIDEOFORGE_BUNDLE_DIR ?? "dist-cloudflare";
if (!/^dist-[a-z0-9-]+$/u.test(bundleDirectory)) throw new Error("Invalid bundle directory.");
const root = path.join(repositoryRoot, "apps/web", bundleDirectory);
const forbidden = [
  "@videoforge/test-fixtures",
  "packages/test-fixtures",
  "FakeServerlessEndpoint",
  "FakeServerlessTransport",
  "fixture-router",
  "fixture-routes",
  "fixture-route",
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "selectedGpuSku",
  "startPod",
  "createPod",
  "stopPod",
  "deletePod",
  "terminatePod",
  "updatePod",
  "RunPodPodClient",
  "gpuTypeIds",
  "purge-queue",
  "/workspace/models",
  "avatar_repair_profile_id",
  "echo_avatar",
  "NVIDIA RTX A6000",
  "NVIDIA GeForce RTX 4090",
  "legacy_compatibility_fixture",
];
const clientForbidden = [
  "/api/dev/shared-app/invites",
  "/api/v2/auth/fixture",
  "x-videoforge-fixture-session",
  "?fixture=",
  "issueFixtureInvite",
  "authenticateFixture",
  "fixture_id",
  "fixture_voiceover",
  "@videoforge/test-fixtures",
  "packages/test-fixtures",
  "FakeServerlessEndpoint",
  "FakeServerlessTransport",
  "fixture-router",
  "fixture-routes",
  "fixture-route",
  "/fixtures/",
  "/api/v1/shared-app",
  "cp05-fixture-control-v1",
  "fixture-pod-",
  "canSelectGpuPair",
  "selectedGpuSku",
  "startPod",
  "createPod",
  "stopPod",
  "deletePod",
  "terminatePod",
  "updatePod",
  "RunPodPodClient",
  "gpuTypeIds",
  "NVIDIA RTX A6000",
  "avatar_repair_profile_id",
  "echo_avatar",
];

async function filesBelow(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else files.push(absolute);
  }
  return files;
}

const failures = [];
let workerCodeFiles = 0;
let clientCodeFiles = 0;
const emittedFiles = await filesBelow(root);
for (const file of emittedFiles) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (relative.startsWith("client/fixtures/")) {
    failures.push(`${file} is an emitted production fixture asset`);
  }
  if (!/\.(?:js|mjs|map)$/u.test(file)) continue;
  const workerFile = relative.startsWith("videoforge_production_runtime/");
  const clientFile = relative.startsWith("client/");
  if (!workerFile && !clientFile) continue;
  if (/\.(?:js|mjs)$/u.test(file)) {
    if (workerFile) workerCodeFiles += 1;
    if (clientFile) clientCodeFiles += 1;
  }
  const emittedName = path.basename(file);
  if (/fixture-(?:link|route)|fixture(?:route|router)/iu.test(emittedName)) {
    failures.push(`${file} is a fixture route/support module`);
  }
  const source = await readFile(file, "utf8");
  const tokens = workerFile ? forbidden : clientForbidden;
  for (const token of tokens) {
    if (source.includes(token)) failures.push(`${file} contains ${token}`);
  }
}

if (workerCodeFiles === 0) {
  failures.push(`${root} contained no production Worker emitted code`);
}
if (clientCodeFiles === 0) {
  failures.push(`${root} contained no production client emitted code`);
}
for (const required of [
  "videoforge_production_runtime/index.js",
  "videoforge_production_runtime/.vite/manifest.json",
  "client/index.html",
  "client/.vite/manifest.json",
]) {
  try {
    await access(path.join(root, required));
  } catch {
    failures.push(`${root} is missing required production entry ${required}`);
  }
}

if (failures.length > 0) {
  console.error(`V2-05 production bundle quarantine failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("V2-05 production worker and client bundles contain no superseded routing vocabulary.");
