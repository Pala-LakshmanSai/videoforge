import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validator = path.join(root, "project-context/scripts/validate-v208-soulx-crop-profile-approval.mjs");
const source = path.join(root, "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json");
const pristine = JSON.parse(readFileSync(source, "utf8"));
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "v208-soulx-crop-approval-"));
const run = (document) => {
  const testPath = path.join(temporaryRoot, "approval.json");
  writeFileSync(testPath, `${JSON.stringify(document)}\n`, { mode: 0o600 });
  return spawnSync(process.execPath, [validator, testPath], { cwd: root, encoding: "utf8" });
};

try {
  const baseline = run(pristine);
  if (baseline.status !== 0) throw new Error(`BASELINE_FAILED\n${baseline.stderr}`);
  const cases = [
    ["candidate hash", "CANDIDATE_HASH", (d) => (d.candidate.sha256 = `sha256:${"0".repeat(64)}`)],
    ["approval text", "STATEMENT", (d) => (d.approval_statement = "approve something else")],
    ["full transform", "FULL_FOREGROUND", (d) => (d.approved_profile.full.native_foreground_transform = "scale=1920:1080")],
    ["split crop", "SPLIT_CROP", (d) => (d.approved_profile.split.avatar_crop.x = 31)],
    ["qualification claim", "QUALIFICATION", (d) => (d.activation.qualification_status = "QUALIFIED")],
    ["live authority", "FENCE_live_dispatch_authorized", (d) => (d.activation.live_dispatch_authorized = true)],
  ];
  for (const [name, code, mutate] of cases) {
    const document = structuredClone(pristine);
    mutate(document);
    const result = run(document);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes(`V208_SOULX_CROP_APPROVAL_${code}`))
      throw new Error(`${name} was not rejected with ${code}\n${output}`);
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2-08 SoulX crop approval negative mutations PASS (6/6 rejected)");
