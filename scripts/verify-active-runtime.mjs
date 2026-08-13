import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const failures = [];
const exactFiles = [
  "packages/config/src/index.ts",
  "packages/config/profiles/fixture-runtime.v1.json",
  "packages/config/profiles/execution-profile-catalog.v1.json",
  "scripts/test-workers.mjs",
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
];
const forbiddenImports = [
  "runpod-avatar-qualification",
  "runpod-mage-qualification",
  "runpod-mage-matrix",
  "runpod-avatar-bootstrap-qualification",
  "avatar-repair",
  "avatar-quality",
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
  `Active runtime verified (${activeFiles.length} files): Echo-only avatar path; no Auto, repair, fallback, or Serverless qualification import.`,
);
