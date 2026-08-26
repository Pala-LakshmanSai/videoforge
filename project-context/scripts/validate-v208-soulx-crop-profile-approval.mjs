import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultApproval = path.join(
  root,
  "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json",
);
const approval = JSON.parse(readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : defaultApproval, "utf8"));
const fail = (code) => {
  throw new Error(`V208_SOULX_CROP_APPROVAL_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const exactKeys = (value, keys, code) =>
  assert(
    value && typeof value === "object" && !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort()),
    code,
  );
const hash = (relativePath) =>
  `sha256:${createHash("sha256").update(readFileSync(path.join(root, relativePath))).digest("hex")}`;

exactKeys(
  approval,
  ["schema_version", "checkpoint", "approval_id", "approved_at", "approval_source", "approval_statement", "candidate", "approved_profile", "activation"],
  "TOP_LEVEL_KEYS",
);
assert(approval.schema_version === "videoforge.v2-08-soulx-crop-profile-approval/v1", "SCHEMA");
assert(approval.checkpoint === "V2-08", "CHECKPOINT");
assert(approval.approval_id === "soulx-pro-vf924u-full-split-approval-v1", "APPROVAL_ID");
assert(approval.approved_at === "2026-08-26T00:29:52Z", "APPROVED_AT");
assert(approval.approval_source === "EXPLICIT_USER_CURRENT_CODEX_TASK", "SOURCE");
assert(approval.approval_statement === "i approve the SoulX full and split layouts.", "STATEMENT");

exactKeys(approval.candidate, ["candidate_id", "path", "sha256"], "CANDIDATE_KEYS");
assert(approval.candidate.candidate_id === "soulx-pro-vf924u-full-split-candidate-v1", "CANDIDATE_ID");
assert(
  approval.candidate.path === "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json",
  "CANDIDATE_PATH",
);
assert(approval.candidate.sha256 === hash(approval.candidate.path), "CANDIDATE_HASH");
execFileSync(process.execPath, [
  path.join(root, "project-context/scripts/validate-v208-soulx-crop-profile-candidate.mjs"),
  path.join(root, approval.candidate.path),
], { cwd: root, stdio: "pipe" });

const profile = approval.approved_profile;
exactKeys(profile, ["profile_group_id", "avatar_source_profile_id", "avatar_source_sha256", "avatar_source_geometry", "native_sample_sha256", "native_sample_geometry", "full", "split"], "PROFILE_KEYS");
assert(profile.profile_group_id === "soulx-pro-vf924u-full-split-v1", "PROFILE_GROUP");
assert(profile.avatar_source_profile_id === "soulx-pro-vf924u-approved-v1", "SOURCE_PROFILE");
assert(profile.avatar_source_sha256 === "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83", "SOURCE_HASH");
assert(JSON.stringify(profile.avatar_source_geometry) === JSON.stringify({ width: 1672, height: 941 }), "SOURCE_GEOMETRY");
assert(profile.native_sample_sha256 === "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1", "NATIVE_HASH");
assert(JSON.stringify(profile.native_sample_geometry) === JSON.stringify({ width: 512, height: 512, fps: 25 }), "NATIVE_GEOMETRY");

const samples = {
  full: {
    path: "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/ranga-style-full-16x9-corrected.mp4",
    hash: "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
    bytes: 6129069,
  },
  split: {
    path: "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s/ranga-style-split-composite-16x9-corrected.mp4",
    hash: "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
    bytes: 6980593,
  },
};
for (const [name, sample] of Object.entries(samples)) {
  assert(profile[name].sample_sha256 === sample.hash, `${name.toUpperCase()}_DECLARED_HASH`);
  assert(hash(sample.path) === sample.hash, `${name.toUpperCase()}_MEDIA_HASH`);
  assert(statSync(path.join(root, sample.path)).size === sample.bytes, `${name.toUpperCase()}_MEDIA_BYTES`);
}

const full = profile.full;
exactKeys(full, ["profile_id", "sample_sha256", "source_background_transform", "native_foreground_transform", "native_foreground_overlay", "horizontal_alpha_feather_pixels_each_edge", "output_geometry"], "FULL_KEYS");
assert(full.profile_id === "soulx-pro-ranga-full-source-composite-v1", "FULL_PROFILE");
assert(full.source_background_transform === "scale=1920:1080:flags=lanczos,fps=30", "FULL_BACKGROUND");
assert(full.native_foreground_transform === "scale=1080:1080:flags=lanczos,fps=30,format=rgba", "FULL_FOREGROUND");
assert(JSON.stringify(full.native_foreground_overlay) === JSON.stringify({ x: 420, y: 0 }), "FULL_OVERLAY");
assert(full.horizontal_alpha_feather_pixels_each_edge === 32, "FULL_FEATHER");
assert(JSON.stringify(full.output_geometry) === JSON.stringify({ width: 1920, height: 1080, fps: 30 }), "FULL_OUTPUT");

const split = profile.split;
exactKeys(split, ["profile_id", "sample_sha256", "avatar_crop", "avatar_transform", "context_transform", "context_center_crop", "layout", "output_geometry"], "SPLIT_KEYS");
assert(split.profile_id === "soulx-pro-ranga-split-composite-v1", "SPLIT_PROFILE");
assert(JSON.stringify(split.avatar_crop) === JSON.stringify({ x: 32, y: 4, width: 448, height: 504 }), "SPLIT_CROP");
assert(split.avatar_transform === "crop=448:504:32:4,scale=960:1080:flags=lanczos,fps=30", "SPLIT_TRANSFORM");
assert(split.context_transform === "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30", "CONTEXT_TRANSFORM");
assert(JSON.stringify(split.context_center_crop) === JSON.stringify({ x: 480, y: 0, width: 960, height: 1080 }), "CONTEXT_CROP");
assert(split.layout === "left-right-hstack-no-divider", "SPLIT_LAYOUT");
assert(JSON.stringify(split.output_geometry) === JSON.stringify({ width: 1920, height: 1080, fps: 30 }), "SPLIT_OUTPUT");

exactKeys(approval.activation, ["visual_approval_status", "provider_free_renderer_profile_active", "serverless_image_published", "serverless_endpoint_created", "qualification_status", "live_dispatch_authorized", "deployment_authorized", "provider_mutation_authorized", "gpu_use_authorized", "spend_authorized_usd"], "ACTIVATION_KEYS");
assert(approval.activation.visual_approval_status === "APPROVED_EXACT_FULL_AND_SPLIT", "VISUAL_STATUS");
assert(approval.activation.provider_free_renderer_profile_active === true, "PROVIDER_FREE_ACTIVE");
for (const key of ["serverless_image_published", "serverless_endpoint_created", "live_dispatch_authorized", "deployment_authorized", "provider_mutation_authorized", "gpu_use_authorized"]) assert(approval.activation[key] === false, `FENCE_${key}`);
assert(approval.activation.qualification_status === "NOT_QUALIFIED", "QUALIFICATION");
assert(approval.activation.spend_authorized_usd === 0, "SPEND");

console.log("V2-08 SoulX crop approval PASS (exact candidate/media/transforms; provider-free profile active; NOT_QUALIFIED)");
