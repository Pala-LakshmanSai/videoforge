import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const failures = [];
const exactFiles = [
  "packages/config/src/index.ts",
  "packages/config/profiles/fixture-runtime.v1.json",
  "packages/config/profiles/execution-profile-catalog.v1.json",
  "scripts/test-workers.mjs",
  "packages/control-plane/src/global-session/provider-free-orchestration.ts",
  "packages/pipeline/src/render/ports.ts",
  "packages/pipeline/src/render/vnext-boundary.ts",
  "apps/web/src/server/provider-free-fixture-mp4.ts",
  "apps/web/src/server/provider-free-foundations.ts",
];
const activeRoots = [
  "packages/test-fixtures/src",
  "apps/web/src/lib",
  "apps/web/src/screens",
  "apps/web/src/server/routes",
  "apps/web/src/server/local",
];
const forbiddenActiveTokens = [
  "AvatarForcing",
  "MuseTalk",
  "SkyReels",
  "APPROVE_FALLBACK",
  "fallback-approval",
  "avatar_lip_failure",
  "skyreels_approval_required",
  '"avatar-repair"',
  '"avatar-quality"',
  "Mage-Flow-Turbo BF16",
  "runpod_serverless",
  "RUNPOD_SERVERLESS",
  "workersMin",
  "workersMax",
];
const forbiddenActiveTokensCaseInsensitive = ["avatarforcing", "musetalk", "skyreels"];
const forbiddenImports = [
  "@videoforge/control-plane/global-session",
  "runpod-avatar-qualification",
  "runpod-mage-qualification",
  "runpod-mage-matrix",
  "runpod-avatar-bootstrap-qualification",
  "avatar-repair",
  "avatar-quality",
  "legacy-replay",
];

async function filesBelow(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(absolute)));
    else if (/\.(?:json|mjs|ts|tsx)$/u.test(entry.name)) files.push(absolute);
  }
  return files;
}

const activeFiles = [...exactFiles, ...(await Promise.all(activeRoots.map(filesBelow))).flat()];
for (const file of activeFiles) {
  const source = await readFile(file, "utf8");
  for (const token of forbiddenActiveTokens) {
    if (source.includes(token)) failures.push(`${file} contains active legacy token ${token}`);
  }
  const normalizedSource = source.toLocaleLowerCase("en-US");
  for (const token of forbiddenActiveTokensCaseInsensitive) {
    if (normalizedSource.includes(token)) {
      failures.push(`${file} contains active legacy token ${token}`);
    }
  }
}

for (const file of await filesBelow("apps/web/src")) {
  if (/\.(?:test|spec)\.[^.]+$/u.test(file)) continue;
  const source = await readFile(file, "utf8");
  for (const moduleName of forbiddenImports) {
    const pattern = new RegExp(
      `(?:from\\s+|import\\s*\\()["'][^"']*${moduleName}(?:\\.js)?["']`,
      "u",
    );
    if (pattern.test(source)) failures.push(`${file} imports disabled module ${moduleName}`);
  }
  for (const legacyBoundary of ["resolveProviderAcceptedAssets", "planResolvedRenderManifest"]) {
    if (source.includes(legacyBoundary)) {
      failures.push(`${file} references legacy render boundary ${legacyBoundary}`);
    }
  }
}

const activeRenderPorts = await readFile("packages/pipeline/src/render/ports.ts", "utf8");
const activeRenderBoundary = await readFile(
  "packages/pipeline/src/render/vnext-boundary.ts",
  "utf8",
);
for (const removedAvatarRuntime of ["EchoMimic", "echomimic", "VNEXT_ECHO"]) {
  if (
    activeRenderPorts.includes(removedAvatarRuntime) ||
    activeRenderBoundary.includes(removedAvatarRuntime)
  ) {
    failures.push(
      `active render boundary still exposes removed avatar runtime ${removedAvatarRuntime}`,
    );
  }
}
for (const legacyExport of [
  "resolveAcceptedAssets,",
  "resolveProviderAcceptedAssets,",
  "planResolvedRenderManifest,",
  "timelineAcceptedAssetResolver,",
]) {
  if (activeRenderPorts.includes(legacyExport)) {
    failures.push(`active render ports export historical boundary ${legacyExport}`);
  }
}
const historicalReplayIndex = await readFile(
  "packages/pipeline/src/legacy-replay/index.ts",
  "utf8",
);
if (
  !historicalReplayIndex.includes("provider-free") ||
  !historicalReplayIndex.includes("never dispatch")
) {
  failures.push(
    "historical render replay must remain explicitly provider-free and non-dispatching",
  );
}

const catalog = JSON.parse(
  await readFile("packages/config/profiles/execution-profile-catalog.v1.json", "utf8"),
);
if (catalog.selection_policy.default_option_label !== "Fixture") {
  failures.push("execution profile default must be the explicit Fixture profile");
}
if (catalog.lanes.some((lane) => lane.selector_options.some((option) => option.label === "Auto"))) {
  failures.push("active execution profile selectors must not expose Auto");
}

if (failures.length > 0) {
  console.error(`Active runtime verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Active runtime verified (${activeFiles.length} files): vNext fixture orchestration and render boundary only; no Auto, old Mage BF16, repair/fallback model, Serverless, or historical avatar/crop import.`,
);
