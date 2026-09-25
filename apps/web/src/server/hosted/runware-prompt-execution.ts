import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import { PromptExecutionError } from "@videoforge/control-plane/prompts";
import type {
  DurablePromptWriterPort,
  DurablePromptWriterResult,
  PromptWriterAttemptFact,
} from "@videoforge/control-plane/prompts";
import {
  RunwarePromptWriter,
  buildRunwarePromptRequest,
  planPromptBatches,
  runwarePromptValidationDiagnostic,
  validatePromptWriterOutput,
  type PromptBatch,
  type PromptBatchPlan,
  type PromptSceneInput,
  type PromptWriterSceneOutput,
  type RunwarePromptAttemptEvidence,
  type RunwarePromptValidationDiagnostic,
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
} from "@videoforge/pipeline/prompts";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  retrieveRunwareTextTaskDetails,
  type RunwareSafeDiagnostic,
} from "../providers/runware-http-transport";

// A long plan can contain 32 batches. Reserve at most USD 0.25 per planned batch, with an USD 8
// absolute ceiling. Unused credit is
// released on completion, and the writer stops before sending a batch with insufficient headroom.
export const HOSTED_PROMPT_RESERVATION_MICRO_USD = 8_000_000 as const;
export const HOSTED_PROMPT_RESERVATION_USD = HOSTED_PROMPT_RESERVATION_MICRO_USD / 1_000_000;

export function hostedPromptReservationMicroUsd(
  batchCount: number,
  existingReservationMicroUsd: number | null,
): number {
  if (!Number.isSafeInteger(batchCount) || batchCount < 1) throw new RangeError("Invalid batch count.");
  const reservation =
    existingReservationMicroUsd ??
    Math.min(HOSTED_PROMPT_RESERVATION_MICRO_USD, batchCount * 250_000);
  if (
    !Number.isSafeInteger(reservation) ||
    reservation < 40_000 ||
    reservation > HOSTED_PROMPT_RESERVATION_MICRO_USD
  )
    throw new RangeError("Invalid prompt reservation.");
  return reservation;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/**
 * The three values copied from `videoforge_prepare_hosted_prompt_run`.
 *
 * The database binds these values before dispatch. Keeping the binding at the
 * writer boundary means a caller cannot replace the in-memory grouping after
 * preparation and still reach Runware.
 */
export interface HostedPromptBatchPlanBinding {
  readonly plannedBatchCount: number;
  readonly plannedSceneCount: number;
  readonly batchPlanHash: Sha256Digest;
}

/** Validate one original claim through getTaskDetails; this transport never submits inference. */
export async function recoverClaimedHostedPromptBatch(input: {
  readonly apiKey: string;
  readonly plan: PromptBatchPlan;
  readonly persistedBinding: HostedPromptBatchPlanBinding;
  readonly batchOrdinal: number;
  readonly taskUUID: string;
  readonly requestBytes: string;
  readonly requestHash: Sha256Digest;
  readonly reservationMicroUsd: number;
  readonly fetcher?: typeof fetch;
}): Promise<HostedAcceptedPromptBatch> {
  const entry = input.plan.batches[input.batchOrdinal];
  if (!entry || entry.ordinal - 1 !== input.batchOrdinal) throw invalidPlanBinding();
  await validatePlanBeforeDispatch(
    { ...entry.batch, scenes: input.plan.batches.flatMap((part) => part.batch.scenes) },
    input.plan,
    input.persistedBinding,
  );
  const expected = buildRunwarePromptRequest(entry.batch, entry.batch.scenes, 1, null);
  if (
    expected.request.taskUUID !== input.taskUUID ||
    expected.requestBytes !== input.requestBytes ||
    expected.requestSha256 !== input.requestHash ||
    input.requestHash !== (await sha256Utf8(input.requestBytes))
  )
    throw invalidPlanBinding();
  const recovered = await retrieveRunwareTextTaskDetails({
    apiKey: input.apiKey,
    originalTaskUUID: input.taskUUID,
    originalRequestBytes: input.requestBytes,
    originalRequestSha256: input.requestHash,
    fetch: input.fetcher,
  });
  const recoveredText = recovered.outputText.trim();
  let nativeJsonValid = false;
  try {
    JSON.parse(recoveredText);
    nativeJsonValid = true;
  } catch {
    // Report only the shape of the archived result; never log scene content.
  }
  console.info("hosted_prompt_claimed_result_shape", {
    batch_ordinal: input.batchOrdinal,
    chars: recovered.outputText.length,
    output_tokens: recovered.usage.outputTokens,
    native_json_valid: nativeJsonValid,
    starts_object: recoveredText.startsWith("{"),
    ends_object: recoveredText.endsWith("}"),
    starts_fence: recoveredText.startsWith("```"),
    ends_fence: recoveredText.endsWith("```"),
  });
  let evidence: RunwarePromptAttemptEvidence | null = null;
  const writer = new RunwarePromptWriter({
    transport: {
      async dispatch(request) {
        if (
          request.requestBytes !== input.requestBytes ||
          request.request.taskUUID !== input.taskUUID
        )
          throw invalidPlanBinding();
        return {
          status: "succeeded" as const,
          outputText: recovered.outputText,
          usage: recovered.usage,
          costUsd: recovered.costUsd,
          finishReason: recovered.finishReason,
          providerModel: recovered.providerModel,
          latencyMs: 0,
        };
      },
    },
    evidenceSink: {
      record(value) {
        evidence = value;
      },
    },
    maximumBatchCostUsd: input.reservationMicroUsd / 1_000_000,
    semanticQualityMode: "advisory",
    allowPartialRetry: false,
    minimumBatchScenes: 1,
  });
  const output = validatePromptWriterOutput(entry.batch, await writer.write(entry.batch));
  const acceptedEvidence = evidence as RunwarePromptAttemptEvidence | null;
  const responseHash = await sha256Utf8(recovered.outputText);
  if (
    acceptedEvidence?.responseSha256 !== responseHash ||
    acceptedEvidence?.acceptedSceneIds.length !== entry.sceneIds.length ||
    acceptedEvidence.acceptedSceneIds.some((sceneId, index) => sceneId !== entry.sceneIds[index]) ||
    acceptedEvidence.unresolvedSceneIds.length !== 0
  )
    throw new Error("PROMPT_BATCH_EVIDENCE_MISMATCH");
  return Object.freeze({
    batchOrdinal: input.batchOrdinal,
    firstSceneOrdinal: entry.sceneStartIndex,
    scenes: Object.freeze(
      entry.batch.scenes.map((scene, index) =>
        Object.freeze({
          sceneOrdinal: entry.sceneStartIndex + index,
          scene,
          writerOutput: output.scenes[index]!,
        }),
      ),
    ),
    requestBytes: input.requestBytes,
    requestHash: input.requestHash,
    responseBytes: recovered.outputText,
    responseHash,
    inputTokens: recovered.usage.inputTokens,
    outputTokens: recovered.usage.outputTokens,
    reportedCostMicroUsd: actualCostMicroUsd(recovered.costUsd, input.reservationMicroUsd),
  });
}

/** Claim then submit exactly one new ordinal. A duplicate claim never reaches inference. */
export async function dispatchOneHostedPromptBatch(input: {
  readonly apiKey: string;
  readonly plan: PromptBatchPlan;
  readonly persistedBinding: HostedPromptBatchPlanBinding;
  readonly batchOrdinal: number;
  readonly remainingReservationMicroUsd: number;
  readonly claim: (request: {
    batchOrdinal: number;
    taskUUID: string;
    requestBytes: string;
    requestHash: Sha256Digest;
  }) => Promise<boolean>;
  readonly fetcher?: typeof fetch;
}): Promise<HostedAcceptedPromptBatch | null> {
  const entry = input.plan.batches[input.batchOrdinal];
  if (
    !entry ||
    entry.ordinal - 1 !== input.batchOrdinal ||
    input.remainingReservationMicroUsd < 250_000
  )
    throw invalidPlanBinding();
  await validatePlanBeforeDispatch(
    { ...entry.batch, scenes: input.plan.batches.flatMap((part) => part.batch.scenes) },
    input.plan,
    input.persistedBinding,
  );
  const expected = buildRunwarePromptRequest(entry.batch, entry.batch.scenes, 1, null);
  const claimed = await input.claim({
    batchOrdinal: input.batchOrdinal,
    taskUUID: expected.request.taskUUID,
    requestBytes: expected.requestBytes,
    requestHash: expected.requestSha256,
  });
  if (!claimed) return null;
  const ledger = new RunwareSpendLedger(input.remainingReservationMicroUsd / 1_000_000);
  const transport = new RunwarePromptHttpTransport({
    apiKey: input.apiKey,
    ledger,
    maximumRequestCostUsd: input.remainingReservationMicroUsd / 1_000_000,
    fetch: input.fetcher,
  });
  let result: RunwarePromptTransportResult | null = null;
  let evidence: RunwarePromptAttemptEvidence | null = null;
  const writer = new RunwarePromptWriter({
    transport: {
      async dispatch(request) {
        if (
          request.requestBytes !== expected.requestBytes ||
          request.requestSha256 !== expected.requestSha256
        )
          throw invalidPlanBinding();
        result = await transport.dispatch(request);
        return result;
      },
    },
    evidenceSink: {
      record(value) {
        evidence = value;
      },
    },
    maximumBatchCostUsd: input.remainingReservationMicroUsd / 1_000_000,
    semanticQualityMode: "advisory",
    allowPartialRetry: false,
    minimumBatchScenes: 1,
  });
  const output = validatePromptWriterOutput(entry.batch, await writer.write(entry.batch));
  const acceptedResult = result as RunwarePromptTransportResult | null;
  const acceptedEvidence = evidence as RunwarePromptAttemptEvidence | null;
  if (
    !acceptedResult ||
    acceptedResult.status !== "succeeded" ||
    !acceptedEvidence ||
    acceptedEvidence.acceptedSceneIds.length !== entry.sceneIds.length ||
    acceptedEvidence.acceptedSceneIds.some((sceneId, index) => sceneId !== entry.sceneIds[index]) ||
    acceptedEvidence.unresolvedSceneIds.length !== 0
  )
    throw new Error("PROMPT_BATCH_EVIDENCE_MISMATCH");
  const responseHash = await sha256Utf8(acceptedResult.outputText);
  if (responseHash !== acceptedEvidence.responseSha256)
    throw new Error("PROMPT_BATCH_EVIDENCE_MISMATCH");
  return Object.freeze({
    batchOrdinal: input.batchOrdinal,
    firstSceneOrdinal: entry.sceneStartIndex,
    scenes: Object.freeze(
      entry.batch.scenes.map((scene, index) =>
        Object.freeze({
          sceneOrdinal: entry.sceneStartIndex + index,
          scene,
          writerOutput: output.scenes[index]!,
        }),
      ),
    ),
    requestBytes: expected.requestBytes,
    requestHash: expected.requestSha256,
    responseBytes: acceptedResult.outputText,
    responseHash,
    inputTokens: acceptedResult.usage.inputTokens,
    outputTokens: acceptedResult.usage.outputTokens,
    reportedCostMicroUsd: actualCostMicroUsd(
      acceptedResult.costUsd,
      input.remainingReservationMicroUsd,
    ),
  });
}

type CapturedAttempt = {
  request: RunwarePromptTransportRequest;
  result: RunwarePromptTransportResult | null;
  evidence: RunwarePromptAttemptEvidence | null;
};

export interface HostedAcceptedPromptBatch {
  /** Zero-based durable transport ordinal. */
  readonly batchOrdinal: number;
  readonly firstSceneOrdinal: number;
  readonly scenes: readonly {
    readonly sceneOrdinal: number;
    readonly scene: PromptSceneInput;
    readonly writerOutput: PromptWriterSceneOutput;
  }[];
  readonly requestBytes: string;
  readonly requestHash: Sha256Digest;
  readonly responseBytes: string;
  readonly responseHash: Sha256Digest;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reportedCostMicroUsd: number;
}

/** Immutable accepted prefix loaded from the original run before any continuation POST. */
export interface HostedRecoveredPromptBatch {
  readonly batchOrdinal: number;
  readonly firstSceneOrdinal: number;
  readonly scenes: readonly {
    readonly sceneOrdinal: number;
    readonly sceneId: string;
    readonly writerOutput: PromptWriterSceneOutput;
  }[];
  readonly requestBytes: string;
  readonly requestHash: Sha256Digest;
  readonly responseBytes: string;
  readonly responseHash: Sha256Digest;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reportedCostMicroUsd: number;
}

export interface HostedPromptContinuationOptions {
  readonly reservationMicroUsd?: number;
  readonly acceptedBatches?: readonly HostedRecoveredPromptBatch[];
  /** A durable unique claim for this exact task must resolve before the transport sends it. */
  readonly beforeBatchSubmit?: (request: {
    readonly batchOrdinal: number;
    readonly taskUUID: string;
    readonly requestBytes: string;
    readonly requestHash: Sha256Digest;
  }) => Promise<void>;
  /** Leave headroom for a provider bill whose amount is known only after its response. */
  readonly minimumNextBatchMicroUsd?: number;
}

export type HostedPromptFailureState = "FAILED" | "UNKNOWN";
export type HostedPromptProblemCode =
  | "HOSTED_PROMPT_INPUT_INVALID"
  | "HOSTED_PROMPT_OUTPUT_INVALID"
  | "HOSTED_PROMPT_PROVIDER_REJECTED"
  | "HOSTED_PROMPT_EXECUTION_UNKNOWN";

/**
 * Carries only bounded, non-secret provider diagnostics through the generic
 * prompt service. PromptExecutionError is intentional: the durable service
 * preserves known prompt errors instead of replacing them with OUTPUT_INVALID.
 */
export class HostedPromptExecutionError extends PromptExecutionError {
  public override readonly name = "HostedPromptExecutionError";

  public constructor(
    public readonly problemCode: HostedPromptProblemCode,
    public readonly terminalState: HostedPromptFailureState,
    public readonly providerMayHaveCharged: boolean,
    public readonly diagnostic: RunwareSafeDiagnostic | null,
    public readonly additionalKnownCostMicroUsd: number = 0,
    public readonly validationDiagnostic: RunwarePromptValidationDiagnostic | null = null,
  ) {
    super("OUTPUT_INVALID", problemCode);
  }
}

async function sha256Utf8(value: string): Promise<Sha256Digest> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function actualCostMicroUsd(
  value: number,
  reservationMicroUsd: number = HOSTED_PROMPT_RESERVATION_MICRO_USD,
): number {
  if (!Number.isFinite(value) || value < 0 || value > reservationMicroUsd / 1_000_000)
    throw new RangeError("Runware prompt cost exceeds the hosted prompt reservation.");
  return Math.ceil(value * 1_000_000);
}

/**
 * This projection must stay byte-for-byte compatible with the document hashed
 * by `hostedPromptBatchPlanDocument` during preparation. It intentionally
 * includes every grouping and sizing field, not only the flattened scene IDs.
 */
function hostedPromptBatchPlanDocument(plan: PromptBatchPlan): Record<string, unknown> {
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

/** Return the canonical adaptive plan hash persisted by hosted preparation. */
export async function hostedPromptBatchPlanHash(plan: PromptBatchPlan): Promise<Sha256Digest> {
  return sha256Utf8(canonicalizeJson(hostedPromptBatchPlanDocument(plan)));
}

function invalidPlanBinding(): HostedPromptExecutionError {
  return new HostedPromptExecutionError("HOSTED_PROMPT_INPUT_INVALID", "FAILED", false, null);
}

function validPositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/**
 * Rebuild the deterministic plan from the exact Stage 4 batch supplied to the
 * durable prompt service, then compare it with both the plan object that will
 * drive dispatch and the plan metadata sealed by preparation. This runs before
 * constructing the HTTP transport, so every mismatch is provider-free.
 */
async function validatePlanBeforeDispatch(
  batch: PromptBatch,
  plan: PromptBatchPlan,
  persistedBinding?: HostedPromptBatchPlanBinding,
): Promise<void> {
  try {
    const recomputed = planPromptBatches({
      batchIdPrefix: plan.batchIdPrefix,
      projectTitle: batch.sanitizedProjectTitle,
      imageStyleVersionId: batch.imageStyleVersionId,
      styleProfileHash: batch.styleProfileHash,
      styleTreatment: batch.styleTreatment,
      plannerGuidance: batch.plannerGuidance,
      storyContext: batch.storyContext,
      continuityTags: batch.continuityTags,
      scenes: batch.scenes,
      options: {
        maxInputTokens: plan.maxInputTokens,
        maxOutputTokens: plan.maxOutputTokens,
      },
    });
    const [recomputedHash, suppliedPlanHash] = await Promise.all([
      hostedPromptBatchPlanHash(recomputed),
      hostedPromptBatchPlanHash(plan),
    ]);
    const flattenedPlanSceneIds = plan.batches.flatMap((entry) => entry.sceneIds);
    const batchSceneIds = batch.scenes.map((scene) => scene.sceneId);
    const batchContentMatches =
      plan.batches.length === recomputed.batches.length &&
      plan.batches.every((entry, index) => {
        const expected = recomputed.batches[index];
        if (!expected) return false;
        try {
          return canonicalizeJson(entry.batch) === canonicalizeJson(expected.batch);
        } catch {
          return false;
        }
      });
    if (
      !validPositiveInteger(plan.totalScenes) ||
      !validPositiveInteger(plan.batchCount) ||
      plan.totalScenes !== batch.scenes.length ||
      plan.batchCount !== plan.batches.length ||
      flattenedPlanSceneIds.length !== batchSceneIds.length ||
      flattenedPlanSceneIds.some((sceneId, index) => sceneId !== batchSceneIds[index]) ||
      !batchContentMatches ||
      suppliedPlanHash !== recomputedHash ||
      plan.totalScenes !== recomputed.totalScenes ||
      plan.batchCount !== recomputed.batchCount ||
      plan.batchIdPrefix !== recomputed.batchIdPrefix
    )
      throw invalidPlanBinding();
    if (persistedBinding !== undefined) {
      if (
        !validPositiveInteger(persistedBinding.plannedBatchCount) ||
        !validPositiveInteger(persistedBinding.plannedSceneCount) ||
        !SHA256.test(persistedBinding.batchPlanHash) ||
        persistedBinding.plannedBatchCount !== recomputed.batchCount ||
        persistedBinding.plannedSceneCount !== recomputed.totalScenes ||
        persistedBinding.batchPlanHash !== recomputedHash
      )
        throw invalidPlanBinding();
    }
  } catch (error) {
    if (error instanceof HostedPromptExecutionError) throw error;
    throw invalidPlanBinding();
  }
}

export class HostedRunwarePromptWriter implements DurablePromptWriterPort {
  public readonly operation = "runware.write" as const;

  public constructor(
    private readonly apiKey: string,
    private readonly plan: PromptBatchPlan,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onBatchAccepted?: (batch: HostedAcceptedPromptBatch) => Promise<void> | void,
    private readonly persistedBinding?: HostedPromptBatchPlanBinding,
    private readonly continuation: HostedPromptContinuationOptions = {},
  ) {
    if (apiKey.trim().length === 0) throw new TypeError("Runware API key is required.");
  }

  public async write(batch: PromptBatch): Promise<DurablePromptWriterResult> {
    await validatePlanBeforeDispatch(batch, this.plan, this.persistedBinding);
    const reservationMicroUsd =
      this.continuation.reservationMicroUsd ?? HOSTED_PROMPT_RESERVATION_MICRO_USD;
    const minimumNextBatchMicroUsd = this.continuation.minimumNextBatchMicroUsd ?? 250_000;
    if (
      !Number.isSafeInteger(reservationMicroUsd) ||
      reservationMicroUsd < 1 ||
      reservationMicroUsd > HOSTED_PROMPT_RESERVATION_MICRO_USD ||
      !Number.isSafeInteger(minimumNextBatchMicroUsd) ||
      minimumNextBatchMicroUsd < 0 ||
      minimumNextBatchMicroUsd > reservationMicroUsd ||
      (this.continuation.acceptedBatches && !this.continuation.beforeBatchSubmit)
    )
      throw invalidPlanBinding();
    const ledger = new RunwareSpendLedger(reservationMicroUsd / 1_000_000);
    const diagnosticState: { current: RunwareSafeDiagnostic | null } = { current: null };
    const acceptedScenes: PromptWriterSceneOutput[] = [];
    const batchFacts: HostedAcceptedPromptBatch[] = [];
    const captured: CapturedAttempt[] = [];
    let currentDispatchStart = 0;
    let persistenceStarted = false;
    let claimUncertain = false;
    try {
      const recovered = this.continuation.acceptedBatches ?? [];
      if (recovered.length > this.plan.batches.length) throw invalidPlanBinding();
      for (const [index, saved] of recovered.entries()) {
        const entry = this.plan.batches[index];
        if (
          !entry ||
          saved.batchOrdinal !== index ||
          saved.firstSceneOrdinal !== entry.sceneStartIndex ||
          saved.scenes.length !== entry.sceneIds.length ||
          saved.scenes.some(
            (scene, sceneIndex) =>
              scene.sceneOrdinal !== entry.sceneStartIndex + sceneIndex ||
              scene.sceneId !== entry.sceneIds[sceneIndex],
          ) ||
          !Number.isSafeInteger(saved.reportedCostMicroUsd) ||
          saved.reportedCostMicroUsd < 0 ||
          !Number.isSafeInteger(saved.inputTokens) ||
          saved.inputTokens < 0 ||
          !Number.isSafeInteger(saved.outputTokens) ||
          saved.outputTokens < 0 ||
          saved.requestHash !== (await sha256Utf8(saved.requestBytes)) ||
          saved.responseHash !== (await sha256Utf8(saved.responseBytes))
        )
          throw invalidPlanBinding();
        const request = buildRunwarePromptRequest(entry.batch, entry.batch.scenes, 1, null);
        if (
          saved.requestHash !== request.requestSha256 ||
          saved.requestBytes !== request.requestBytes
        )
          throw invalidPlanBinding();
        const output = validatePromptWriterOutput(entry.batch, {
          batch_id: entry.batch.batchId,
          scenes: saved.scenes.map((scene) => scene.writerOutput),
        });
        const costUsd = saved.reportedCostMicroUsd / 1_000_000;
        ledger.reserve(costUsd || Number.EPSILON);
        ledger.settle(costUsd || Number.EPSILON, costUsd);
        acceptedScenes.push(...output.scenes);
        batchFacts.push({
          ...saved,
          scenes: saved.scenes.map((scene, sceneIndex) => ({
            sceneOrdinal: scene.sceneOrdinal,
            scene: entry.batch.scenes[sceneIndex]!,
            writerOutput: scene.writerOutput,
          })),
        });
      }
      for (const entry of this.plan.batches.slice(recovered.length)) {
        const remainingReservationUsd = ledger.snapshot().remainingUsd;
        if (remainingReservationUsd * 1_000_000 < minimumNextBatchMicroUsd)
          throw new RangeError("Runware prompt reservation is exhausted.");
        const base = new RunwarePromptHttpTransport({
          apiKey: this.apiKey,
          ledger,
          maximumRequestCostUsd: remainingReservationUsd,
          fetch: this.fetcher,
          onDiagnostic(diagnostic) {
            diagnosticState.current = diagnostic;
          },
        });
        currentDispatchStart = captured.length;
        persistenceStarted = false;
        const transport: RunwarePromptTransport = {
          dispatch: async (request) => {
            try {
              await this.continuation.beforeBatchSubmit?.({
                batchOrdinal: entry.ordinal - 1,
                taskUUID: request.request.taskUUID,
                requestBytes: request.requestBytes,
                requestHash: request.requestSha256,
              });
            } catch {
              claimUncertain = true;
              throw new Error("HOSTED_PROMPT_BATCH_CLAIM_UNCONFIRMED");
            }
            const row: CapturedAttempt = { request, result: null, evidence: null };
            captured.push(row);
            const result = await base.dispatch(request);
            row.result = result;
            return result;
          },
        };
        const writer = new RunwarePromptWriter({
          transport,
          evidenceSink: {
            record(evidence) {
              const row = captured.at(-1);
              if (!row || row.evidence) throw new Error("PROMPT_ATTEMPT_EVIDENCE_CONFLICT");
              row.evidence = evidence;
            },
          },
          maximumBatchCostUsd: remainingReservationUsd,
          semanticQualityMode: "advisory",
          allowPartialRetry: false,
          minimumBatchScenes: 1,
        });
        const output = validatePromptWriterOutput(entry.batch, await writer.write(entry.batch));
        const row = captured.at(-1);
        const result = row?.result;
        const evidence = row?.evidence;
        if (!row || !result || result.status !== "succeeded" || !evidence)
          throw new Error("PROMPT_BATCH_NOT_DURABLY_REPORTABLE");
        const responseBytes = result.outputText;
        const responseHash = await sha256Utf8(responseBytes);
        if (
          responseHash !== evidence.responseSha256 ||
          evidence.acceptedSceneIds.length !== entry.sceneIds.length ||
          evidence.acceptedSceneIds.some((sceneId, index) => sceneId !== entry.sceneIds[index]) ||
          evidence.unresolvedSceneIds.length !== 0
        )
          throw new Error("PROMPT_BATCH_EVIDENCE_MISMATCH");
        const fact = Object.freeze({
          batchOrdinal: entry.ordinal - 1,
          firstSceneOrdinal: entry.sceneStartIndex,
          scenes: Object.freeze(
            entry.batch.scenes.map((scene, index) =>
              Object.freeze({
                sceneOrdinal: entry.sceneStartIndex + index,
                scene,
                writerOutput: output.scenes[index]!,
              }),
            ),
          ),
          requestBytes: row.request.requestBytes,
          requestHash: row.request.requestSha256,
          responseBytes,
          responseHash,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reportedCostMicroUsd: actualCostMicroUsd(result.costUsd, reservationMicroUsd),
        });
        persistenceStarted = true;
        await this.onBatchAccepted?.(fact);
        persistenceStarted = false;
        acceptedScenes.push(...output.scenes);
        batchFacts.push(fact);
      }
      const output = validatePromptWriterOutput(batch, {
        batch_id: batch.batchId,
        scenes: acceptedScenes,
      });
      const requestBytes = canonicalizeJson({
        schema_version: "videoforge.runware-adaptive-batch-request-set/v1",
        requests: batchFacts.map((fact) => ({
          batch_ordinal: fact.batchOrdinal,
          scene_ids: fact.scenes.map((scene) => scene.scene.sceneId),
          request_bytes: fact.requestBytes,
          request_hash: fact.requestHash,
        })),
      });
      const responseBytes = canonicalizeJson({
        schema_version: "videoforge.runware-adaptive-batch-response-set/v1",
        responses: batchFacts.map((fact) => ({
          batch_ordinal: fact.batchOrdinal,
          scene_ids: fact.scenes.map((scene) => scene.scene.sceneId),
          response_bytes: fact.responseBytes,
          response_hash: fact.responseHash,
        })),
      });
      const attempts: readonly PromptWriterAttemptFact[] = Object.freeze([
        Object.freeze({
          attemptIndex: 1,
          requestedSceneIds: Object.freeze(batch.scenes.map((scene) => scene.sceneId)),
          requestBytes,
          requestHash: await sha256Utf8(requestBytes),
          responseBytes,
          responseHash: await sha256Utf8(responseBytes),
          retryOfRequestHash: null,
          acceptedSceneIds: Object.freeze(batch.scenes.map((scene) => scene.sceneId)),
          unresolvedSceneIds: Object.freeze([]),
          inputTokens: batchFacts.reduce((total, fact) => total + fact.inputTokens, 0),
          outputTokens: batchFacts.reduce((total, fact) => total + fact.outputTokens, 0),
          reportedCostMicroUsd: batchFacts.reduce(
            (total, fact) => total + fact.reportedCostMicroUsd,
            0,
          ),
        }),
      ]);
      return Object.freeze({ output, attempts });
    } catch (error) {
      if (error instanceof HostedPromptExecutionError) throw error;
      if (claimUncertain)
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_EXECUTION_UNKNOWN",
          "UNKNOWN",
          true,
          diagnosticState.current,
        );
      if (persistenceStarted) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_EXECUTION_UNKNOWN",
          "UNKNOWN",
          true,
          diagnosticState.current,
        );
      }
      const current = captured.length > currentDispatchStart ? captured.at(-1) : null;
      const preDispatchFailure = current === null;
      const definiteProviderRejection = current?.result?.status === "failed";
      if (preDispatchFailure) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_INPUT_INVALID",
          "FAILED",
          false,
          diagnosticState.current,
        );
      }
      if (definiteProviderRejection) {
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_PROVIDER_REJECTED",
          "FAILED",
          false,
          diagnosticState.current,
        );
      }
      if (current?.result?.status === "succeeded") {
        // The route logs the same fields, but a batch that failed local validation with no visible
        // reason is exactly what kept stage 5 opaque, so the cause is recorded where it happens.
        const invalidDiagnostic = runwarePromptValidationDiagnostic(error);
        if (invalidDiagnostic)
          console.warn(
            `hosted_prompt_output_invalid batch=${captured.at(-1)?.request.request.taskUUID ?? "-"} category=${invalidDiagnostic.category} reason=${invalidDiagnostic.reason} requested=${invalidDiagnostic.requestedSceneCount} returned=${invalidDiagnostic.returnedSceneCount} valid=${invalidDiagnostic.locallyValidSceneCount}`,
          );
        throw new HostedPromptExecutionError(
          "HOSTED_PROMPT_OUTPUT_INVALID",
          "FAILED",
          false,
          diagnosticState.current,
          actualCostMicroUsd(current.result.costUsd, reservationMicroUsd),
          runwarePromptValidationDiagnostic(error),
        );
      }
      throw new HostedPromptExecutionError(
        "HOSTED_PROMPT_EXECUTION_UNKNOWN",
        "UNKNOWN",
        true,
        diagnosticState.current,
      );
    }
  }
}
