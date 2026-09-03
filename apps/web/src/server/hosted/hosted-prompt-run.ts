import {
  DurablePromptExecutionService,
  promptExecutionInputHash,
  type AcceptedPromptExecution,
  type PromptExecutionAuthority,
  type PromptExecutionCommand,
  type PromptExecutionScope,
  type PromptExecutionStore,
} from "@videoforge/control-plane/prompts";
import { type ImageStyleProfileDocument, type Sha256Digest } from "@videoforge/contracts";
import {
  compileImagePrompt,
  derivePromptStyleTreatment,
  planPromptBatches,
  promptStyleTreatmentPositiveSuffix,
  verifyCompiledImagePrompt,
  type CompiledImagePrompt,
  type PromptBatchPlan,
  type PromptSceneInput,
  type PromptWriterSceneOutput,
} from "@videoforge/pipeline/prompts";

import {
  HostedPromptExecutionError,
  HostedRunwarePromptWriter,
  type HostedAcceptedPromptBatch,
  type HostedPromptBatchPlanBinding,
} from "./runware-prompt-execution";

type RecordValue = Record<string, unknown>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ROLES = new Set([
  "ENVIRONMENTAL_WIDE",
  "HUMAN_MEDIUM",
  "HANDS_ACTION",
  "OBJECT_EVIDENCE",
  "MACRO_DETAIL",
  "REACTION_RESULT",
]);

function record(value: unknown, label: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${label} is invalid.`);
  return value as RecordValue;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} is invalid.`);
  return value;
}

function extraPromptKeywords(value: unknown, enabled: boolean): string | null {
  if (!enabled) {
    if (value === null) return null;
    if (typeof value !== "string") throw new TypeError("extra prompt keywords are invalid.");
    return value;
  }
  return string(value, "enabled extra prompt keywords");
}

function compactStoryContext(value: unknown): string {
  const encoded = string(value, "story context");
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch {
    throw new TypeError("Hosted story context is invalid.");
  }
  const context = record(parsed, "hosted story context");
  const keys = ["continuity", "resolved_references", "subject", "visual_facts"];
  const actualKeys = Object.keys(context).sort();
  if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index]))
    throw new TypeError("Hosted story context is invalid.");
  const normalized = (candidate: unknown, maximum: number) => {
    if (typeof candidate !== "string") throw new TypeError("Hosted story context is invalid.");
    const result = candidate.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (result.length === 0 || Array.from(result).length > maximum)
      throw new TypeError("Hosted story context is invalid.");
    return result;
  };
  const normalizedList = (candidate: unknown, maximumItems: number, maximumChars: number) => {
    if (!Array.isArray(candidate) || candidate.length > maximumItems)
      throw new TypeError("Hosted story context is invalid.");
    const result = candidate.map((item) => normalized(item, maximumChars));
    if (new Set(result).size !== result.length)
      throw new TypeError("Hosted story context is invalid.");
    return result;
  };
  const subject = normalized(context.subject, 90);
  const visualFacts = normalizedList(context.visual_facts, 3, 70);
  const continuity = normalizedList(context.continuity, 2, 70);
  const references = normalizedList(context.resolved_references, 2, 70);
  const reusableFacts = [...visualFacts, ...continuity, ...references];
  if (new Set(reusableFacts).size !== reusableFacts.length)
    throw new TypeError("Hosted story context is invalid.");
  const result = [
    `Subject: ${subject}`,
    visualFacts.length > 0 ? `Visual facts: ${visualFacts.join("; ")}` : null,
    continuity.length > 0 ? `Continuity: ${continuity.join("; ")}` : null,
    references.length > 0 ? `Resolve: ${references.join("; ")}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" | ");
  if (result.length > 360) throw new TypeError("Hosted story context is invalid.");
  return result;
}

type SentenceWindow = {
  readonly sentence: string;
  readonly previous: string | null;
  readonly next: string | null;
};

type TranscriptWindows = {
  readonly windows: ReadonlyMap<string, SentenceWindow>;
  readonly orderedSegmentIds: readonly string[];
};

const normalizedWindowText = (value: string): string =>
  value.normalize("NFKC").replace(/\s+/gu, " ").trim();

function boundedWindowText(
  value: string,
  maximum: number,
  edge: "start" | "end" = "start",
): string {
  const normalized = normalizedWindowText(value);
  if (normalized.length <= maximum) return normalized;
  if (edge === "end") {
    const candidate = normalized.slice(-maximum);
    const boundary = candidate.indexOf(" ");
    return (boundary === -1 ? candidate : candidate.slice(boundary + 1)).trim();
  }
  const candidate = normalized.slice(0, maximum);
  const boundary = candidate.lastIndexOf(" ");
  return (boundary === -1 ? candidate : candidate.slice(0, boundary)).trim();
}

function sentenceWindows(value: unknown): TranscriptWindows {
  if (!Array.isArray(value) || value.length === 0)
    throw new TypeError("Hosted transcript segment collection is invalid.");
  const segments = value.map((candidate) => {
    const segment = record(candidate, "transcript segment");
    return {
      id: string(segment.scene_id, "transcript segment id"),
      index: Number(segment.segment_index),
      phrase: string(segment.phrase, "transcript segment phrase"),
    };
  });
  if (
    segments.some((segment) => !Number.isSafeInteger(segment.index) || segment.index < 0) ||
    new Set(segments.map((segment) => segment.id)).size !== segments.length ||
    new Set(segments.map((segment) => segment.index)).size !== segments.length
  )
    throw new TypeError("Hosted transcript segment order is invalid.");
  segments.sort((left, right) => left.index - right.index);
  const windows = new Map<string, SentenceWindow>();
  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    const next = segments[index + 1];
    windows.set(segment.id, {
      // Stage 4 already owns deterministic scene splitting. Reassembling those
      // fragments by punctuation can accidentally reproduce most of the
      // transcript for every scene when the fragments contain no terminal
      // punctuation. Keep the exact current fragment authoritative and supply
      // only its immediate narration neighbors for local disambiguation.
      sentence: boundedWindowText(segment.phrase, 2_000),
      previous: previous ? boundedWindowText(previous.phrase, 1_000, "end") : null,
      next: next ? boundedWindowText(next.phrase, 1_000) : null,
    });
  });
  return Object.freeze({
    windows,
    orderedSegmentIds: Object.freeze(segments.map((segment) => segment.id)),
  });
}

function parseScenes(
  value: unknown,
  windows: ReadonlyMap<string, SentenceWindow>,
): readonly PromptSceneInput[] {
  if (!Array.isArray(value) || value.length < 1)
    throw new TypeError("Hosted prompt scene collection is invalid.");
  return Object.freeze(
    value.map((candidate) => {
      const scene = record(candidate, "prompt scene");
      const role = string(scene.in_image_shot_role, "prompt scene role");
      const layout = string(scene.layout, "prompt scene layout");
      const sceneId = string(scene.scene_id, "prompt scene id");
      const phrase = string(scene.phrase, "prompt scene phrase");
      const context = windows.get(sceneId);
      if (!ROLES.has(role) || !["IMAGE_FULL", "SPLIT_RIGHT_IMAGE"].includes(layout))
        throw new TypeError("Hosted prompt scene authority is invalid.");
      if (!context) throw new TypeError("Hosted prompt sentence context is missing.");
      if (normalizedWindowText(phrase) !== context.sentence)
        throw new TypeError("Hosted prompt scene phrase does not match its transcript segment.");
      return Object.freeze({
        sceneId,
        phrase,
        sentenceContext: context.sentence,
        priorContext: context.previous,
        nextContext: context.next,
        inImageShotRole: role as PromptSceneInput["inImageShotRole"],
        layout: layout as PromptSceneInput["layout"],
      });
    }),
  );
}

export interface HostedPromptIdentity {
  readonly runId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly outboxId: string;
  readonly executionProfileId: string;
  readonly reservationCostEventId: string;
  readonly claimTokenHash: `sha256:${string}`;
}

export function hostedPromptAuthority(input: {
  readonly plan: unknown;
  readonly identity: HostedPromptIdentity;
  readonly reservedCostMicroUsd: number;
}): PromptExecutionAuthority {
  const plan = record(input.plan, "hosted prompt plan");
  const profile = record(plan.profile_payload, "hosted style profile");
  const prompt = record(profile.prompt_profile, "hosted style prompt profile");
  const transcript = sentenceWindows(plan.all_segments);
  const workspaceId = string(plan.workspace_id, "workspace id");
  const projectId = string(plan.project_id, "project id");
  const revisionId = string(plan.revision_id, "revision id");
  const timelineId = string(plan.timeline_id, "timeline id");
  const timelineHash = string(plan.timeline_hash, "timeline hash");
  const styleVersionId = string(plan.image_style_version_id, "style version id");
  const styleHash = string(plan.style_profile_hash, "style profile hash");
  const applyExtraPromptKeywords = plan.apply_extra_prompt_keywords === true;
  if (!DATABASE_UUID.test(workspaceId))
    throw new TypeError("Hosted workspace identity is invalid.");
  for (const id of [
    projectId,
    revisionId,
    timelineId,
    styleVersionId,
    input.identity.taskId,
    input.identity.attemptId,
    input.identity.outboxId,
  ])
    if (!UUID.test(id)) throw new TypeError("Hosted prompt identity is invalid.");
  if (
    !SHA256.test(timelineHash) ||
    !SHA256.test(styleHash) ||
    plan.revision_style_hash !== styleHash ||
    plan.revision_state !== "LOCKED" ||
    plan.style_state !== "PUBLISHED" ||
    plan.existing_run_state !== null ||
    typeof plan.spend_cap_usd !== "number" ||
    plan.spend_cap_usd < input.reservedCostMicroUsd / 1_000_000
  )
    throw new TypeError("Hosted prompt plan is not executable.");
  const visualProfile = record(
    profile.visual_profile,
    "hosted style visual profile",
  ) as unknown as ImageStyleProfileDocument["visual_profile"];
  const styleTreatment = derivePromptStyleTreatment(visualProfile, styleHash as Sha256Digest);
  const scenes = parseScenes(plan.scenes, transcript.windows);
  const imageSceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const expectedSceneOrder = transcript.orderedSegmentIds.filter((sceneId) =>
    imageSceneIds.has(sceneId),
  );
  if (
    expectedSceneOrder.length !== scenes.length ||
    expectedSceneOrder.some((sceneId, index) => sceneId !== scenes[index]?.sceneId)
  )
    throw new TypeError("Hosted prompt scene order does not match its transcript segments.");
  const base: PromptExecutionAuthority = Object.freeze({
    workspaceId,
    projectId,
    revisionId,
    projectTitle: string(plan.project_title, "project title"),
    revisionState: "GENERATING",
    timelineId,
    timelineHash: timelineHash as `sha256:${string}`,
    timelineState: "CURRENT",
    imageStyleVersionId: styleVersionId,
    styleProfileHash: styleHash as `sha256:${string}`,
    styleState: "PUBLISHED",
    plannerGuidance: string(prompt.planner_guidance, "planner guidance"),
    styleTreatment,
    storyContext: compactStoryContext(plan.story_context),
    style: Object.freeze({
      // The immutable visual profile is the sole source for positive style
      // treatment. The legacy prompt_profile positive_suffix remains stored
      // for compatibility/audit but cannot reach compilation.
      positiveSuffix: promptStyleTreatmentPositiveSuffix(styleTreatment),
      negativeSuffix: string(prompt.negative_suffix, "negative suffix"),
      fullImageGuidance: string(prompt.full_image_guidance, "full image guidance"),
      splitImageGuidance: string(prompt.split_image_guidance, "split image guidance"),
    }),
    // Disabled keywords are preserved as revision data but are intentionally not
    // required to be non-empty or interpreted. The compiler ignores them unless
    // the explicit apply toggle is true.
    extraPromptKeywords: extraPromptKeywords(plan.extra_prompt_keywords, applyExtraPromptKeywords),
    applyExtraPromptKeywords,
    continuityTags: Object.freeze([]),
    scenes,
    taskId: input.identity.taskId,
    taskState: "RUNNING",
    attemptId: input.identity.attemptId,
    attemptOrdinal: 1,
    attemptState: "CLAIMED",
    claimTokenHash: input.identity.claimTokenHash,
    recordedInputHash: "sha256:".padEnd(71, "0") as `sha256:${string}`,
    outboxId: input.identity.outboxId,
    outboxState: "ACKNOWLEDGED",
    reservedCostMicroUsd: input.reservedCostMicroUsd,
    accepted: null,
  });
  const authority = Object.freeze({ ...base, recordedInputHash: promptExecutionInputHash(base) });
  hostedPromptBatchPlan(authority);
  return authority;
}

/**
 * Derive transport batches from the complete immutable Stage 4 image-scene list.
 * The planner changes only request grouping; it never changes scene boundaries,
 * scene order, or the prompt-execution input hash.
 */
export function hostedPromptBatchPlan(authority: PromptExecutionAuthority): PromptBatchPlan {
  return planPromptBatches({
    batchIdPrefix: `${authority.taskId}:adaptive`,
    projectTitle: authority.projectTitle,
    imageStyleVersionId: authority.imageStyleVersionId,
    styleProfileHash: authority.styleProfileHash,
    styleTreatment: authority.styleTreatment,
    plannerGuidance: authority.plannerGuidance,
    storyContext: authority.storyContext,
    continuityTags: authority.continuityTags,
    scenes: authority.scenes,
  });
}

export function hostedPromptBatchPlanDocument(plan: PromptBatchPlan): Record<string, unknown> {
  return {
    schema_version: "videoforge-hosted-prompt-batch-plan/v1",
    planner_version: plan.planVersion,
    batch_id_prefix: plan.batchIdPrefix,
    total_scenes: plan.totalScenes,
    batch_count: plan.batchCount,
    max_input_tokens: plan.maxInputTokens,
    max_output_tokens: plan.maxOutputTokens,
    total_estimated_request_bytes: plan.totalEstimatedRequestBytes,
    total_estimated_input_tokens: plan.totalEstimatedInputTokens,
    total_estimated_output_tokens: plan.totalEstimatedOutputTokens,
    batches: plan.batches.map((batch) => ({
      ordinal: batch.ordinal - 1,
      batch_id: batch.batchId,
      first_scene_ordinal: batch.sceneStartIndex,
      scene_end_ordinal_exclusive: batch.sceneEndIndexExclusive,
      scene_ids: batch.sceneIds,
      estimated_request_bytes: batch.estimatedRequestBytes,
      estimated_input_tokens: batch.estimatedInputTokens,
      estimated_output_tokens: batch.estimatedOutputTokens,
      max_output_tokens: batch.maxOutputTokens,
      ends_at_natural_boundary: batch.endsAtNaturalBoundary,
    })),
  };
}

class HostedPromptStore implements PromptExecutionStore {
  public constructor(
    private readonly authority: PromptExecutionAuthority,
    private readonly persist: (accepted: AcceptedPromptExecution) => Promise<void>,
  ) {}

  public async resolve(
    scope: PromptExecutionScope,
    command: PromptExecutionCommand,
  ): Promise<PromptExecutionAuthority | null> {
    return scope.workspaceId === this.authority.workspaceId &&
      command.attemptId === this.authority.attemptId
      ? this.authority
      : null;
  }

  public async accept(
    _scope: PromptExecutionScope,
    command: { readonly acceptance: AcceptedPromptExecution },
  ): Promise<{ readonly accepted: AcceptedPromptExecution; readonly replayed: boolean }> {
    await this.persist(command.acceptance);
    return Object.freeze({ accepted: command.acceptance, replayed: false });
  }
}

export async function runHostedPromptExecution(input: {
  readonly scope: PromptExecutionScope;
  readonly authority: PromptExecutionAuthority;
  readonly batchPlan: PromptBatchPlan;
  /** Exact adaptive-plan metadata returned by hosted preparation. */
  readonly persistedBatchPlanBinding?: HostedPromptBatchPlanBinding;
  readonly command: PromptExecutionCommand;
  readonly apiKey: string;
  readonly persist: (accepted: AcceptedPromptExecution) => Promise<void>;
  readonly persistBatch?: (batch: {
    readonly batchOrdinal: number;
    readonly firstSceneOrdinal: number;
    readonly scenes: readonly {
      readonly sceneOrdinal: number;
      readonly sceneId: string;
      readonly writerOutput: PromptWriterSceneOutput;
      readonly compiledPrompt: CompiledImagePrompt;
    }[];
    readonly requestBytes: string;
    readonly requestHash: `sha256:${string}`;
    readonly responseBytes: string;
    readonly responseHash: `sha256:${string}`;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reportedCostMicroUsd: number;
  }) => Promise<void>;
  readonly fetcher?: typeof fetch;
}): Promise<AcceptedPromptExecution> {
  // The database preparation row is the authority for the provider request
  // count. Do not allow a legacy caller to reach the writer without carrying
  // that binding through this orchestration boundary.
  if (input.persistedBatchPlanBinding === undefined)
    throw new HostedPromptExecutionError("HOSTED_PROMPT_INPUT_INVALID", "FAILED", false, null);
  const persistBatch = async (accepted: HostedAcceptedPromptBatch) => {
    if (accepted.firstSceneOrdinal !== accepted.scenes[0]?.sceneOrdinal)
      throw new Error("HOSTED_PROMPT_BATCH_ORDER_INVALID");
    const scenes = accepted.scenes.map((scene, index) => {
      const expectedScene = input.authority.scenes[accepted.firstSceneOrdinal + index];
      if (
        !expectedScene ||
        scene.sceneOrdinal !== accepted.firstSceneOrdinal + index ||
        expectedScene.sceneId !== scene.scene.sceneId
      )
        throw new Error("HOSTED_PROMPT_SCENE_ORDER_INVALID");
      const compiledPrompt = compileImagePrompt({
        writerOutput: scene.writerOutput,
        expectedScene,
        style: input.authority.style,
        extraPromptKeywords: input.authority.extraPromptKeywords,
        applyExtraPromptKeywords: input.authority.applyExtraPromptKeywords,
      });
      verifyCompiledImagePrompt(compiledPrompt);
      return Object.freeze({
        sceneOrdinal: scene.sceneOrdinal,
        sceneId: expectedScene.sceneId,
        writerOutput: scene.writerOutput,
        compiledPrompt,
      });
    });
    await input.persistBatch?.({
      batchOrdinal: accepted.batchOrdinal,
      firstSceneOrdinal: accepted.firstSceneOrdinal,
      scenes: Object.freeze(scenes),
      requestBytes: accepted.requestBytes,
      requestHash: accepted.requestHash,
      responseBytes: accepted.responseBytes,
      responseHash: accepted.responseHash,
      inputTokens: accepted.inputTokens,
      outputTokens: accepted.outputTokens,
      reportedCostMicroUsd: accepted.reportedCostMicroUsd,
    });
  };
  const result = await new DurablePromptExecutionService(
    new HostedPromptStore(input.authority, input.persist),
    new HostedRunwarePromptWriter(
      input.apiKey,
      input.batchPlan,
      input.fetcher,
      persistBatch,
      input.persistedBatchPlanBinding,
    ),
    { record() {} },
    { now: () => new Date().toISOString() },
  ).execute(input.scope, input.command);
  return result.accepted;
}
