import path from "node:path";

import { runSoulXVf924s } from "./runpod-soulx-vf924s-live";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const finiteCapUsd = Number(process.env.VF924T_FINITE_CAP_USD);
if (!Number.isFinite(finiteCapUsd) || finiteCapUsd <= 0) {
  throw new Error("VF924T_FINITE_CAP_REQUIRED");
}

const evidence = await runSoulXVf924s({
  taskId: "VF-9-24T",
  finiteCapUsd,
  imageDigest: process.env.VF924T_SOULX_IMAGE_DIGEST ?? "",
  sourceImagePath: path.join(repositoryRoot, "elias yoder(sampe avatar).png"),
  sourceAudioPath: path.join(
    repositoryRoot,
    ".videoforge/private/vf-9-24t/soulx-second-10.00s.wav",
  ),
  artifactRoot: path.join(
    repositoryRoot,
    "outputs/soulx-flashhead-pro/vf-9-24t/elias-second-10.00s/measurement-retry",
  ),
  outputBasename: "soulx-flashhead-pro-elias-second-10.00s.mp4",
  renderCropPreviews: true,
  splitContextImagePath: path.join(
    repositoryRoot,
    "apps/web/.videoforge/cp06-phase-b/outputs/samples/cp06-owned-03.png",
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
