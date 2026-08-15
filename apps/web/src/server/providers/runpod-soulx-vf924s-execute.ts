import path from "node:path";

import { runSoulXVf924s } from "./runpod-soulx-vf924s-live";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const evidence = await runSoulXVf924s({
  imageDigest: process.env.VF924S_SOULX_IMAGE_DIGEST ?? "",
  sourceImagePath: path.join(repositoryRoot, "elias yoder(sampe avatar).png"),
  sourceAudioPath: path.join(repositoryRoot, ".videoforge/vf-9-21/audio.wav"),
  artifactRoot: path.join(repositoryRoot, "outputs/soulx-flashhead-pro/vf-9-24s/elias-10.12s"),
});

process.stdout.write(
  `${JSON.stringify({
    completed_at: evidence.completed_at,
    image_digest: evidence.image_digest,
    gpu: evidence.gpu,
    volume: evidence.volume,
    output: evidence.output,
    pod_deletions: evidence.pod_deletions,
    finite_cost: evidence.finite_cost,
    final_resource_audit: evidence.final_resource_audit,
  })}\n`,
);
