import type { Sha256Digest } from "@videoforge/contracts";

export const IN_IMAGE_SHOT_ROLES = [
  "ENVIRONMENTAL_WIDE",
  "HUMAN_MEDIUM",
  "HANDS_ACTION",
  "OBJECT_EVIDENCE",
  "MACRO_DETAIL",
  "REACTION_RESULT",
] as const;

export type InImageShotRole = (typeof IN_IMAGE_SHOT_ROLES)[number];
export type ImagePromptLayout = "IMAGE_FULL" | "SPLIT_RIGHT_IMAGE";

export interface PromptSceneInput {
  readonly sceneId: string;
  readonly phrase: string;
  readonly priorContext: string | null;
  readonly nextContext: string | null;
  readonly inImageShotRole: InImageShotRole;
  readonly layout: ImagePromptLayout;
}

export interface PromptBatchInput {
  readonly batchId: string;
  readonly projectTitle: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  readonly plannerGuidance: string;
  readonly continuityTags: readonly string[];
  readonly scenes: readonly PromptSceneInput[];
}

export interface PromptWriterSceneOutput {
  readonly scene_id: string;
  readonly literal_subject: string;
  readonly action: string;
  readonly environment: string;
  readonly in_image_shot_role: InImageShotRole;
  readonly lighting_context: string;
  readonly continuity_tags: readonly string[];
  readonly prompt_core: string;
}

export interface PromptWriterBatchOutput {
  readonly batch_id: string;
  readonly scenes: readonly PromptWriterSceneOutput[];
}

export interface PromptWriterPort {
  write(batch: PromptBatch): Promise<unknown>;
}

export interface PromptBatch {
  readonly scenePromptWriterVersion: "scene-prompt-writer-v1";
  readonly batchId: string;
  readonly sanitizedProjectTitle: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: Sha256Digest;
  readonly plannerGuidance: string;
  readonly continuityTags: readonly string[];
  readonly scenes: readonly PromptSceneInput[];
}

export interface PromptStyleComponents {
  readonly positiveSuffix: string;
  readonly negativeSuffix: string;
  readonly fullImageGuidance: string;
  readonly splitImageGuidance: string;
}

export interface CompilePromptRequest {
  readonly writerOutput: PromptWriterSceneOutput;
  readonly expectedScene: PromptSceneInput;
  readonly style: PromptStyleComponents;
  readonly extraPromptKeywords: string | null;
  readonly applyExtraPromptKeywords: boolean;
}

export interface CompiledImagePrompt {
  readonly promptCompilerVersion: "prompt-compiler-v1";
  readonly scenePromptWriterVersion: "scene-prompt-writer-v1";
  readonly sceneId: string;
  readonly components: {
    readonly literalContent: string;
    readonly continuityAndShotRole: string;
    readonly cropGuidance: string;
    readonly stylePositiveSuffix: string;
    readonly extraPromptKeywords: string | null;
    readonly permanentPositiveGuardrail: string;
    readonly styleNegativeSuffix: string;
    readonly permanentNegativeGuardrail: string;
  };
  readonly positivePrompt: string;
  readonly negativePrompt: string;
  readonly positivePromptUtf8Bytes: number;
  readonly negativePromptUtf8Bytes: number;
  readonly positivePromptSha256: Sha256Digest;
  readonly negativePromptSha256: Sha256Digest;
}
