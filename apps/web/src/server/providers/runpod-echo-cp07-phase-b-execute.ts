import path from "node:path";

import { runCp07PhaseB } from "./runpod-echo-cp07-phase-b-live";

const imageDigest = process.env.CP07_ECHO_IMAGE_DIGEST ?? "";
const repositoryRoot = path.resolve(process.cwd(), "../..");
const sourceImagePath = path.join(repositoryRoot, "elias yoder(sampe avatar).png");
const sourceAudioPath = path.join(repositoryRoot, "sampe voiceover.mp3");
const artifactRoot = path.join(repositoryRoot, "outputs/cp07-echo-flash-turbo-fp8");

const evidence = await runCp07PhaseB({
  imageDigest,
  sourceImagePath,
  sourceAudioPath,
  artifactRoot,
});
process.stdout.write(
  `${JSON.stringify({
    checkpoint: evidence.checkpoint,
    completed_at: evidence.completed_at,
    image_digest: evidence.image_digest,
    finite_cost: evidence.finite_cost,
    final_resource_audit: evidence.final_resource_audit,
  })}\n`,
);
