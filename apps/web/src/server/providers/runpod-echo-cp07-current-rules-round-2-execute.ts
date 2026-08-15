import path from "node:path";

import { CP07_PREPARED_MANIFEST_SHA256, runCp07PhaseB } from "./runpod-echo-cp07-phase-b-live";

const imageDigest = process.env.CP07_ECHO_IMAGE_DIGEST ?? "";
const repositoryRoot = path.resolve(process.cwd(), "../..");
const artifactRoot = path.join(
  repositoryRoot,
  "outputs/cp07-echo-flash-turbo-fp8/cp07-current-rules-round-2",
);

const evidence = await runCp07PhaseB({
  imageDigest,
  sourceImagePath: path.join(repositoryRoot, "elias yoder(sampe avatar).png"),
  sourceAudioPath: path.join(artifactRoot, "selected-sentence-padded.wav"),
  artifactRoot,
  preparedManifestSha256: CP07_PREPARED_MANIFEST_SHA256,
  sampleDurations: [4],
});

process.stdout.write(
  `${JSON.stringify({
    checkpoint: evidence.checkpoint,
    completed_at: evidence.completed_at,
    samples: evidence.samples,
    pod_deletions: evidence.pod_deletions,
    finite_cost: evidence.finite_cost,
    final_resource_audit: evidence.final_resource_audit,
  })}\n`,
);
