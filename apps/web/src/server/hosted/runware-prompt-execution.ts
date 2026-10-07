import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import { PromptExecutionError } from "@videoforge/control-plane/prompts";
import type {
  DurablePromptWriterPort,
  DurablePromptWriterResult,
  PromptWriterAttemptFact,
} from "@videoforge/control-plane/prompts";
import {
  RunwarePromptWriter,
  PROMPT_CONTENT_REPAIR_INSTRUCTION,
  NO_GRAPHICS_V2_WRITER_INSTRUCTION,
  buildRunwarePromptRequest,
  buildRunwarePromptCorrection,
  recoverRunwarePromptCorrection,
  isRunwareLunaPromptPolicy,
  planPromptBatches,
  runwarePromptValidationDiagnostic,
  validatePromptWriterOutput,
  type PromptBatch,
  type PromptBatchPlan,
  type PromptSceneInput,
  type PromptWriterSceneOutput,
  type RunwarePromptAttemptEvidence,
  type RunwarePromptValidationDiagnostic,
  type RunwarePromptCorrection,
  type RunwarePromptTransport,
  type RunwarePromptTransportRequest,
  type RunwarePromptTransportResult,
} from "@videoforge/pipeline/prompts";

import {
  RunwarePromptHttpTransport,
  RunwareSpendLedger,
  retrieveRunwareTextTaskDetails,
  RunwareArchivedTaskRejectedError,
  RunwareArchivedTextUnavailableError,
  type RunwareCapacityRefusal,
  type RunwareSafeDiagnostic,
} from "../providers/runware-http-transport";

import {
  RunwareLunaPromptHttpTransport,
  buildRunwareLunaPromptWireRequest,
} from "../providers/runware-luna-prompt-transport";

// Reserve USD 0.25 per planned batch, with a USD 0.50 minimum for one bounded correction
// and a USD 8 ceiling. Existing caps stay pinned; unused credit is released on completion.
export const HOSTED_PROMPT_RESERVATION_MICRO_USD = 8_000_000 as const;
export const HOSTED_PROMPT_RESERVATION_USD = HOSTED_PROMPT_RESERVATION_MICRO_USD / 1_000_000;

export function hostedPromptReservationMicroUsd(
  batchCount: number,
  existingReservationMicroUsd: number | null,
): number {
  if (!Number.isSafeInteger(batchCount) || batchCount < 1)
    throw new RangeError("Invalid batch count.");
  const reservation =
    existingReservationMicroUsd ??
    Math.max(500_000, Math.min(HOSTED_PROMPT_RESERVATION_MICRO_USD, batchCount * 250_000));
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

export class HostedPromptArchivedOutputInvalidError extends Error {
  public override readonly name = "HostedPromptArchivedOutputInvalidError";

  public constructor(
    public readonly responseHash: Sha256Digest,
    public readonly knownCostMicroUsd: number,
    public readonly validationDiagnostic: RunwarePromptValidationDiagnostic | null,
    public readonly correction: RunwarePromptCorrection | null = null,
  ) {
    super("Archived prompt output failed strict validation.");
  }
}

/** A completed, billed response whose archive redacted the output is not bad generated content. */
export class HostedPromptArchivedOutputUnavailableError extends Error {
  public override readonly name = "HostedPromptArchivedOutputUnavailableError";
  public constructor(
    public readonly responseHash: Sha256Digest,
    public readonly knownCostMicroUsd: number,
  ) {
    super("HOSTED_PROMPT_ARCHIVE_UNAVAILABLE");
  }
}

/** Capacity rejection is never output-quality evidence or paid replacement authority. */
export class HostedPromptCapacityPausedError extends Error {
  public override readonly name = "HostedPromptCapacityPausedError";
  constructor(readonly refusal: RunwareCapacityRefusal) {
    super("HOSTED_PROMPT_PROVIDER_CAPACITY_WAIT");
  }
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
  readonly retryOfRequestHash?: Sha256Digest | null;
  /** Exact private response recorded before local validation or compilation. */
  readonly recordedResult?: Extract<RunwarePromptTransportResult, { status: "succeeded" }> | null;
  readonly sourceRecordedResult?: Extract<
    RunwarePromptTransportResult,
    { status: "succeeded" }
  > | null;
  readonly recordResult?: (result: {
    taskUUID: string;
    requestHash: Sha256Digest;
    result: Extract<RunwarePromptTransportResult, { status: "succeeded" }>;
  }) => Promise<void>;
  readonly fetcher?: typeof fetch;
}): Promise<HostedAcceptedPromptBatch> {
  const entry = input.plan.batches[input.batchOrdinal];
  if (!entry || entry.ordinal - 1 !== input.batchOrdinal) throw invalidPlanBinding();
  await validatePlanBeforeDispatch(
    { ...entry.batch, scenes: input.plan.batches.flatMap((part) => part.batch.scenes) },
    input.plan,
    input.persistedBinding,
  );
  const correction = sealedCorrection(
    entry.batch,
    input.plan,
    input.requestBytes,
    input.sourceRecordedResult,
  );
  const selected = recoverSealedPromptRequest(
    entry.batch,
    input.plan,
    input.requestBytes,
    input.retryOfRequestHash,
    correction,
  );
  const expected = selected.request;
  if (
    expected.request.taskUUID !== input.taskUUID ||
    expected.requestBytes !== input.requestBytes ||
    expected.requestSha256 !== input.requestHash ||
    input.requestHash !== (await sha256Utf8(input.requestBytes))
  )
    throw invalidPlanBinding();
  // The compatible endpoint has no documented native task polling. A receipt is the only
  // recovery source; a missing reply never authorizes repeating a paid POST.
  if (isRunwareLunaPromptPolicy(input.plan.requestPolicy) && !input.recordedResult)
    throw new HostedPromptExecutionError("HOSTED_PROMPT_EXECUTION_UNKNOWN", "UNKNOWN", true, null);
  let recovered;
  try {
    recovered =
      input.recordedResult ??
      (await retrieveRunwareTextTaskDetails({
        apiKey: input.apiKey,
        originalTaskUUID: input.taskUUID,
        originalRequestBytes: input.requestBytes,
        originalRequestSha256: input.requestHash,
        fetch: input.fetcher,
      }));
  } catch (error) {
    if (error instanceof RunwareArchivedTextUnavailableError) {
      const knownCostMicroUsd = actualCostMicroUsd(error.costUsd, input.reservationMicroUsd);
      if (knownCostMicroUsd > 250_000) throw error;
      throw new HostedPromptArchivedOutputUnavailableError(error.responseHash, knownCostMicroUsd);
    }
    if (error instanceof RunwareArchivedTaskRejectedError)
      throw new HostedPromptCapacityPausedError({
        taskUUID: input.taskUUID,
        responseHash: error.responseHash,
        retryAfterMs: 30_000,
      });
    throw error;
  }
  if (!input.recordedResult)
    await input.recordResult?.({
      taskUUID: input.taskUUID,
      requestHash: input.requestHash,
      result: { ...recovered, status: "succeeded", latencyMs: 0 },
    });
  if (isRunwareLunaPromptPolicy(input.plan.requestPolicy)) {
    const wire = await buildRunwareLunaPromptWireRequest(expected);
    if (!("wireHash" in recovered) || recovered.wireHash !== wire.wireHash)
      throw invalidPlanBinding();
    requireLunaCompletion(recovered, input.reservationMicroUsd);
  }
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
    correction: correction ?? undefined,
    contentRepair: selected.contentRepair,
    requestPolicy: input.plan.requestPolicy ?? "legacy",
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
    maximumBatchCostUsd: Math.min(250_000, input.reservationMicroUsd) / 1_000_000,
    semanticQualityMode: "advisory",
    allowPartialRetry: false,
    minimumBatchScenes: 1,
  });
  let output: ReturnType<typeof validatePromptWriterOutput>;
  try {
    output = validatePromptWriterOutput(
      entry.batch,
      await writer.write(entry.batch, input.retryOfRequestHash ?? null),
    );
  } catch (error) {
    const diagnostic = runwarePromptValidationDiagnostic(error);
    if (!diagnostic) throw error;
    const knownCostMicroUsd = actualResultCostMicroUsd(recovered, input.reservationMicroUsd);
    if (knownCostMicroUsd > 250_000) throw error;
    throw new HostedPromptArchivedOutputInvalidError(
      await sha256Utf8(recovered.outputText),
      knownCostMicroUsd,
      diagnostic,
      (["validated-scenes-v1", "grounded-scenes-v1"].includes(
        input.plan.requestPolicy ?? "legacy",
      ) ||
        isRunwareLunaPromptPolicy(input.plan.requestPolicy)) &&
      !correction
        ? buildRunwarePromptCorrection(entry.batch, recovered.outputText, input.plan.requestPolicy)
        : null,
    );
  }
  const acceptedEvidence = evidence as RunwarePromptAttemptEvidence | null;
  const responseHash = await sha256Utf8(recovered.outputText);
  if (
    acceptedEvidence?.responseSha256 !== responseHash ||
    !acceptedEvidenceMatches(acceptedEvidence, entry.sceneIds, correction)
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
    reportedCostMicroUsd: actualResultCostMicroUsd(recovered, input.reservationMicroUsd),
  });
}

/** Claim then submit exactly one new ordinal. A duplicate claim never reaches inference. */
export async function dispatchOneHostedPromptBatch(input: {
  readonly contentRepair?: boolean | "no-text-v2";
  readonly correction?: RunwarePromptCorrection;
  readonly apiKey: string;
  readonly plan: PromptBatchPlan;
  readonly persistedBinding: HostedPromptBatchPlanBinding;
  readonly batchOrdinal: number;
  readonly remainingReservationMicroUsd: number;
  readonly retryOfRequestHash?: Sha256Digest | null;
  readonly claim: (request: {
    batchOrdinal: number;
    taskUUID: string;
    requestBytes: string;
    requestHash: Sha256Digest;
  }) => Promise<boolean>;
  readonly recordResult?: (result: {
    taskUUID: string;
    requestHash: Sha256Digest;
    result: Extract<RunwarePromptTransportResult, { status: "succeeded" }>;
  }) => Promise<void>;
  readonly fetcher?: typeof fetch;
  readonly onCapacityRefused?: (value: RunwareCapacityRefusal) => Promise<void>;
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
  const expected = buildRunwarePromptRequest(
    entry.batch,
    entry.batch.scenes,
    input.retryOfRequestHash ? 2 : 1,
    input.retryOfRequestHash ?? null,
    1,
    input.plan.requestPolicy ?? "legacy",
    input.contentRepair ?? false,
    input.correction,
  );
  if (isRunwareLunaPromptPolicy(input.plan.requestPolicy) && !input.recordResult)
    throw invalidPlanBinding();
  const claimed = await input.claim({
    batchOrdinal: input.batchOrdinal,
    taskUUID: expected.request.taskUUID,
    requestBytes: expected.requestBytes,
    requestHash: expected.requestSha256,
  });
  if (!claimed) return null;
  const ledger = new RunwareSpendLedger(input.remainingReservationMicroUsd / 1_000_000);
  let capacityRefusal: RunwareCapacityRefusal | null = null;
  const transport = isRunwareLunaPromptPolicy(input.plan.requestPolicy)
    ? new RunwareLunaPromptHttpTransport({
        apiKey: input.apiKey,
        ledger,
        maximumRequestCostUsd: Math.min(250_000, input.remainingReservationMicroUsd) / 1_000_000,
        fetch: input.fetcher,
        onCapacityRefused: async (value) => {
          await input.onCapacityRefused?.(value);
          capacityRefusal = value;
        },
      })
    : new RunwarePromptHttpTransport({
        apiKey: input.apiKey,
        ledger,
        maximumRequestCostUsd: Math.min(250_000, input.remainingReservationMicroUsd) / 1_000_000,
        // Historical sealed sync requests need enough time to retain their full result before timeout.
        timeoutMs: 300_000,
        fetch: input.fetcher,
        onCapacityRefused: async (value) => {
          await input.onCapacityRefused?.(value);
          capacityRefusal = value;
        },
      });
  let result: RunwarePromptTransportResult | null = null;
  let transportError: unknown;
  let evidence: RunwarePromptAttemptEvidence | null = null;
  const writer = new RunwarePromptWriter({
    correction: input.correction,
    contentRepair: input.contentRepair ?? false,
    requestPolicy: input.plan.requestPolicy ?? "legacy",
    transport: {
      async dispatch(request) {
        if (
          request.requestBytes !== expected.requestBytes ||
          request.requestSha256 !== expected.requestSha256
        )
          throw invalidPlanBinding();
        try {
          const received = await transport.dispatch(request);
          result = received;
          if (received.status === "succeeded") {
            await input.recordResult?.({
              taskUUID: request.request.taskUUID,
              requestHash: request.requestSha256,
              result: received,
            });
            if (isRunwareLunaPromptPolicy(input.plan.requestPolicy))
              requireLunaCompletion(received, input.remainingReservationMicroUsd);
          }
        } catch (error) {
          transportError = error;
          throw error;
        }
        return result;
      },
    },
    evidenceSink: {
      record(value) {
        evidence = value;
      },
    },
    maximumBatchCostUsd: Math.min(250_000, input.remainingReservationMicroUsd) / 1_000_000,
    semanticQualityMode: "advisory",
    allowPartialRetry: false,
    minimumBatchScenes: 1,
  });
  let output: ReturnType<typeof validatePromptWriterOutput>;
  try {
    output = validatePromptWriterOutput(
      entry.batch,
      await writer.write(entry.batch, input.retryOfRequestHash ?? null),
    );
  } catch (error) {
    if (capacityRefusal) throw new HostedPromptCapacityPausedError(capacityRefusal);
    if (transportError) throw transportError;
    const diagnostic = runwarePromptValidationDiagnostic(error);
    const received = result as RunwarePromptTransportResult | null;
    if (
      isRunwareLunaPromptPolicy(input.plan.requestPolicy) &&
      received?.status === "succeeded" &&
      diagnostic
    )
      // A successful receipt write precedes local validation. Preserve that exact paid response
      // for the existing bounded correction path instead of marking its outcome unknown.
      throw new HostedPromptArchivedOutputInvalidError(
        await sha256Utf8(received.outputText),
        actualResultCostMicroUsd(received, input.remainingReservationMicroUsd),
        diagnostic,
        input.correction
          ? null
          : buildRunwarePromptCorrection(
              entry.batch,
              received.outputText,
              input.plan.requestPolicy,
            ),
      );
    throw error;
  }
  const acceptedResult = result as RunwarePromptTransportResult | null;
  const acceptedEvidence = evidence as RunwarePromptAttemptEvidence | null;
  if (
    !acceptedResult ||
    acceptedResult.status !== "succeeded" ||
    !acceptedEvidence ||
    !acceptedEvidenceMatches(acceptedEvidence, entry.sceneIds, input.correction ?? null)
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
    reportedCostMicroUsd: actualResultCostMicroUsd(
      acceptedResult,
      input.remainingReservationMicroUsd,
    ),
  });
}

/** Rebuild sealed correction through the same validator before any recovery transport. */
function sealedCorrection(
  batch: PromptBatch,
  plan: PromptBatchPlan,
  requestBytes: string,
  sourceResult: Extract<RunwarePromptTransportResult, { status: "succeeded" }> | null | undefined,
): RunwarePromptCorrection | null {
  const body = JSON.parse(requestBytes) as { messages?: { role: string; content: string }[] }[];
  if (!Array.isArray(body) || body.length !== 1) throw invalidPlanBinding();
  const user = body[0]?.messages?.find((message) => message.role === "user");
  if (!user) throw invalidPlanBinding();
  const payload = JSON.parse(user.content) as {
    correction?: {
      source_output_text?: unknown;
      source_response_sha256?: unknown;
      failed_scene_ids?: unknown;
      failures?: unknown;
    };
  };
  if (!payload.correction) return null;
  if (
    (!["validated-scenes-v1", "grounded-scenes-v1"].includes(plan.requestPolicy ?? "legacy") &&
      !isRunwareLunaPromptPolicy(plan.requestPolicy)) ||
    typeof payload.correction.source_output_text !== "string"
  )
    throw invalidPlanBinding();
  if (sourceResult && sourceResult.outputText !== payload.correction.source_output_text)
    throw invalidPlanBinding();
  if (
    typeof payload.correction.source_response_sha256 !== "string" ||
    !SHA256.test(payload.correction.source_response_sha256) ||
    !Array.isArray(payload.correction.failed_scene_ids) ||
    payload.correction.failed_scene_ids.some((id) => typeof id !== "string") ||
    !Array.isArray(payload.correction.failures) ||
    payload.correction.failures.some(
      (failure) =>
        !failure ||
        typeof failure !== "object" ||
        typeof failure.scene_id !== "string" ||
        typeof failure.field !== "string" ||
        typeof failure.reason !== "string",
    )
  )
    throw invalidPlanBinding();
  const sealed: RunwarePromptCorrection = {
    sourceOutputText: payload.correction.source_output_text,
    sourceResponseSha256: payload.correction.source_response_sha256 as Sha256Digest,
    failedSceneIds: payload.correction.failed_scene_ids,
    failures: payload.correction.failures.map((failure) => ({
      sceneId: failure.scene_id,
      field: failure.field,
      reason: failure.reason,
    })),
  };
  const correction = recoverRunwarePromptCorrection(
    batch,
    payload.correction.source_output_text,
    sealed,
    plan.requestPolicy,
  );
  if (!correction) throw invalidPlanBinding();
  // The builder rederives every field and exact request-byte comparison checks the sealed envelope.
  return correction;
}

function acceptedEvidenceMatches(
  evidence: RunwarePromptAttemptEvidence | null,
  sceneIds: readonly string[],
  correction: RunwarePromptCorrection | null,
): boolean {
  if (!evidence || evidence.unresolvedSceneIds.length !== 0) return false;
  const accepted = correction?.failedSceneIds ?? sceneIds;
  const reused = correction ? sceneIds.filter((id) => !correction.failedSceneIds.includes(id)) : [];
  return (
    evidence.acceptedSceneIds.length === accepted.length &&
    evidence.acceptedSceneIds.every((id, index) => id === accepted[index]) &&
    (evidence.reusedSceneIds ?? []).length === reused.length &&
    (evidence.reusedSceneIds ?? []).every((id, index) => id === reused[index]) &&
    (correction
      ? evidence.sourceResponseSha256 === correction.sourceResponseSha256
      : !evidence.sourceResponseSha256)
  );
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
  readonly retryOfRequestHash?: Sha256Digest | null;
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
  | "HOSTED_PROMPT_PROVIDER_CREDITS_LOW"
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

/** Round new Luna estimates only once; keep historical provider-cost rounding unchanged. */
function actualResultCostMicroUsd(
  result: {
    readonly costUsd: number;
    readonly costBasis?: string;
    readonly estimatedCostMicroUsd?: number;
  },
  reservationMicroUsd: number,
): number {
  if (result.costBasis !== "PINNED_RATE_ESTIMATE")
    return actualCostMicroUsd(result.costUsd, reservationMicroUsd);
  const value = result.estimatedCostMicroUsd;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Math.min(250_000, reservationMicroUsd) ||
    result.costUsd !== value / 1_000_000
  )
    throw invalidPlanBinding();
  return value;
}

/** Known incomplete or refused output is cost evidence, never content-repair authority. */
function requireLunaCompletion(
  result: {
    readonly finishReason: string;
    readonly costUsd: number;
    readonly costBasis?: string;
    readonly estimatedCostMicroUsd?: number;
  },
  reservationMicroUsd: number,
): void {
  const cost = actualResultCostMicroUsd(result, reservationMicroUsd);
  if (result.costBasis !== "PINNED_RATE_ESTIMATE") throw invalidPlanBinding();
  if (result.finishReason !== "stop")
    throw new HostedPromptExecutionError(
      "HOSTED_PROMPT_PROVIDER_REJECTED",
      "FAILED",
      true,
      null,
      cost,
    );
}

/**
 * Preparation, dispatch and recovery share this exact projection. Optional
 * per-scene budgets are sealed when present; historical plans retain their bytes.
 */
export function hostedPromptBatchPlanDocument(plan: PromptBatchPlan): Record<string, unknown> {
  return {
    ...(plan.requestPolicy === undefined || plan.requestPolicy === "legacy"
      ? {}
      : { request_policy: plan.requestPolicy }),
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
      ...(batch.batch.literalCharacterLimits === undefined
        ? {}
        : {
            literal_character_limits: batch.batch.scenes.map((scene) => ({
              scene_id: scene.sceneId,
              limit: batch.batch.literalCharacterLimits![scene.sceneId],
            })),
          }),
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

// Detection selects a candidate only; exact canonical bytes/hash/UUID validation follows.
function usesContentRepair(
  requestBytes: string,
  retryOfRequestHash?: Sha256Digest | null,
): boolean | "no-text-v2" {
  if (!retryOfRequestHash) return false;
  try {
    const systemPrompt: unknown = JSON.parse(requestBytes)?.[0]?.settings?.systemPrompt;
    if (
      typeof systemPrompt === "string" &&
      systemPrompt.endsWith(`\n${NO_GRAPHICS_V2_WRITER_INSTRUCTION}`)
    )
      return "no-text-v2";
    return (
      typeof systemPrompt === "string" &&
      systemPrompt.endsWith(`\n${PROMPT_CONTENT_REPAIR_INSTRUCTION}`)
    );
  } catch {
    return false;
  }
}

function recoverSealedPromptRequest(
  batch: PromptBatch,
  plan: PromptBatchPlan,
  requestBytes: string,
  retryOfRequestHash: Sha256Digest | null | undefined,
  correction: RunwarePromptCorrection | null,
): { request: RunwarePromptTransportRequest; contentRepair: boolean | "no-text-v2" } {
  // Luna seals repair policy in its UUID while keeping the system instruction stable.
  // Select by exact request bytes; a marker-only guess cannot recover those corrections.
  const candidates =
    isRunwareLunaPromptPolicy(plan.requestPolicy) && retryOfRequestHash
      ? ([false, true, "no-text-v2"] as const)
      : ([usesContentRepair(requestBytes, retryOfRequestHash)] as const);
  for (const repair of candidates) {
    const candidate = buildRunwarePromptRequest(
      batch,
      batch.scenes,
      retryOfRequestHash ? 2 : 1,
      retryOfRequestHash ?? null,
      1,
      plan.requestPolicy ?? "legacy",
      repair,
      correction ?? undefined,
    );
    if (candidate.requestBytes === requestBytes)
      return { request: candidate, contentRepair: repair };
  }
  throw invalidPlanBinding();
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
    const literalCharacterLimits = Object.assign(
      {},
      ...plan.batches.map((entry) => entry.batch.literalCharacterLimits ?? {}),
    );
    const recomputed = planPromptBatches({
      batchIdPrefix: plan.batchIdPrefix,
      projectTitle: batch.sanitizedProjectTitle,
      imageStyleVersionId: batch.imageStyleVersionId,
      styleProfileHash: batch.styleProfileHash,
      // The durable authority service retains the historical Natural Documentary scalar.
      // v39 and v40 requests seal per-scene limits instead, including during final acceptance.
      ...(plan.requestPolicy === "runware-luna-grounded-v2" ||
      plan.requestPolicy === "runware-luna-grounded-v3" ||
      batch.literalCharacterLimit === undefined
        ? {}
        : { literalCharacterLimit: batch.literalCharacterLimit }),
      ...(Object.keys(literalCharacterLimits).length === 0 ? {} : { literalCharacterLimits }),
      styleTreatment: batch.styleTreatment,
      plannerGuidance: batch.plannerGuidance,
      storyContext: batch.storyContext,
      continuityTags: batch.continuityTags,
      scenes: batch.scenes,
      options: {
        requestPolicy: plan.requestPolicy ?? "legacy",
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
    let claimFailure: HostedPromptExecutionError | null = null;
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
        const request = recoverSealedPromptRequest(
          entry.batch,
          this.plan,
          saved.requestBytes,
          saved.retryOfRequestHash,
          sealedCorrection(entry.batch, this.plan, saved.requestBytes, null),
        ).request;
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
        // New compatible requests must use the durable one-batch receipt path above.
        if (isRunwareLunaPromptPolicy(this.plan.requestPolicy)) throw invalidPlanBinding();
        const remainingReservationUsd = ledger.snapshot().remainingUsd;
        if (remainingReservationUsd * 1_000_000 < minimumNextBatchMicroUsd)
          throw new RangeError("Runware prompt reservation is exhausted.");
        const base = new RunwarePromptHttpTransport({
          apiKey: this.apiKey,
          ledger,
          maximumRequestCostUsd: Math.min(0.25, remainingReservationUsd),
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
            } catch (error) {
              if (error instanceof HostedPromptExecutionError) claimFailure = error;
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
          requestPolicy: this.plan.requestPolicy ?? "legacy",
          transport,
          evidenceSink: {
            record(evidence) {
              const row = captured.at(-1);
              if (!row || row.evidence) throw new Error("PROMPT_ATTEMPT_EVIDENCE_CONFLICT");
              row.evidence = evidence;
            },
          },
          maximumBatchCostUsd: Math.min(0.25, remainingReservationUsd),
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
      if (claimFailure) throw claimFailure;
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
