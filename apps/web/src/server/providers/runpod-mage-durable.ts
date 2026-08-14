import {
  buildMageImageResult,
  LOCKED_MAGE_IMAGE,
  LOCKED_MAGE_MODEL_REVISION,
  LOCKED_MAGE_SOURCE_REVISION,
  type ImageExecutionAuthority,
  type MageImageResult,
} from "@videoforge/control-plane";

import { acceptMageResult, type MageResultAuthority } from "./runpod-mage-result";

export interface MageVisualReview {
  readonly state: "PASSED";
  readonly reviewerUserId: string;
  readonly reviewedAt: string;
  readonly findings: readonly string[];
}

export const composeDurableMageResult = (
  envelope: unknown,
  providerAuthority: MageResultAuthority,
  durableAuthority: ImageExecutionAuthority,
  reportedCostUsd: number,
  objectKey: string,
  qualityReview: MageVisualReview,
): { readonly result: MageImageResult; readonly media: Buffer } => {
  if (
    providerAuthority.attemptId !== durableAuthority.attemptId ||
    providerAuthority.sceneId !== durableAuthority.sceneId ||
    providerAuthority.promptSha256 !== durableAuthority.compiledPrompt.positivePromptSha256 ||
    providerAuthority.negativePromptSha256 !== durableAuthority.compiledPrompt.negativePromptSha256
  ) {
    throw new TypeError("MAGE_DURABLE_AUTHORITY_MISMATCH");
  }
  const accepted = acceptMageResult(envelope, providerAuthority, reportedCostUsd);
  const evidence = accepted.evidence as {
    readonly seed: number;
    readonly positive_prompt_sha256: string;
    readonly negative_prompt_sha256: string;
    readonly output_sha256: string;
    readonly runtime_evidence: Readonly<Record<string, unknown>>;
  };
  const reportedCostMicroUsd = Math.ceil(reportedCostUsd * 1_000_000);
  if (!Number.isSafeInteger(reportedCostMicroUsd)) throw new TypeError("MAGE_COST_INVALID");
  return Object.freeze({
    result: buildMageImageResult(durableAuthority, accepted.output, {
      image: LOCKED_MAGE_IMAGE,
      modelRevision: LOCKED_MAGE_MODEL_REVISION,
      sourceRevision: LOCKED_MAGE_SOURCE_REVISION,
      gpu: providerAuthority.gpu,
      seed: evidence.seed,
      positivePromptHash: evidence.positive_prompt_sha256 as `sha256:${string}`,
      negativePromptHash: evidence.negative_prompt_sha256 as `sha256:${string}`,
      outputSha256: evidence.output_sha256 as `sha256:${string}`,
      objectKey,
      reportedCostMicroUsd,
      runtimeEvidence: evidence.runtime_evidence,
      qualityReview,
    }),
    media: accepted.output,
  });
};
