import path from "node:path";

import { runSoulXVf924s } from "./runpod-soulx-vf924s-live";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const finiteCapUsd = Number(process.env.VF924U_FINITE_CAP_USD);
if (!Number.isFinite(finiteCapUsd) || finiteCapUsd <= 0) {
  throw new Error("VF924U_FINITE_CAP_REQUIRED");
}

const evidence = await runSoulXVf924s({
  taskId: "VF-9-24U",
  finiteCapUsd,
  imageDigest: process.env.VF924U_SOULX_IMAGE_DIGEST ?? "",
  sourceImagePath: path.join(repositoryRoot, ".videoforge/private/vf-9-24u/new-avatar-sample.png"),
  sourceAudioPath: path.join(
    repositoryRoot,
    ".videoforge/private/vf-9-24u/new-avatar-third-10.00s.wav",
  ),
  artifactRoot: path.join(
    repositoryRoot,
    "outputs/soulx-flashhead-pro/vf-9-24u/new-avatar-third-10.00s",
  ),
  outputBasename: "soulx-flashhead-pro-new-avatar-third-10.00s.mp4",
  renderCropPreviews: true,
  fullPreviewProfile: "source-16x9-v1",
  expectedSourceImageSha256:
    "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
  expectedSourceAudioSha256:
    "sha256:51765f504d1a241af1aa05040cd06bbf377768bc3b2806000191f23855e577cb",
  expectedSplitContextImageSha256:
    "sha256:844a98770bf2772becebc3dc71f3dd609fa0392295ef96d745cbdcb0ecb70f97",
  splitContextImagePath: path.join(
    repositoryRoot,
    "apps/web/.videoforge/cp06-phase-b/outputs/samples/cp06-owned-04.png",
  ),
});

process.stdout.write(
  `${JSON.stringify({
    completed_at: evidence.completed_at,
    image_digest: evidence.image_digest,
    gpu: evidence.gpu,
    volume: evidence.volume,
    lifecycle_timing: evidence.lifecycle_timing,
    output: evidence.output,
    crop_previews: evidence.crop_previews,
    avatar_economics_projection: evidence.avatar_economics_projection,
    pod_deletions: evidence.pod_deletions,
    finite_cost: evidence.finite_cost,
    final_resource_audit: evidence.final_resource_audit,
  })}\n`,
);
