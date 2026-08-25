import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const validator = path.join(
  repositoryRoot,
  "project-context/scripts/validate-v208-soulx-crop-profile-candidate.mjs",
);
const candidatePath = path.join(
  repositoryRoot,
  "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json",
);
const pristine = JSON.parse(readFileSync(candidatePath, "utf8"));
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "v208-soulx-crop-candidate-"));

const run = (candidate) => {
  const pathUnderTest = path.join(temporaryRoot, "candidate.json");
  writeFileSync(pathUnderTest, `${JSON.stringify(candidate)}\n`, { mode: 0o600 });
  return spawnSync(process.execPath, [validator, pathUnderTest], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
};

try {
  const baseline = run(pristine);
  if (baseline.status !== 0) throw new Error(`BASELINE_FAILED\n${baseline.stderr}`);

  const mutations = [
    {
      name: "extra contradictory top-level field",
      code: "CANDIDATE_KEYS",
      mutate: (candidate) => {
        candidate.user_visual_approval = true;
      },
    },
    {
      name: "authority-status drift",
      code: "AUTHORITY_STATUS",
      mutate: (candidate) => {
        candidate.authority_status = "LIVE_AUTHORITY";
      },
    },
    {
      name: "candidate-self-referenced input hash",
      code: "AVATAR_SOURCE_HASH",
      mutate: (candidate) => {
        candidate.owned_inputs.avatar_source_sha256 = `sha256:${"0".repeat(64)}`;
      },
    },
    {
      name: "unproven lineage claim",
      code: "LINEAGE_KEYS",
      mutate: (candidate) => {
        candidate.sealed_lineage.unproven_runtime = "invented";
      },
    },
    {
      name: "invented source-image probe fact",
      code: "AVATAR_PROBE",
      mutate: (candidate) => {
        candidate.owned_inputs.avatar_source_probe.width = 1600;
      },
    },
    {
      name: "invented source-audio probe fact",
      code: "SOURCE_AUDIO_RATE",
      mutate: (candidate) => {
        candidate.owned_inputs.native_audio_probe.sample_rate_hz = 48000;
      },
    },
    {
      name: "non-centered context crop math",
      code: "CONTEXT_CENTER_CROP_MATH",
      mutate: (candidate) => {
        candidate.profile_candidates.split.context_panel.center_crop.x = 479;
      },
    },
    {
      name: "incomplete no-authority prohibition list",
      code: "PROHIBITED_WITHOUT_NEW_AUTHORITY",
      mutate: (candidate) => {
        candidate.activation_boundary.prohibited_without_new_authority.pop();
      },
    },
  ];

  for (const testCase of mutations) {
    const mutated = structuredClone(pristine);
    testCase.mutate(mutated);
    const result = run(mutated);
    const output = `${result.stdout}\n${result.stderr}`;
    if (result.status === 0 || !output.includes(`V208_SOULX_CROP_CANDIDATE_${testCase.code}`)) {
      throw new Error(`${testCase.name} was not rejected with ${testCase.code}\n${output}`);
    }
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("V2-08 SoulX crop candidate negative mutations PASS (8/8 rejected)");
