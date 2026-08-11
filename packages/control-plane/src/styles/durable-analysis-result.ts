import { createHash } from "node:crypto";

import {
  canonicalizeJson,
  sha256CanonicalJson,
  validateAndHashContractDocument,
} from "@videoforge/contracts";

import type { ArtifactMetadata } from "../repositories/artifacts.js";
import type { AppendCostEventCommand, TaskCostSummary } from "../repositories/events.js";
import type { AcceptedAttemptResult } from "../repositories/execution.js";
import type {
  AcceptedImageStyleAnalysisResult,
  ImageStyleAnalysisUsageSummary,
} from "../repositories/presets.js";
import {
  deterministicIdempotencyKey,
  type DeterministicIdempotencyKey,
  type JsonObject,
  type RepositoryResult,
  type Sha256,
  type WorkspaceActorScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories, RepositorySession } from "../repositories/unit-of-work.js";
import type {
  CanonicalDocumentObjectStore,
  CanonicalDocumentWrite,
} from "../timing/durable-transcription.js";
import {
  DURABLE_STYLE_ANALYZER_MODEL,
  DURABLE_STYLE_ANALYZER_PROVIDER,
  composeDurableImageStyleAnalysisInput,
  type ImageStyleAnalysisCompletionCandidate,
} from "./durable-analysis.js";

export const IMAGE_STYLE_ANALYSIS_USAGE_VERSION =
  "videoforge.image-style-analysis-usage/v1" as const;

export type ImageStyleAnalysisResultAcceptanceErrorCode =
  | "CANDIDATE_INVALID"
  | "COST_INVALID"
  | "DURABLE_STATE_INVALID"
  | "OBJECT_STORE_MISMATCH"
  | "USAGE_INVALID";

export class ImageStyleAnalysisResultAcceptanceError extends Error {
  public constructor(
    public readonly code: ImageStyleAnalysisResultAcceptanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageStyleAnalysisResultAcceptanceError";
  }
}

export interface ImageStyleAnalysisCostMutation {
  readonly costEventId: string;
  readonly sequence: number;
  readonly eventType: "REPORTED" | "SETTLED" | "RELEASED" | "REFUNDED";
  readonly amountMicroUsd: bigint;
  readonly idempotencyKey: string;
  readonly occurredAt: string;
}

export interface AcceptImageStyleAnalysisSuccessCommand {
  readonly completionCandidate: ImageStyleAnalysisCompletionCandidate;
  readonly usageSummary: ImageStyleAnalysisUsageSummary;
  readonly reportedCostMicroUsd: bigint;
  readonly costEvents: readonly ImageStyleAnalysisCostMutation[];
  readonly completedAt: string;
}

export interface PreparedImageStyleAnalysisSuccess {
  readonly completionCandidate: ImageStyleAnalysisCompletionCandidate;
  readonly usageSummary: ImageStyleAnalysisUsageSummary;
  readonly reportedCostMicroUsd: bigint;
  readonly costEvents: readonly AppendCostEventCommand[];
  readonly outputAssetId: string;
  readonly acceptanceFingerprintHash: Sha256;
  readonly canonicalDocumentWrite: CanonicalDocumentWrite;
  readonly artifactRegistration: Parameters<RepositorySession["artifacts"]["registerMetadata"]>[1];
  readonly artifactBinding: Parameters<RepositorySession["artifacts"]["bindCanonicalDocument"]>[1];
  readonly recordSuccessfulResult: Parameters<
    RepositorySession["execution"]["recordSuccessfulResult"]
  >[1];
  readonly acceptAnalysisResult: Parameters<
    RepositorySession["imageStyles"]["acceptAnalysisResult"]
  >[1];
}

export interface AcceptedImageStyleAnalysisSuccess {
  readonly kind: "DURABLE_IMAGE_STYLE_ANALYSIS_SUCCESS";
  readonly result: AcceptedImageStyleAnalysisResult;
  readonly artifact: ArtifactMetadata;
  readonly acceptedAttempt: AcceptedAttemptResult;
  readonly cost: TaskCostSummary;
  readonly canonicalDocumentObjectKey: string;
  readonly acceptanceFingerprintHash: Sha256;
  readonly replayed: boolean;
}

type AcceptanceResult = RepositoryResult<AcceptedImageStyleAnalysisSuccess, string, string, string>;

const COMMAND_KEYS = [
  "completedAt",
  "completionCandidate",
  "costEvents",
  "reportedCostMicroUsd",
  "usageSummary",
] as const;
const CANDIDATE_KEYS = [
  "analysisAttemptId",
  "analyzerModelSnapshot",
  "analyzerOutputHash",
  "analyzerRequestHash",
  "disclosureAttestedByUserId",
  "executionAttemptId",
  "kind",
  "profileDocument",
  "referenceSetHash",
  "styleId",
  "taskId",
  "versionId",
  "workspaceId",
] as const;
const USAGE_KEYS = [
  "completion_tokens",
  "prompt_tokens",
  "provider_attempt_count",
  "reasoning_tokens",
  "schema_version",
  "total_tokens",
] as const;
const COST_KEYS = [
  "amountMicroUsd",
  "costEventId",
  "eventType",
  "idempotencyKey",
  "occurredAt",
  "sequence",
] as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function boundedText(
  value: unknown,
  label: string,
  maximum = 240,
  code: "CANDIDATE_INVALID" | "COST_INVALID" = "CANDIDATE_INVALID",
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(code, `${label} is invalid.`);
  }
  return value;
}

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" && UTC_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value))
  );
}

function plainSnapshot<Value>(
  value: unknown,
  expectedKeys: readonly string[],
  code: "CANDIDATE_INVALID" | "USAGE_INVALID",
  label: string,
): Value {
  let plain: unknown;
  try {
    plain = JSON.parse(canonicalizeJson(value));
  } catch {
    throw new ImageStyleAnalysisResultAcceptanceError(code, `${label} must be plain JSON.`);
  }
  if (
    typeof plain !== "object" ||
    plain === null ||
    Array.isArray(plain) ||
    !exactKeys(plain, expectedKeys)
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      code,
      `${label} has missing or unknown fields.`,
    );
  }
  return plain as Value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (ArrayBuffer.isView(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function stableUuid(namespace: string, ...parts: readonly string[]): string {
  const bytes = createHash("sha256")
    .update([namespace, ...parts].join("\u0000"))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableKey(prefix: string, hash: Sha256): DeterministicIdempotencyKey {
  return deterministicIdempotencyKey(`${prefix}:${hash.slice("sha256:".length)}`);
}

function validUsage(value: unknown): ImageStyleAnalysisUsageSummary {
  const usage = plainSnapshot<ImageStyleAnalysisUsageSummary>(
    value,
    USAGE_KEYS,
    "USAGE_INVALID",
    "Image Style analysis usage",
  );
  if (
    usage.schema_version !== IMAGE_STYLE_ANALYSIS_USAGE_VERSION ||
    (usage.provider_attempt_count !== 1 && usage.provider_attempt_count !== 2) ||
    !Number.isSafeInteger(usage.prompt_tokens) ||
    usage.prompt_tokens < 0 ||
    !Number.isSafeInteger(usage.completion_tokens) ||
    usage.completion_tokens < 0 ||
    !Number.isSafeInteger(usage.total_tokens) ||
    usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens ||
    !Number.isSafeInteger(usage.reasoning_tokens) ||
    usage.reasoning_tokens < 0 ||
    usage.reasoning_tokens > usage.completion_tokens
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "USAGE_INVALID",
      "Image Style analysis usage is outside its exact bounded numeric contract.",
    );
  }
  return deepFreeze(usage);
}

function analysisKind(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).analysis_kind
    : undefined;
}

function validCostEvents(
  value: unknown,
  candidate: ImageStyleAnalysisCompletionCandidate,
  reportedCostMicroUsd: bigint,
  completedAt: string,
): readonly AppendCostEventCommand[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 4) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "COST_INVALID",
      "Analysis acceptance requires two to four exact cost mutations.",
    );
  }
  const seenTypes = new Set<string>();
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  let previousSequence = 0;
  let previousTime = Number.NEGATIVE_INFINITY;
  let reportedSequence = 0;
  let settledSequence = 0;
  const mutations = value.map((unknownMutation) => {
    if (
      typeof unknownMutation !== "object" ||
      unknownMutation === null ||
      Array.isArray(unknownMutation) ||
      !exactKeys(unknownMutation, COST_KEYS)
    ) {
      throw new ImageStyleAnalysisResultAcceptanceError(
        "COST_INVALID",
        "A cost mutation has missing or unknown fields.",
      );
    }
    const mutation = unknownMutation as ImageStyleAnalysisCostMutation;
    boundedText(mutation.costEventId, "costEventId", 160, "COST_INVALID");
    boundedText(mutation.idempotencyKey, "cost idempotencyKey", 240, "COST_INVALID");
    if (
      !["REPORTED", "SETTLED", "RELEASED", "REFUNDED"].includes(mutation.eventType) ||
      seenTypes.has(mutation.eventType) ||
      seenIds.has(mutation.costEventId) ||
      seenKeys.has(mutation.idempotencyKey) ||
      !Number.isSafeInteger(mutation.sequence) ||
      mutation.sequence <= previousSequence ||
      typeof mutation.amountMicroUsd !== "bigint" ||
      mutation.amountMicroUsd < 0n ||
      !validTimestamp(mutation.occurredAt)
    ) {
      throw new ImageStyleAnalysisResultAcceptanceError(
        "COST_INVALID",
        "Cost mutation identity, sequence, type, amount, or time is invalid.",
      );
    }
    const time = Date.parse(mutation.occurredAt);
    if (time < previousTime || time > Date.parse(completedAt)) {
      throw new ImageStyleAnalysisResultAcceptanceError(
        "COST_INVALID",
        "Cost mutations must be chronological and no later than completion.",
      );
    }
    seenTypes.add(mutation.eventType);
    seenIds.add(mutation.costEventId);
    seenKeys.add(mutation.idempotencyKey);
    previousSequence = mutation.sequence;
    previousTime = time;
    if (mutation.eventType === "REPORTED") reportedSequence = mutation.sequence;
    if (mutation.eventType === "SETTLED") settledSequence = mutation.sequence;
    return Object.freeze({
      idempotencyKey: deterministicIdempotencyKey(mutation.idempotencyKey),
      costEventId: mutation.costEventId,
      owner: Object.freeze({
        ownerType: "IMAGE_STYLE_VERSION" as const,
        ownerId: candidate.versionId,
        imageStyleVersionId: candidate.versionId,
      }),
      taskId: candidate.taskId,
      attemptId: candidate.executionAttemptId,
      sequence: mutation.sequence,
      eventType: mutation.eventType,
      amountMicroUsd: mutation.amountMicroUsd,
      providerReference: null,
      details: Object.freeze({
        source: "image-style-analysis",
        analyzer_output_hash: candidate.analyzerOutputHash,
        usage_schema_version: IMAGE_STYLE_ANALYSIS_USAGE_VERSION,
      }),
      occurredAt: mutation.occurredAt,
    });
  });
  const reported = mutations.find((event) => event.eventType === "REPORTED");
  const settled = mutations.find((event) => event.eventType === "SETTLED");
  if (
    reported === undefined ||
    settled === undefined ||
    reported.amountMicroUsd !== reportedCostMicroUsd ||
    settled.amountMicroUsd !== reportedCostMicroUsd ||
    reportedSequence >= settledSequence ||
    mutations.some(
      (event) =>
        (event.eventType === "RELEASED" || event.eventType === "REFUNDED") &&
        event.sequence <= settledSequence,
    )
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "COST_INVALID",
      "Reported, settled, and reservation-finalization costs are inconsistent.",
    );
  }
  return Object.freeze(mutations);
}

function artifactMetadata(
  candidate: ImageStyleAnalysisCompletionCandidate,
  usage: ImageStyleAnalysisUsageSummary,
  reportedCostMicroUsd: bigint,
): JsonObject {
  return Object.freeze({
    source: "image-style-analysis",
    analysis_attempt_id: candidate.analysisAttemptId,
    task_id: candidate.taskId,
    execution_attempt_id: candidate.executionAttemptId,
    analyzer_request_hash: candidate.analyzerRequestHash,
    reference_set_hash: candidate.referenceSetHash,
    analyzer_output_hash: candidate.analyzerOutputHash,
    analyzer_model_snapshot: candidate.analyzerModelSnapshot,
    usage_schema_version: usage.schema_version,
    provider_attempt_count: usage.provider_attempt_count,
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    reasoning_tokens: usage.reasoning_tokens,
    reported_cost_micro_usd: reportedCostMicroUsd.toString(),
  });
}

function providerDetails(
  candidate: ImageStyleAnalysisCompletionCandidate,
  usage: ImageStyleAnalysisUsageSummary,
  reportedCostMicroUsd: bigint,
): JsonObject {
  return Object.freeze({
    source: "image-style-analysis",
    analysis_attempt_id: candidate.analysisAttemptId,
    analyzer_request_hash: candidate.analyzerRequestHash,
    reference_set_hash: candidate.referenceSetHash,
    analyzer_output_hash: candidate.analyzerOutputHash,
    analyzer_model_snapshot: candidate.analyzerModelSnapshot,
    usage,
    reported_cost_micro_usd: reportedCostMicroUsd.toString(),
  });
}

export async function prepareDurableImageStyleAnalysisSuccess(
  scope: WorkspaceActorScope,
  input: AcceptImageStyleAnalysisSuccessCommand,
): Promise<PreparedImageStyleAnalysisSuccess> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, COMMAND_KEYS) ||
    typeof input.reportedCostMicroUsd !== "bigint" ||
    input.reportedCostMicroUsd < 0n ||
    !validTimestamp(input.completedAt)
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Analysis acceptance command shape, cost, or completion time is invalid.",
    );
  }
  const candidate = plainSnapshot<ImageStyleAnalysisCompletionCandidate>(
    input.completionCandidate,
    CANDIDATE_KEYS,
    "CANDIDATE_INVALID",
    "Image Style completion candidate",
  );
  if (candidate.kind !== "IMAGE_STYLE_ANALYSIS_COMPLETION_CANDIDATE") {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Only a VF-7-03 completion candidate can be accepted.",
    );
  }
  for (const [label, value] of [
    ["workspaceId", candidate.workspaceId],
    ["styleId", candidate.styleId],
    ["versionId", candidate.versionId],
    ["analysisAttemptId", candidate.analysisAttemptId],
    ["taskId", candidate.taskId],
    ["executionAttemptId", candidate.executionAttemptId],
    ["disclosureAttestedByUserId", candidate.disclosureAttestedByUserId],
  ] as const) {
    boundedText(value, label, 160);
  }
  boundedText(candidate.analyzerModelSnapshot, "analyzerModelSnapshot", 1_000);
  if (
    candidate.workspaceId !== scope.workspaceId ||
    !SHA256.test(candidate.analyzerRequestHash) ||
    !SHA256.test(candidate.referenceSetHash) ||
    !SHA256.test(candidate.analyzerOutputHash)
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Candidate workspace or SHA-256 provenance is invalid.",
    );
  }
  if (
    typeof candidate.profileDocument !== "object" ||
    candidate.profileDocument === null ||
    Array.isArray(candidate.profileDocument) ||
    !exactKeys(candidate.profileDocument, [
      "canonicalDocumentSha256",
      "contractName",
      "contractVersion",
      "payload",
    ])
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Candidate profile document shape is invalid.",
    );
  }

  let profile;
  try {
    profile = await validateAndHashContractDocument(
      "imageStyleProfile",
      candidate.profileDocument.payload,
    );
  } catch {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Candidate profile does not satisfy image-style-profile/v1.",
    );
  }
  const profileValue = profile.value as JsonObject;
  if (
    candidate.profileDocument.contractName !== "image-style-profile" ||
    candidate.profileDocument.contractVersion !== "v1" ||
    candidate.profileDocument.canonicalDocumentSha256 !== profile.sha256 ||
    analysisKind(profileValue.analysis) !== "VISION_ANALYSIS"
  ) {
    throw new ImageStyleAnalysisResultAcceptanceError(
      "CANDIDATE_INVALID",
      "Candidate profile hash, contract, or analysis provenance is invalid.",
    );
  }
  const trustedCandidate = deepFreeze({
    ...candidate,
    profileDocument: {
      ...candidate.profileDocument,
      payload: profileValue,
      canonicalDocumentSha256: profile.sha256 as Sha256,
    },
  }) as ImageStyleAnalysisCompletionCandidate;
  const usage = validUsage(input.usageSummary);
  const costEvents = validCostEvents(
    input.costEvents,
    trustedCandidate,
    input.reportedCostMicroUsd,
    input.completedAt,
  );
  const acceptanceFingerprintHash = (await sha256CanonicalJson({
    schema_version: "videoforge.image-style-analysis-acceptance/v1",
    workspace_id: trustedCandidate.workspaceId,
    style_id: trustedCandidate.styleId,
    version_id: trustedCandidate.versionId,
    analysis_attempt_id: trustedCandidate.analysisAttemptId,
    task_id: trustedCandidate.taskId,
    execution_attempt_id: trustedCandidate.executionAttemptId,
    analyzer_request_hash: trustedCandidate.analyzerRequestHash,
    reference_set_hash: trustedCandidate.referenceSetHash,
    analyzer_output_hash: trustedCandidate.analyzerOutputHash,
    analyzer_model_snapshot: trustedCandidate.analyzerModelSnapshot,
    disclosure_attested_by_user_id: trustedCandidate.disclosureAttestedByUserId,
    style_profile_hash: trustedCandidate.profileDocument.canonicalDocumentSha256,
    usage,
    reported_cost_micro_usd: input.reportedCostMicroUsd.toString(),
    cost_events: costEvents.map((event) => ({
      cost_event_id: event.costEventId,
      sequence: event.sequence,
      event_type: event.eventType,
      amount_micro_usd: event.amountMicroUsd.toString(),
      idempotency_key: event.idempotencyKey,
      occurred_at: event.occurredAt,
    })),
    completed_at: input.completedAt,
  })) as Sha256;
  const outputAssetId = stableUuid(
    "videoforge:image-style-analysis-profile:v1",
    scope.workspaceId,
    trustedCandidate.versionId,
    trustedCandidate.executionAttemptId,
    trustedCandidate.profileDocument.canonicalDocumentSha256,
    trustedCandidate.analyzerOutputHash,
  );
  const digest = trustedCandidate.profileDocument.canonicalDocumentSha256.slice("sha256:".length);
  const objectKey = `workspace/${scope.workspaceId}/image-style/${trustedCandidate.styleId}/version/${trustedCandidate.versionId}/analysis/${digest}.json`;
  const canonicalBytes = new TextEncoder().encode(canonicalizeJson(profileValue));
  const metadata = artifactMetadata(trustedCandidate, usage, input.reportedCostMicroUsd);
  const details = providerDetails(trustedCandidate, usage, input.reportedCostMicroUsd);

  return deepFreeze({
    completionCandidate: trustedCandidate,
    usageSummary: usage,
    reportedCostMicroUsd: input.reportedCostMicroUsd,
    costEvents,
    outputAssetId,
    acceptanceFingerprintHash,
    canonicalDocumentWrite: {
      objectKey,
      bytes: canonicalBytes,
      binarySha256: trustedCandidate.profileDocument.canonicalDocumentSha256,
    },
    artifactRegistration: {
      idempotencyKey: stableKey("style-analysis-artifact", acceptanceFingerprintHash),
      assetId: outputAssetId,
      projectId: null,
      projectRevisionId: null,
      sourceAttemptId: trustedCandidate.executionAttemptId,
      kind: "CANONICAL_DOCUMENT" as const,
      objectKey,
      contentType: "application/json",
      metadata,
    },
    artifactBinding: {
      idempotencyKey: stableKey("style-analysis-artifact-bind", acceptanceFingerprintHash),
      assetId: outputAssetId,
      contractName: "image-style-profile",
      contractVersion: "v1",
      canonicalDocumentSha256: trustedCandidate.profileDocument.canonicalDocumentSha256,
      binarySha256: trustedCandidate.profileDocument.canonicalDocumentSha256,
      byteSize: BigInt(canonicalBytes.byteLength),
      verifiedAt: input.completedAt,
    },
    recordSuccessfulResult: {
      idempotencyKey: stableKey("style-analysis-general-success", acceptanceFingerprintHash),
      taskId: trustedCandidate.taskId,
      attemptId: trustedCandidate.executionAttemptId,
      outputAssetId,
      outputBinarySha256: trustedCandidate.profileDocument.canonicalDocumentSha256,
      providerDetails: details,
      finishedAt: input.completedAt,
    },
    acceptAnalysisResult: {
      idempotencyKey: stableKey("style-analysis-result-acceptance", acceptanceFingerprintHash),
      styleId: trustedCandidate.styleId,
      versionId: trustedCandidate.versionId,
      analysisAttemptId: trustedCandidate.analysisAttemptId,
      taskId: trustedCandidate.taskId,
      executionAttemptId: trustedCandidate.executionAttemptId,
      outputAssetId,
      objectKey,
      analyzerRequestHash: trustedCandidate.analyzerRequestHash,
      referenceSetHash: trustedCandidate.referenceSetHash,
      analyzerOutputHash: trustedCandidate.analyzerOutputHash,
      analyzerModelSnapshot: trustedCandidate.analyzerModelSnapshot,
      disclosureAttestedByUserId: trustedCandidate.disclosureAttestedByUserId,
      profileDocument: trustedCandidate.profileDocument,
      usagePayload: usage,
      reportedCostMicroUsd: input.reportedCostMicroUsd,
      completedAt: input.completedAt,
    },
  });
}

function propagateFailure<Value>(
  result: RepositoryResult<Value, string, string, string>,
): RepositoryResult<never, string, string, string> {
  if (result.ok) throw new TypeError("cannot propagate a successful repository result");
  return result;
}

function costFailure(message: string): RepositoryResult<never, string, string, string> {
  return { ok: false, kind: "INVARIANT_VIOLATION", code: "INVALID_MONEY", message };
}

async function requireFinalizedCost(
  session: RepositorySession,
  scope: WorkspaceActorScope,
  taskId: string,
  attemptId: string | undefined,
  reportedCostMicroUsd: bigint,
): Promise<RepositoryResult<TaskCostSummary, string, string, string>> {
  const result = await session.events.summarizeTaskCost(scope, {
    taskId,
    ...(attemptId === undefined ? {} : { attemptId }),
  });
  if (!result.ok) return result;
  const cost = result.value;
  if (
    cost.reservedEventCount < 1 ||
    cost.finalizationEventCount < 1 ||
    cost.invalidReservationAttemptCount !== 0 ||
    cost.unsettledReportedAttemptCount !== 0 ||
    cost.nonConservingAttemptCount !== 0 ||
    cost.activeReservationMicroUsd !== 0n
  ) {
    return costFailure("Image Style analysis cost reservation is not fully conserved.");
  }
  if (
    attemptId !== undefined &&
    (cost.reservedEventCount !== 1 ||
      cost.reportedEventCount !== 1 ||
      cost.settledEventCount !== 1 ||
      cost.reportedMicroUsd !== reportedCostMicroUsd ||
      cost.settledMicroUsd !== reportedCostMicroUsd)
  ) {
    return costFailure("Accepted Image Style analysis cost does not match its exact settlement.");
  }
  return result;
}

function durableStateFailure(message: string): never {
  throw new ImageStyleAnalysisResultAcceptanceError("DURABLE_STATE_INVALID", message);
}

async function verifyDurableInput(
  repositories: ControlPlaneRepositories,
  scope: WorkspaceActorScope,
  prepared: PreparedImageStyleAnalysisSuccess,
): Promise<void> {
  const candidate = prepared.completionCandidate;
  const versionResult = await repositories.imageStyles.resolveVersion(scope, candidate);
  const specializedResult = await repositories.imageStyles.resolveAnalysisAttempt(scope, candidate);
  const referencesResult = await repositories.imageStyles.resolveAnalysisReferenceSet(
    scope,
    candidate,
  );
  const taskResult = await repositories.execution.resolveTask(scope, { taskId: candidate.taskId });
  const attemptsResult = await repositories.execution.listAttempts(scope, {
    taskId: candidate.taskId,
  });
  if (
    !versionResult.ok ||
    !specializedResult.ok ||
    !referencesResult.ok ||
    !taskResult.ok ||
    !attemptsResult.ok
  ) {
    return durableStateFailure("Image Style analysis durable lineage cannot be resolved.");
  }
  const version = versionResult.value;
  const specialized = specializedResult.value;
  const task = taskResult.value;
  const general = attemptsResult.value.find(
    (attempt) => attempt.attemptId === candidate.executionAttemptId,
  );
  if (version.state === "PUBLISHED" || version.state === "ABANDONED") {
    return durableStateFailure("Immutable Image Style versions reject analysis acceptance.");
  }
  if (
    general === undefined ||
    specialized.taskId !== candidate.taskId ||
    specialized.executionAttemptId !== candidate.executionAttemptId ||
    specialized.provider !== DURABLE_STYLE_ANALYZER_PROVIDER ||
    specialized.model !== DURABLE_STYLE_ANALYZER_MODEL
  ) {
    return durableStateFailure("Image Style analysis specialized/general lineage drifted.");
  }
  const recomposed = await composeDurableImageStyleAnalysisInput(
    scope.workspaceId,
    {
      styleId: candidate.styleId,
      versionId: candidate.versionId,
      analysisAttemptId: candidate.analysisAttemptId,
      taskId: candidate.taskId,
      executionAttemptId: candidate.executionAttemptId,
      provider: DURABLE_STYLE_ANALYZER_PROVIDER,
      model: DURABLE_STYLE_ANALYZER_MODEL,
      modelRevision: specialized.modelRevision,
    },
    referencesResult.value,
  );
  if (
    specialized.requestHash !== candidate.analyzerRequestHash ||
    candidate.analyzerRequestHash !== recomposed.inputFingerprintHash ||
    candidate.referenceSetHash !== recomposed.referenceSetHash ||
    candidate.analyzerModelSnapshot !== recomposed.analyzerModelSnapshot ||
    version.analyzerRequestHash !== candidate.analyzerRequestHash ||
    version.analyzerModelSnapshot !== candidate.analyzerModelSnapshot ||
    version.disclosureAttestedByUserId !== candidate.disclosureAttestedByUserId ||
    task.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
    task.owner.ownerId !== candidate.versionId ||
    task.owner.imageStyleVersionId !== candidate.versionId ||
    general.taskId !== candidate.taskId ||
    general.ordinal !== specialized.ordinal ||
    general.idempotencyKey !== specialized.idempotencyKey ||
    general.inputHash !== candidate.analyzerRequestHash
  ) {
    return durableStateFailure(
      "Image Style request, reference, owner, model, or disclosure drifted.",
    );
  }
  const firstAcceptance =
    version.state === "ANALYZING" &&
    version.profileDocument === null &&
    specialized.state === "CREATED" &&
    specialized.responseHash === null &&
    specialized.usagePayload === null &&
    specialized.reportedCostMicroUsd === null &&
    task.state === "RUNNING" &&
    task.acceptedAttemptId === null &&
    general.state === "CLAIMED" &&
    general.claimState === "CLAIMED" &&
    general.resultDisposition === "PENDING" &&
    general.finishedAt === null;
  const exactReplay =
    version.state === "NEEDS_REVIEW" &&
    version.updatedAt === prepared.acceptAnalysisResult.completedAt &&
    canonicalizeJson(version.profileDocument) ===
      canonicalizeJson(prepared.acceptAnalysisResult.profileDocument) &&
    specialized.state === "SUCCEEDED" &&
    specialized.responseHash === candidate.analyzerOutputHash &&
    canonicalizeJson(specialized.usagePayload) === canonicalizeJson(prepared.usageSummary) &&
    specialized.reportedCostMicroUsd === prepared.reportedCostMicroUsd &&
    task.state === "COMPLETE" &&
    task.acceptedAttemptId === candidate.executionAttemptId &&
    task.finishedAt === prepared.acceptAnalysisResult.completedAt &&
    general.state === "SUCCEEDED" &&
    general.resultDisposition === "ACCEPTED" &&
    general.outputAssetId === prepared.outputAssetId &&
    general.finishedAt === prepared.acceptAnalysisResult.completedAt;
  if (!firstAcceptance && !exactReplay) {
    return durableStateFailure(
      "Image Style analysis is stale, unclaimed, terminal, or mismatched.",
    );
  }
}

/** Provider-free acceptance. It performs no analyzer, credential, network, or environment access. */
export class DurableImageStyleAnalysisResultAcceptance {
  public constructor(
    private readonly repositories: ControlPlaneRepositories,
    private readonly objects: CanonicalDocumentObjectStore,
  ) {}

  public async accept(
    scope: WorkspaceActorScope,
    command: AcceptImageStyleAnalysisSuccessCommand,
  ): Promise<AcceptanceResult> {
    const prepared = await prepareDurableImageStyleAnalysisSuccess(scope, command);
    await verifyDurableInput(this.repositories, scope, prepared);
    const stored = await this.objects.putIfAbsent(prepared.canonicalDocumentWrite);
    if (
      stored.objectKey !== prepared.canonicalDocumentWrite.objectKey ||
      stored.binarySha256 !== prepared.canonicalDocumentWrite.binarySha256 ||
      stored.byteSize !== BigInt(prepared.canonicalDocumentWrite.bytes.byteLength)
    ) {
      throw new ImageStyleAnalysisResultAcceptanceError(
        "OBJECT_STORE_MISMATCH",
        "Canonical object store returned mismatched immutable profile facts.",
      );
    }

    return this.repositories.unitOfWork.execute<
      AcceptedImageStyleAnalysisSuccess,
      string,
      string,
      string
    >(scope, async (session) => {
      const registered = await session.artifacts.registerMetadata(
        scope,
        prepared.artifactRegistration,
      );
      if (!registered.ok) return propagateFailure(registered);
      const bound = await session.artifacts.bindCanonicalDocument(scope, prepared.artifactBinding);
      if (!bound.ok) return propagateFailure(bound);
      const successful = await session.execution.recordSuccessfulResult(
        scope,
        prepared.recordSuccessfulResult,
      );
      if (!successful.ok) return propagateFailure(successful);
      const costWrites = [];
      for (const costEvent of prepared.costEvents) {
        const appended = await session.events.appendCostEvent(scope, costEvent);
        if (!appended.ok) return propagateFailure(appended);
        costWrites.push(appended.value);
      }
      const taskCost = await requireFinalizedCost(
        session,
        scope,
        prepared.completionCandidate.taskId,
        undefined,
        prepared.reportedCostMicroUsd,
      );
      if (!taskCost.ok) return propagateFailure(taskCost);
      const attemptCost = await requireFinalizedCost(
        session,
        scope,
        prepared.completionCandidate.taskId,
        prepared.completionCandidate.executionAttemptId,
        prepared.reportedCostMicroUsd,
      );
      if (!attemptCost.ok) return propagateFailure(attemptCost);
      const accepted = await session.execution.acceptSuccessfulResult(scope, {
        idempotencyKey: stableKey(
          "style-analysis-general-accept",
          prepared.acceptanceFingerprintHash,
        ),
        candidateReference: successful.value.value.reference,
        acceptedAt: prepared.acceptAnalysisResult.completedAt,
      });
      if (!accepted.ok) return propagateFailure(accepted);
      const result = await session.imageStyles.acceptAnalysisResult(
        scope,
        prepared.acceptAnalysisResult,
      );
      if (!result.ok) return propagateFailure(result);

      return {
        ok: true,
        value: Object.freeze({
          kind: "DURABLE_IMAGE_STYLE_ANALYSIS_SUCCESS" as const,
          result: result.value.value,
          artifact: bound.value.value,
          acceptedAttempt: accepted.value.value,
          cost: attemptCost.value,
          canonicalDocumentObjectKey: stored.objectKey,
          acceptanceFingerprintHash: prepared.acceptanceFingerprintHash,
          replayed:
            stored.replayed &&
            registered.value.replayed &&
            bound.value.replayed &&
            successful.value.replayed &&
            costWrites.every((write) => write.replayed) &&
            accepted.value.replayed &&
            result.value.replayed,
        }),
      };
    });
  }
}

export type { ImageStyleAnalysisUsageSummary };
