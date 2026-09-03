import { PipelineDomainError } from "../errors.js";
import { buildPromptBatch } from "./batch.js";
import {
  buildRunwarePromptRequest,
  estimatePromptWriterOutputTokens,
  estimateRunwarePromptRequestInputTokens,
  RUNWARE_PROMPT_MAX_INPUT_TOKENS,
  RUNWARE_PROMPT_MAX_OUTPUT_TOKENS,
  RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
} from "./runware-deepseek-writer.js";
import type { PromptBatch, PromptBatchInput, PromptSceneInput } from "./types.js";

/** Default request input budget for one DeepSeek prompt batch. */
export const DEFAULT_PROMPT_BATCH_MAX_INPUT_TOKENS = RUNWARE_PROMPT_MAX_INPUT_TOKENS;
/** Default provider output budget available to one planned batch. */
export const DEFAULT_PROMPT_BATCH_MAX_OUTPUT_TOKENS = RUNWARE_PROMPT_MAX_OUTPUT_TOKENS;
/** Scene distance from the balanced target within which a sentence boundary wins. */
export const DEFAULT_PROMPT_BATCH_BOUNDARY_LOOKBACK = 4 as const;

export interface PromptBatchPlanningOptions {
  /** Conservative estimate of request input tokens, including wire metadata. */
  readonly maxInputTokens?: number;
  /** Maximum `settings.maxTokens` allowed for one request. */
  readonly maxOutputTokens?: number;
  /** Prefer a sentence boundary within this many scenes of the balanced target. */
  readonly naturalBoundaryLookback?: number;
}

export interface PromptBatchPlanningInput extends Omit<PromptBatchInput, "batchId" | "scenes"> {
  /** Stable prefix; the planner appends `:001`, `:002`, ... deterministically. */
  readonly batchIdPrefix: string;
  /** Stage 4's complete ordered image-scene list. It is never resplit semantically. */
  readonly scenes: readonly PromptSceneInput[];
  readonly options?: PromptBatchPlanningOptions;
}

export interface PromptBatchPlanEntry {
  readonly ordinal: number;
  readonly batchId: string;
  readonly sceneStartIndex: number;
  readonly sceneEndIndexExclusive: number;
  readonly sceneIds: readonly string[];
  readonly batch: PromptBatch;
  /** Exact UTF-8 size of the deterministic Runware request body. */
  readonly estimatedRequestBytes: number;
  /** Conservative request-token estimate derived from the exact body bytes. */
  readonly estimatedInputTokens: number;
  /** Conservative upper bound for the response before safety headroom. */
  readonly estimatedOutputTokens: number;
  /** Exact `settings.maxTokens` sent for this batch. */
  readonly maxOutputTokens: number;
  /** Whether the selected cut after this batch is sentence-aligned. */
  readonly endsAtNaturalBoundary: boolean;
}

export interface PromptBatchPlan {
  readonly planVersion: "prompt-batch-plan-v1";
  readonly batchIdPrefix: string;
  readonly totalScenes: number;
  readonly batchCount: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly totalEstimatedRequestBytes: number;
  readonly totalEstimatedInputTokens: number;
  readonly totalEstimatedOutputTokens: number;
  readonly batches: readonly PromptBatchPlanEntry[];
}

const fail = (message: string, path: readonly (string | number)[] = []): never => {
  throw new PipelineDomainError({ code: "PROMPT_INPUT_INVALID", message, path });
};

const finitePositiveInteger = (
  value: number | undefined,
  fallback: number,
  label: string,
): number => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1)
    fail(`${label} must be a positive integer.`, ["options"]);
  return result;
};

const batchIdFor = (prefix: string, ordinal: number): string =>
  `${prefix}:${String(ordinal).padStart(3, "0")}`;

const sentenceBoundary = (left: PromptSceneInput, right: PromptSceneInput): boolean =>
  left.sentenceContext !== right.sentenceContext || /[.!?]["')\]]*$/u.test(left.phrase.trim());

const normalizedGlobalInput = (
  input: PromptBatchPlanningInput,
  firstBatchId: string,
): Omit<PromptBatchInput, "batchId" | "scenes"> & { readonly first: PromptBatch } => {
  const firstScene = input.scenes[0];
  if (firstScene === undefined)
    return fail("Prompt planning requires at least one scene.", ["scenes"]);
  const first = buildPromptBatch({
    batchId: firstBatchId,
    projectTitle: input.projectTitle,
    imageStyleVersionId: input.imageStyleVersionId,
    styleProfileHash: input.styleProfileHash,
    plannerGuidance: input.plannerGuidance,
    storyContext: input.storyContext,
    continuityTags: input.continuityTags,
    scenes: [firstScene],
  });
  return {
    projectTitle: first.sanitizedProjectTitle,
    imageStyleVersionId: first.imageStyleVersionId,
    styleProfileHash: first.styleProfileHash,
    plannerGuidance: first.plannerGuidance,
    storyContext: first.storyContext,
    continuityTags: first.continuityTags,
    first,
  };
};

const normalizedScenes = (
  input: PromptBatchPlanningInput,
  global: Omit<PromptBatchInput, "batchId" | "scenes"> & { readonly first: PromptBatch },
): readonly PromptSceneInput[] => {
  const ids = new Set<string>();
  return Object.freeze(
    input.scenes.map((scene, index) => {
      const normalized = buildPromptBatch({
        ...global,
        batchId: `${global.first.batchId}:scene:${String(index + 1).padStart(6, "0")}`,
        scenes: [scene],
      }).scenes[0];
      if (!normalized) return fail("Prompt scene normalization failed.", ["scenes", index]);
      if (ids.has(normalized.sceneId))
        return fail("Scene IDs must be unique across the complete prompt plan.", [
          "scenes",
          index,
          "sceneId",
        ]);
      ids.add(normalized.sceneId);
      return normalized;
    }),
  );
};

interface Candidate {
  readonly end: number;
  readonly batch: PromptBatch;
  readonly estimatedRequestBytes: number;
  readonly estimatedInputTokens: number;
  readonly estimatedOutputTokens: number;
  readonly maxOutputTokens: number;
}

const candidateFor = (
  global: Omit<PromptBatchInput, "batchId" | "scenes"> & { readonly first: PromptBatch },
  scenes: readonly PromptSceneInput[],
  start: number,
  end: number,
  ordinal: number,
  batchIdPrefix: string,
  maxInputTokens: number,
  maxOutputTokens: number,
): Candidate | null => {
  const batch = buildPromptBatch({
    ...global,
    batchId: batchIdFor(batchIdPrefix, ordinal),
    scenes: scenes.slice(start, end),
  });
  const estimatedOutputTokens = estimatePromptWriterOutputTokens(batch.batchId, batch.scenes);
  const requestedOutputTokens = Math.max(
    2_048,
    estimatedOutputTokens + RUNWARE_PROMPT_OUTPUT_TOKEN_HEADROOM,
  );
  if (requestedOutputTokens > maxOutputTokens) return null;
  // Build the exact request once for this candidate so planning accounts for
  // schema IDs, global context, task metadata and maxTokens itself.
  const request = buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1);
  const estimatedInputTokens = estimateRunwarePromptRequestInputTokens(request.requestBytes);
  if (estimatedInputTokens > maxInputTokens) return null;
  return Object.freeze({
    end,
    batch,
    estimatedRequestBytes: new TextEncoder().encode(request.requestBytes).byteLength,
    estimatedInputTokens,
    estimatedOutputTokens,
    maxOutputTokens: request.request.settings.maxTokens,
  });
};

/**
 * Deterministically partition the complete Stage 4 image-scene list into
 * contiguous provider-sized prompt batches. The planner considers the exact
 * canonical request body and a conservative response upper bound; it never
 * imposes a script-level scene limit or changes scene order/content.
 */
export function planPromptBatches(input: PromptBatchPlanningInput): PromptBatchPlan {
  const maxInputTokens = finitePositiveInteger(
    input.options?.maxInputTokens,
    DEFAULT_PROMPT_BATCH_MAX_INPUT_TOKENS,
    "maxInputTokens",
  );
  const maxOutputTokens = finitePositiveInteger(
    input.options?.maxOutputTokens,
    DEFAULT_PROMPT_BATCH_MAX_OUTPUT_TOKENS,
    "maxOutputTokens",
  );
  const lookback = finitePositiveInteger(
    input.options?.naturalBoundaryLookback,
    DEFAULT_PROMPT_BATCH_BOUNDARY_LOOKBACK,
    "naturalBoundaryLookback",
  );
  if (maxInputTokens > RUNWARE_PROMPT_MAX_INPUT_TOKENS)
    fail(`maxInputTokens cannot exceed ${RUNWARE_PROMPT_MAX_INPUT_TOKENS}.`, [
      "options",
      "maxInputTokens",
    ]);
  if (maxOutputTokens > RUNWARE_PROMPT_MAX_OUTPUT_TOKENS)
    fail(`maxOutputTokens cannot exceed ${RUNWARE_PROMPT_MAX_OUTPUT_TOKENS}.`, [
      "options",
      "maxOutputTokens",
    ]);
  if (!Array.isArray(input.scenes) || input.scenes.length === 0)
    fail("Prompt planning requires at least one scene.", ["scenes"]);

  const firstBatchId = batchIdFor(input.batchIdPrefix, 1);
  const global = normalizedGlobalInput(input, firstBatchId);
  const scenes = normalizedScenes(input, global);
  const entries: PromptBatchPlanEntry[] = [];
  let start = 0;
  while (start < scenes.length) {
    const candidates: Candidate[] = [];
    for (let end = start + 1; end <= scenes.length; end += 1) {
      const candidate = candidateFor(
        global,
        scenes,
        start,
        end,
        entries.length + 1,
        input.batchIdPrefix,
        maxInputTokens,
        maxOutputTokens,
      );
      if (!candidate || candidate.estimatedInputTokens > maxInputTokens) break;
      candidates.push(candidate);
    }
    const largest = candidates.at(-1);
    if (!largest)
      return fail(
        "A single prompt scene exceeds the conservative request budget; reduce its context before dispatch.",
        ["scenes", start],
      );

    // Keep the minimum feasible request count while avoiding a tiny final
    // batch. The largest valid candidate determines the lower bound; the
    // balanced target then lets natural sentence boundaries shift the cut a
    // few scenes without changing that target count in ordinary inputs.
    const remainingSceneCount = scenes.length - start;
    const minimumRemainingBatches = Math.ceil(remainingSceneCount / candidates.length);
    const targetEnd = Math.min(
      largest.end,
      start + Math.ceil(remainingSceneCount / minimumRemainingBatches),
    );
    let chosen: Candidate = candidates[targetEnd - start - 1] ?? largest;
    const naturalCandidates = candidates.filter(
      (candidate) =>
        candidate.end < scenes.length &&
        sentenceBoundary(scenes[candidate.end - 1]!, scenes[candidate.end]!) &&
        Math.abs(candidate.end - targetEnd) <= lookback,
    );
    naturalCandidates.sort(
      (left: Candidate, right: Candidate) =>
        Math.abs(left.end - targetEnd) - Math.abs(right.end - targetEnd) || right.end - left.end,
    );
    const preferredNatural = naturalCandidates[0];
    if (preferredNatural && scenes.length - preferredNatural.end !== 1) chosen = preferredNatural;

    const ordinal = entries.length + 1;
    const batch = chosen.batch;
    const entry = Object.freeze({
      ordinal,
      batchId: batch.batchId,
      sceneStartIndex: start,
      sceneEndIndexExclusive: chosen.end,
      sceneIds: Object.freeze(batch.scenes.map((scene) => scene.sceneId)),
      batch,
      estimatedRequestBytes: chosen.estimatedRequestBytes,
      estimatedInputTokens: chosen.estimatedInputTokens,
      estimatedOutputTokens: chosen.estimatedOutputTokens,
      maxOutputTokens: chosen.maxOutputTokens,
      endsAtNaturalBoundary:
        chosen.end === scenes.length ||
        sentenceBoundary(scenes[chosen.end - 1]!, scenes[chosen.end]!),
    });
    entries.push(entry);
    start = chosen.end;
  }

  const flattened = entries.flatMap((entry) => entry.sceneIds);
  const expected = scenes.map((scene) => scene.sceneId);
  if (
    flattened.length !== expected.length ||
    flattened.some((sceneId, index) => sceneId !== expected[index])
  )
    fail("Prompt batch plan must preserve every scene exactly once.", ["scenes"]);

  return Object.freeze({
    planVersion: "prompt-batch-plan-v1",
    batchIdPrefix: input.batchIdPrefix,
    totalScenes: scenes.length,
    batchCount: entries.length,
    maxInputTokens,
    maxOutputTokens,
    totalEstimatedRequestBytes: entries.reduce(
      (sum, entry) => sum + entry.estimatedRequestBytes,
      0,
    ),
    totalEstimatedInputTokens: entries.reduce((sum, entry) => sum + entry.estimatedInputTokens, 0),
    totalEstimatedOutputTokens: entries.reduce(
      (sum, entry) => sum + entry.estimatedOutputTokens,
      0,
    ),
    batches: Object.freeze(entries),
  });
}
