import { createHash } from "node:crypto";

import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";

import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import type { TelemetryPort } from "../telemetry/telemetry.js";

export const AVATAR_FIXTURE_ACCEPTANCE_VERSION = "videoforge.avatar-fixture-acceptance/v1" as const;

type Row = Record<string, unknown>;
type TimelineLayout = "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE";

export type AvatarAcceptanceErrorCode =
  | "CALLBACK_INVALID"
  | "CANCELLED"
  | "CLAIM_STALE"
  | "COST_MISMATCH"
  | "DURABLE_STATE_INVALID"
  | "HASH_MISMATCH"
  | "MEDIA_INVALID"
  | "OUTPUT_INVALID"
  | "REPOSITORY_FAILURE"
  | "WORKSPACE_MISMATCH";

export class AvatarAcceptanceError extends Error {
  public constructor(
    public readonly code: AvatarAcceptanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AvatarAcceptanceError";
  }
}

export interface AvatarAcceptanceScope {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface AvatarAcceptanceCommand {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly timelineSegmentId: string;
  readonly selectedSpanAudioId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly outboxId: string;
  readonly callbackReceiptId: string;
  readonly presentedClaimTokenHash: Sha256Digest;
}

export interface AvatarExecutionAuthority {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionState: "GENERATING" | "STALE";
  readonly timelineId: string;
  readonly timelineState: "CURRENT" | "STALE";
  readonly timelineSegmentId: string;
  readonly timelineLayout: TimelineLayout;
  readonly avatarProfileId: string;
  readonly avatarProfileVersionId: string;
  readonly avatarProfileHash: Sha256Digest;
  readonly runtimeSourceAssetId: string;
  readonly runtimeSourceSha256: Sha256Digest;
  readonly sourcePreparationVersion: string;
  readonly sourceValidationProfileVersion: string;
  readonly avatarState: "READY" | "STALE";
  readonly selectedSpanAudioId: string;
  readonly spanAudioAssetId: string;
  readonly spanAudioSha256: Sha256Digest;
  readonly spanState: "READY" | "STALE";
  readonly sourceStartMs: number;
  readonly sourceEndMs: number;
  readonly trimStartSample: number;
  readonly trimEndSampleExclusive: number;
  readonly taskId: string;
  readonly taskState: "RUNNING" | "SUCCEEDED" | "CANCELLED";
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly attemptState: "CLAIMED" | "SUCCEEDED" | "CANCELLED";
  readonly claimTokenHash: Sha256Digest;
  readonly recordedInputHash: Sha256Digest;
  readonly outboxId: string;
  readonly outboxState: "ACKNOWLEDGED" | "STALE";
  readonly callbackReceiptId: string;
  readonly callbackPayloadHash: Sha256Digest;
  readonly callbackState: "RECEIVED" | "STALE";
  readonly reservedCostMicroUsd: number;
  readonly accepted: AcceptedFixtureAvatar | null;
}

export interface ValidatedAvatarFixtureResult {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly resultHash: Sha256Digest;
  readonly callbackEventHash: Sha256Digest;
  readonly binarySha256: Sha256Digest;
  readonly byteSize: number;
  readonly widthPx: 832;
  readonly heightPx: 480;
  readonly fpsNum: 25;
  readonly fpsDen: 1;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly sourceProfile: "avatarforcing-centered-832x480p25-v1";
  readonly rateProfile: "native-25-to-renderer-30-round-near-v1";
  readonly requestedLayout: TimelineLayout;
  readonly reportedCostMicroUsd: 0;
}

export interface AcceptedFixtureAvatar {
  readonly schemaVersion: typeof AVATAR_FIXTURE_ACCEPTANCE_VERSION;
  readonly result: ValidatedAvatarFixtureResult;
  readonly callbackReceiptId: string;
  readonly subjectiveClassification: "UNREVIEWED";
  readonly rendererBindings: readonly [
    {
      readonly layout: "AVATAR_FULL";
      readonly cropProfile: "832:468:0:6";
    },
    {
      readonly layout: "AVATAR_SPLIT_IMAGE";
      readonly cropProfile: "416:468:208:6";
    },
  ];
  readonly acceptedAt: string;
  readonly acceptanceFingerprintHash: Sha256Digest;
}

export interface AvatarAcceptanceStore {
  resolve(
    scope: AvatarAcceptanceScope,
    command: AvatarAcceptanceCommand,
  ): Promise<AvatarExecutionAuthority | null>;
  accept(
    scope: AvatarAcceptanceScope,
    authority: AvatarExecutionAuthority,
    acceptance: AcceptedFixtureAvatar,
  ): Promise<{ readonly accepted: AcceptedFixtureAvatar; readonly replayed: boolean }>;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const MEDIA_PREFIX = Buffer.concat([
  Buffer.from([0, 0, 0, 24]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from("isomiso2", "ascii"),
  Buffer.from("VF-AVATAR-FIXTURE/V1\n", "ascii"),
]);

const hashBytes = (value: Uint8Array): Sha256Digest =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashCanonical = (value: unknown): Sha256Digest =>
  hashBytes(Buffer.from(canonicalizeJson(value), "utf8"));

function deterministicUuid(label: string): string {
  const bytes = createHash("sha256").update(label, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactObject(
  value: unknown,
  name: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AvatarAcceptanceError("OUTPUT_INVALID", `${name} must be an object.`);
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new AvatarAcceptanceError("OUTPUT_INVALID", `${name} shape is invalid.`);
  return object;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AvatarAcceptanceError("OUTPUT_INVALID", `${name} must be text.`);
  return value;
}

function parseFixtureMedia(media: Uint8Array): Record<string, unknown> {
  const bytes = Buffer.from(media);
  if (!bytes.subarray(0, MEDIA_PREFIX.byteLength).equals(MEDIA_PREFIX))
    throw new AvatarAcceptanceError("MEDIA_INVALID", "Avatar fixture media signature is invalid.");
  try {
    return exactObject(
      JSON.parse(bytes.subarray(MEDIA_PREFIX.byteLength).toString("utf8")) as unknown,
      "fixture media payload",
      [
        "audio_binding",
        "avatar_profile_hash",
        "avatar_profile_version_id",
        "fixture_non_production",
        "fps_den",
        "fps_num",
        "frame_count",
        "height",
        "runtime_source_asset_id",
        "runtime_source_sha256",
        "schema_version",
        "span_audio_asset_id",
        "span_audio_sha256",
        "trim_end_sample_exclusive",
        "trim_start_sample",
        "video_codec",
        "width",
      ],
    );
  } catch (error) {
    if (error instanceof AvatarAcceptanceError) throw error;
    throw new AvatarAcceptanceError("MEDIA_INVALID", "Avatar fixture media payload is invalid.");
  }
}

function expectEqual(
  actual: unknown,
  expected: unknown,
  code: AvatarAcceptanceErrorCode,
  message: string,
): void {
  if (actual !== expected) throw new AvatarAcceptanceError(code, message);
}

export function validateAvatarFixtureResult(
  authority: AvatarExecutionAuthority,
  value: unknown,
  media: Uint8Array,
): ValidatedAvatarFixtureResult {
  const result = exactObject(value, "avatar fixture result", [
    "attempt",
    "callback",
    "cost",
    "fixture_non_production",
    "identity",
    "lineage",
    "media",
    "renderer_binding",
    "result_sha256",
    "review",
    "schema_version",
    "status",
  ]);
  expectEqual(
    result.schema_version,
    "avatar-fixture-result/v1",
    "OUTPUT_INVALID",
    "Avatar fixture result version is invalid.",
  );
  expectEqual(
    result.fixture_non_production,
    true,
    "OUTPUT_INVALID",
    "Avatar fixture result is not marked non-production.",
  );
  expectEqual(
    result.status,
    "SUCCEEDED",
    "OUTPUT_INVALID",
    "Avatar fixture result is not successful.",
  );

  const identity = exactObject(result.identity, "identity", [
    "attempt_id",
    "project_id",
    "revision_id",
    "task_id",
    "workspace_id",
  ]);
  for (const [key, expected] of Object.entries({
    workspace_id: authority.workspaceId,
    project_id: authority.projectId,
    revision_id: authority.revisionId,
    task_id: authority.taskId,
    attempt_id: authority.attemptId,
  }))
    expectEqual(identity[key], expected, "HASH_MISMATCH", "Avatar result identity drifted.");

  const lineage = exactObject(result.lineage, "lineage", [
    "avatar_profile_hash",
    "avatar_profile_id",
    "avatar_profile_version_id",
    "runtime_source_asset_id",
    "runtime_source_sha256",
    "source_end_ms",
    "source_preparation_version",
    "source_start_ms",
    "source_validation_profile_version",
    "span_audio_asset_id",
    "span_audio_sha256",
    "trim_end_sample_exclusive",
    "trim_start_sample",
  ]);
  const expectedLineage = {
    avatar_profile_id: authority.avatarProfileId,
    avatar_profile_version_id: authority.avatarProfileVersionId,
    avatar_profile_hash: authority.avatarProfileHash,
    runtime_source_asset_id: authority.runtimeSourceAssetId,
    runtime_source_sha256: authority.runtimeSourceSha256,
    source_preparation_version: authority.sourcePreparationVersion,
    source_validation_profile_version: authority.sourceValidationProfileVersion,
    span_audio_asset_id: authority.spanAudioAssetId,
    span_audio_sha256: authority.spanAudioSha256,
    source_start_ms: authority.sourceStartMs,
    source_end_ms: authority.sourceEndMs,
    trim_start_sample: authority.trimStartSample,
    trim_end_sample_exclusive: authority.trimEndSampleExclusive,
  };
  if (canonicalizeJson(lineage) !== canonicalizeJson(expectedLineage))
    throw new AvatarAcceptanceError("HASH_MISMATCH", "Avatar or selected-span lineage drifted.");

  const renderer = exactObject(result.renderer_binding, "renderer binding", [
    "crop_profile",
    "layout",
    "rate_profile",
    "source_profile",
  ]);
  const expectedCrop = authority.timelineLayout === "AVATAR_FULL" ? "832:468:0:6" : "416:468:208:6";
  expectEqual(
    renderer.layout,
    authority.timelineLayout,
    "OUTPUT_INVALID",
    "Avatar result layout drifted.",
  );
  expectEqual(
    renderer.crop_profile,
    expectedCrop,
    "OUTPUT_INVALID",
    "Avatar crop profile drifted.",
  );
  expectEqual(
    renderer.source_profile,
    "avatarforcing-centered-832x480p25-v1",
    "OUTPUT_INVALID",
    "Avatar source profile drifted.",
  );
  expectEqual(
    renderer.rate_profile,
    "native-25-to-renderer-30-round-near-v1",
    "OUTPUT_INVALID",
    "Avatar rate profile drifted.",
  );

  const mediaFacts = exactObject(result.media, "media", [
    "audio_binding_sha256",
    "bytes",
    "duration_ms",
    "fps_den",
    "fps_num",
    "frame_count",
    "height",
    "sha256",
    "signature",
    "width",
  ]);
  const durationMs = authority.sourceEndMs - authority.sourceStartMs;
  const expectedFrames = (durationMs * 25) / 1000;
  if (!Number.isInteger(expectedFrames))
    throw new AvatarAcceptanceError(
      "DURABLE_STATE_INVALID",
      "Selected Avatar span is not exact at 25 fps.",
    );
  const binarySha256 = hashBytes(media);
  for (const [key, expected] of Object.entries({
    sha256: binarySha256,
    bytes: media.byteLength,
    signature: "ISO_BMFF_FTYP_ISOM",
    width: 832,
    height: 480,
    fps_num: 25,
    fps_den: 1,
    frame_count: expectedFrames,
    duration_ms: durationMs,
    audio_binding_sha256: authority.spanAudioSha256,
  }))
    expectEqual(mediaFacts[key], expected, "MEDIA_INVALID", "Avatar media facts drifted.");

  const embedded = parseFixtureMedia(media);
  const expectedEmbedded = {
    schema_version: "avatar-fixture-media/v1",
    fixture_non_production: true,
    avatar_profile_version_id: authority.avatarProfileVersionId,
    avatar_profile_hash: authority.avatarProfileHash,
    runtime_source_asset_id: authority.runtimeSourceAssetId,
    runtime_source_sha256: authority.runtimeSourceSha256,
    span_audio_asset_id: authority.spanAudioAssetId,
    span_audio_sha256: authority.spanAudioSha256,
    trim_start_sample: authority.trimStartSample,
    trim_end_sample_exclusive: authority.trimEndSampleExclusive,
    width: 832,
    height: 480,
    fps_num: 25,
    fps_den: 1,
    frame_count: expectedFrames,
    video_codec: "synthetic-fixture",
    audio_binding: "original-materialized-trimmed-span",
  };
  if (canonicalizeJson(embedded) !== canonicalizeJson(expectedEmbedded))
    throw new AvatarAcceptanceError("MEDIA_INVALID", "Avatar fixture media lineage drifted.");

  const attempt = exactObject(result.attempt, "attempt", [
    "outbound_activity_count",
    "replayed",
    "retry_index",
  ]);
  expectEqual(
    attempt.retry_index,
    authority.attemptOrdinal - 1,
    "OUTPUT_INVALID",
    "Avatar retry index drifted.",
  );
  expectEqual(
    attempt.replayed,
    false,
    "OUTPUT_INVALID",
    "A replay-mutated worker result cannot be newly accepted.",
  );
  expectEqual(
    attempt.outbound_activity_count,
    0,
    "OUTPUT_INVALID",
    "Avatar fixture reported outbound activity.",
  );
  const cost = exactObject(result.cost, "cost", [
    "estimated_micro_usd",
    "owner_id",
    "owner_type",
    "reported_micro_usd",
    "settled_micro_usd",
  ]);
  if (
    canonicalizeJson(cost) !==
    canonicalizeJson({
      owner_type: "PROJECT_REVISION",
      owner_id: authority.revisionId,
      estimated_micro_usd: 0,
      reported_micro_usd: 0,
      settled_micro_usd: 0,
    })
  )
    throw new AvatarAcceptanceError("COST_MISMATCH", "Avatar fixture cost drifted.");
  const review = exactObject(result.review, "review", [
    "allowed_subjective_classifications",
    "subjective_classification",
    "technical_status",
  ]);
  expectEqual(
    review.technical_status,
    "PASS",
    "OUTPUT_INVALID",
    "Avatar technical result did not pass.",
  );
  expectEqual(
    review.subjective_classification,
    "UNCLASSIFIED",
    "OUTPUT_INVALID",
    "Fixture worker inferred subjective quality.",
  );
  if (
    canonicalizeJson(review.allowed_subjective_classifications) !==
    canonicalizeJson(["LIP_ONLY", "WHOLE_FRAME", "ACCEPTED_BY_REVIEWER"])
  )
    throw new AvatarAcceptanceError(
      "OUTPUT_INVALID",
      "Avatar subjective review vocabulary drifted.",
    );

  const callback = exactObject(result.callback, "callback", [
    "delivery_status",
    "event",
    "identity_sha256",
  ]);
  expectEqual(
    callback.delivery_status,
    "NOT_SENT_FIXTURE",
    "CALLBACK_INVALID",
    "Fixture callback was externally delivered.",
  );
  const event = exactObject(callback.event, "callback event", [
    "attempt_id",
    "callback_event_id",
    "callback_identity_sha256",
    "result_sha256",
    "schema_version",
    "status",
    "task_id",
    "workspace_id",
  ]);
  expectEqual(
    event.schema_version,
    "avatar-fixture-callback/v1",
    "CALLBACK_INVALID",
    "Avatar callback version drifted.",
  );
  expectEqual(
    event.workspace_id,
    authority.workspaceId,
    "CALLBACK_INVALID",
    "Avatar callback workspace drifted.",
  );
  expectEqual(event.task_id, authority.taskId, "CALLBACK_INVALID", "Avatar callback task drifted.");
  expectEqual(
    event.attempt_id,
    authority.attemptId,
    "CALLBACK_INVALID",
    "Avatar callback attempt drifted.",
  );
  expectEqual(event.status, "SUCCEEDED", "CALLBACK_INVALID", "Avatar callback status drifted.");
  expectEqual(
    event.callback_identity_sha256,
    callback.identity_sha256,
    "CALLBACK_INVALID",
    "Avatar callback identity drifted.",
  );

  const resultHash = string(result.result_sha256, "result_sha256") as Sha256Digest;
  const unhashed = structuredClone(result);
  delete unhashed.result_sha256;
  const unhashedCallback = exactObject(unhashed.callback, "callback", [
    "delivery_status",
    "event",
    "identity_sha256",
  ]);
  delete unhashedCallback.event;
  expectEqual(hashCanonical(unhashed), resultHash, "HASH_MISMATCH", "Avatar result hash drifted.");
  expectEqual(
    event.result_sha256,
    resultHash,
    "CALLBACK_INVALID",
    "Avatar callback result hash drifted.",
  );
  const callbackEventHash = hashCanonical(event);
  expectEqual(
    authority.callbackPayloadHash,
    callbackEventHash,
    "CALLBACK_INVALID",
    "Durable callback payload hash drifted.",
  );
  if (!SHA256.test(resultHash) || !SHA256.test(binarySha256))
    throw new AvatarAcceptanceError("HASH_MISMATCH", "Avatar hashes are malformed.");
  return Object.freeze({
    raw: Object.freeze(result),
    resultHash,
    callbackEventHash,
    binarySha256,
    byteSize: media.byteLength,
    widthPx: 832,
    heightPx: 480,
    fpsNum: 25,
    fpsDen: 1,
    frameCount: expectedFrames,
    durationMs,
    sourceProfile: "avatarforcing-centered-832x480p25-v1",
    rateProfile: "native-25-to-renderer-30-round-near-v1",
    requestedLayout: authority.timelineLayout,
    reportedCostMicroUsd: 0,
  });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function assertAuthority(
  scope: AvatarAcceptanceScope,
  command: AvatarAcceptanceCommand,
  authority: AvatarExecutionAuthority,
): void {
  if (scope.workspaceId !== authority.workspaceId)
    throw new AvatarAcceptanceError(
      "WORKSPACE_MISMATCH",
      "Avatar workspace does not match actor scope.",
    );
  if (
    authority.projectId !== command.projectId ||
    authority.revisionId !== command.revisionId ||
    authority.timelineId !== command.timelineId ||
    authority.timelineSegmentId !== command.timelineSegmentId ||
    authority.selectedSpanAudioId !== command.selectedSpanAudioId ||
    authority.taskId !== command.taskId ||
    authority.attemptId !== command.attemptId ||
    authority.outboxId !== command.outboxId ||
    authority.callbackReceiptId !== command.callbackReceiptId
  )
    throw new AvatarAcceptanceError("DURABLE_STATE_INVALID", "Avatar authority identity drifted.");
  if (authority.taskState === "CANCELLED" || authority.attemptState === "CANCELLED")
    throw new AvatarAcceptanceError("CANCELLED", "Avatar execution was cancelled.");
  if (authority.claimTokenHash !== command.presentedClaimTokenHash)
    throw new AvatarAcceptanceError("CLAIM_STALE", "Avatar execution claim is stale.");
  if (
    authority.revisionState !== "GENERATING" ||
    authority.timelineState !== "CURRENT" ||
    authority.avatarState !== "READY" ||
    authority.spanState !== "READY" ||
    authority.outboxState !== "ACKNOWLEDGED" ||
    authority.callbackState !== "RECEIVED"
  )
    throw new AvatarAcceptanceError(
      "DURABLE_STATE_INVALID",
      "Avatar authority is stale or incomplete.",
    );
  if (
    (authority.accepted === null &&
      (authority.taskState !== "RUNNING" || authority.attemptState !== "CLAIMED")) ||
    (authority.accepted !== null &&
      (authority.taskState !== "SUCCEEDED" || authority.attemptState !== "SUCCEEDED"))
  )
    throw new AvatarAcceptanceError(
      "DURABLE_STATE_INVALID",
      "Avatar state does not match acceptance.",
    );
}

export class DurableFixtureAvatarAcceptanceService {
  public constructor(
    private readonly store: AvatarAcceptanceStore,
    private readonly clock: { now(): string },
    private readonly telemetry: TelemetryPort,
  ) {}

  public async accept(
    scope: AvatarAcceptanceScope,
    command: AvatarAcceptanceCommand,
    rawResult: unknown,
    media: Uint8Array,
  ): Promise<{ readonly accepted: AcceptedFixtureAvatar; readonly replayed: boolean }> {
    const expectedKeys = [
      "attemptId",
      "callbackReceiptId",
      "outboxId",
      "presentedClaimTokenHash",
      "projectId",
      "revisionId",
      "selectedSpanAudioId",
      "taskId",
      "timelineId",
      "timelineSegmentId",
    ].sort();
    const actualKeys = Object.keys(command).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    )
      throw new AvatarAcceptanceError("DURABLE_STATE_INVALID", "Avatar command shape is invalid.");
    for (const value of [
      command.projectId,
      command.revisionId,
      command.timelineId,
      command.timelineSegmentId,
      command.selectedSpanAudioId,
      command.taskId,
      command.attemptId,
      command.outboxId,
      command.callbackReceiptId,
    ])
      if (!TOKEN.test(value))
        throw new AvatarAcceptanceError("DURABLE_STATE_INVALID", "Avatar command ID is invalid.");
    if (!SHA256.test(command.presentedClaimTokenHash))
      throw new AvatarAcceptanceError("CLAIM_STALE", "Avatar claim token hash is invalid.");
    const authority = await this.store.resolve(scope, command);
    if (authority === null)
      throw new AvatarAcceptanceError("WORKSPACE_MISMATCH", "Avatar authority was not found.");
    assertAuthority(scope, command, authority);
    const validated = validateAvatarFixtureResult(authority, rawResult, media);
    if (authority.accepted !== null) {
      if (authority.accepted.result.resultHash !== validated.resultHash)
        throw new AvatarAcceptanceError(
          "HASH_MISMATCH",
          "Avatar replay conflicts with accepted bytes.",
        );
      return Object.freeze({ accepted: authority.accepted, replayed: true });
    }
    if (validated.reportedCostMicroUsd > authority.reservedCostMicroUsd)
      throw new AvatarAcceptanceError("COST_MISMATCH", "Avatar reported cost exceeds reservation.");
    const acceptedAt = this.clock.now();
    if (Number.isNaN(Date.parse(acceptedAt)))
      throw new AvatarAcceptanceError(
        "DURABLE_STATE_INVALID",
        "Avatar acceptance clock is invalid.",
      );
    const bindings = Object.freeze([
      Object.freeze({ layout: "AVATAR_FULL" as const, cropProfile: "832:468:0:6" as const }),
      Object.freeze({
        layout: "AVATAR_SPLIT_IMAGE" as const,
        cropProfile: "416:468:208:6" as const,
      }),
    ]) as AcceptedFixtureAvatar["rendererBindings"];
    const base = {
      schemaVersion: AVATAR_FIXTURE_ACCEPTANCE_VERSION,
      result: validated,
      callbackReceiptId: authority.callbackReceiptId,
      subjectiveClassification: "UNREVIEWED" as const,
      rendererBindings: bindings,
      acceptedAt,
    };
    const acceptance = Object.freeze({ ...base, acceptanceFingerprintHash: hashCanonical(base) });
    const persisted = await this.store.accept(scope, authority, acceptance);
    try {
      await this.telemetry.record({
        schemaVersion: "telemetry-event/v1",
        streamId: `avatar:${authority.attemptId}`,
        sequence: 1,
        eventName: "fixture_avatar.accepted",
        occurredAt: acceptedAt,
        correlation: {
          requestId: null,
          workspaceId: authority.workspaceId,
          projectId: authority.projectId,
          revisionId: authority.revisionId,
          taskId: authority.taskId,
          attemptId: authority.attemptId,
          outboxId: authority.outboxId,
          providerJobId: null,
        },
        stage: "AVATAR",
        providerOperation: "fixture.avatar.accept",
        retry: {
          attemptNumber: authority.attemptOrdinal,
          maximumAttempts: 32,
          parentAttemptId: null,
        },
        queueWaitMs: null,
        durationMs: null,
        cost: {
          reservedMicroUsd: authority.reservedCostMicroUsd,
          reportedMicroUsd: 0,
          settledMicroUsd: 0,
        },
        outcome: "SUCCEEDED",
        error: null,
      });
    } catch {
      // Telemetry is non-authoritative and cannot roll back accepted media.
    }
    return persisted;
  }
}

function dbText(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be text`);
  return value;
}
function dbInteger(value: unknown, name: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string"
          ? Number(value)
          : NaN;
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${name} must be an integer`);
  return parsed;
}
function dbObject(value: unknown, name: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TypeError(`${name} must be an object`);
  return parsed as Record<string, unknown>;
}
function taskState(value: string): AvatarExecutionAuthority["taskState"] | null {
  if (value === "RUNNING") return "RUNNING";
  if (value === "COMPLETE") return "SUCCEEDED";
  if (value === "CANCEL_REQUESTED" || value === "CANCELLED") return "CANCELLED";
  return null;
}
function attemptState(value: string): AvatarExecutionAuthority["attemptState"] | null {
  if (value === "CLAIMED" || value === "RUNNING") return "CLAIMED";
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "CANCELLED") return "CANCELLED";
  return null;
}

async function loadAuthority(
  executor: SqlExecutor,
  scope: AvatarAcceptanceScope,
  command: AvatarAcceptanceCommand,
): Promise<AvatarExecutionAuthority | null> {
  const result = await executor.query<Row>(
    `SELECT revision.workspace_id, revision.project_id, revision.id AS revision_id,
            revision.status AS revision_state, revision.avatar_profile_id,
            revision.avatar_profile_version_id, revision.avatar_profile_hash AS revision_avatar_hash,
            revision.avatar_runtime_source_asset_id, revision.avatar_runtime_source_binary_sha256,
            revision.avatar_source_preparation_profile, revision.avatar_source_validation_profile,
            avatar.state AS avatar_state, avatar.profile_hash AS avatar_hash,
            avatar.runtime_source_asset_id, avatar.runtime_source_binary_sha256,
            runtime.binary_sha256 AS runtime_asset_hash,
            head.current_timeline_plan_id, segment.id AS timeline_segment_id,
            segment.timeline_composition,
            span.id AS selected_span_audio_id, span.state AS span_state,
            span.materialized_asset_id AS span_audio_asset_id,
            span.materialized_binary_sha256 AS span_audio_sha256,
            span.selected_start_ms, span.selected_end_ms_exclusive,
            span.trim_start_ms, span.trim_end_ms_exclusive,
            span_asset.kind AS span_asset_kind, span_asset.state AS span_asset_state,
            span_asset.binary_sha256 AS span_asset_hash, span_asset.duration_ms AS span_duration_ms,
            span_asset.metadata AS span_asset_metadata,
            task.id AS task_id, task.state AS task_state, task.lane, task.owner_type, task.owner_id,
            attempt.id AS attempt_id, attempt.ordinal, attempt.state AS attempt_state,
            attempt.claim_state, attempt.dispatch_state, attempt.execution_claim_token_hash,
            attempt.input_hash, dispatch.id AS outbox_id, dispatch.kind AS outbox_kind,
            dispatch.state AS outbox_state, callback.id AS callback_receipt_id,
            callback.payload_hash AS callback_payload_hash, callback.callback_kind,
            reservation.amount_micro_usd AS reserved_cost_micro_usd,
            accepted.acceptance_payload
       FROM public.memberships membership
       JOIN public.project_revisions revision
         ON revision.workspace_id = membership.workspace_id AND revision.id = $3
       JOIN public.projects project
         ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id
       JOIN public.avatar_profile_versions avatar
         ON avatar.workspace_id = revision.workspace_id AND avatar.profile_id = revision.avatar_profile_id
        AND avatar.id = revision.avatar_profile_version_id
       JOIN public.assets runtime
         ON runtime.workspace_id = avatar.workspace_id AND runtime.id = avatar.runtime_source_asset_id
       JOIN public.revision_timing_heads head
         ON head.workspace_id = revision.workspace_id AND head.project_revision_id = revision.id
       JOIN public.timeline_segments segment
         ON segment.workspace_id = revision.workspace_id AND segment.project_revision_id = revision.id
        AND segment.timeline_plan_id = head.current_timeline_plan_id AND segment.id = $6
       JOIN public.selected_span_audio span
         ON span.workspace_id = segment.workspace_id AND span.project_revision_id = segment.project_revision_id
        AND span.timeline_plan_id = segment.timeline_plan_id AND span.timeline_segment_id = segment.id
        AND span.id = $7
       JOIN public.assets span_asset
         ON span_asset.workspace_id = span.workspace_id
        AND span_asset.id = span.materialized_asset_id
       JOIN public.generation_tasks task
         ON task.workspace_id = revision.workspace_id AND task.id = $8
       JOIN public.attempts attempt
         ON attempt.workspace_id = task.workspace_id AND attempt.task_id = task.id AND attempt.id = $9
       JOIN public.outbox dispatch
         ON dispatch.workspace_id = attempt.workspace_id AND dispatch.task_id = attempt.task_id
        AND dispatch.attempt_id = attempt.id AND dispatch.id = $10
       JOIN public.callback_receipts callback
         ON callback.workspace_id = attempt.workspace_id AND callback.task_id = attempt.task_id
        AND callback.attempt_id = attempt.id AND callback.id = $11
       JOIN public.cost_events reservation
         ON reservation.workspace_id = attempt.workspace_id AND reservation.task_id = attempt.task_id
        AND reservation.attempt_id = attempt.id AND reservation.event_type = 'RESERVED'
       LEFT JOIN public.avatar_generation_acceptances accepted
         ON accepted.workspace_id = attempt.workspace_id AND accepted.attempt_id = attempt.id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'ACTIVE'
        AND revision.project_id = $4 AND head.current_timeline_plan_id = $5`,
    [
      scope.workspaceId,
      scope.actorUserId,
      command.revisionId,
      command.projectId,
      command.timelineId,
      command.timelineSegmentId,
      command.selectedSpanAudioId,
      command.taskId,
      command.attemptId,
      command.outboxId,
      command.callbackReceiptId,
    ],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0]!;
  const mappedTask = taskState(dbText(row.task_state, "task state"));
  const mappedAttempt = attemptState(dbText(row.attempt_state, "attempt state"));
  const layout = dbText(row.timeline_composition, "timeline composition");
  if (
    mappedTask === null ||
    mappedAttempt === null ||
    !["AVATAR_FULL", "AVATAR_SPLIT_IMAGE"].includes(layout)
  )
    return null;
  const avatarHash = dbText(row.avatar_hash, "avatar hash") as Sha256Digest;
  const runtimeHash = dbText(row.runtime_source_binary_sha256, "runtime hash") as Sha256Digest;
  const avatarReady =
    dbText(row.avatar_state, "avatar state") === "READY" &&
    dbText(row.revision_avatar_hash, "revision avatar hash") === avatarHash &&
    dbText(row.avatar_runtime_source_asset_id, "revision runtime asset") ===
      dbText(row.runtime_source_asset_id, "avatar runtime asset") &&
    dbText(row.avatar_runtime_source_binary_sha256, "revision runtime hash") === runtimeHash &&
    dbText(row.runtime_asset_hash, "runtime asset hash") === runtimeHash;
  const selectedStartMs = dbInteger(row.selected_start_ms, "selected start");
  const selectedEndMs = dbInteger(row.selected_end_ms_exclusive, "selected end");
  const trimStartMs = dbInteger(row.trim_start_ms, "trim start");
  const trimEndMs = dbInteger(row.trim_end_ms_exclusive, "trim end");
  const spanHash = dbText(row.span_audio_sha256, "span hash") as Sha256Digest;
  const spanMetadata = dbObject(row.span_asset_metadata, "span asset metadata");
  const spanReady =
    dbText(row.span_state, "span state") === "MATERIALIZED" &&
    dbText(row.span_asset_kind, "span asset kind") === "AUDIO_SPAN" &&
    ["VERIFIED", "ACCEPTED"].includes(dbText(row.span_asset_state, "span asset state")) &&
    dbText(row.span_asset_hash, "span asset hash") === spanHash &&
    dbInteger(row.span_duration_ms, "span duration") === trimEndMs - trimStartMs &&
    spanMetadata.sample_rate_hz === 48_000 &&
    spanMetadata.channels === 1;
  return Object.freeze({
    workspaceId: dbText(row.workspace_id, "workspace"),
    projectId: dbText(row.project_id, "project"),
    revisionId: dbText(row.revision_id, "revision"),
    revisionState:
      dbText(row.revision_state, "revision state") === "LOCKED" ? "GENERATING" : "STALE",
    timelineId: dbText(row.current_timeline_plan_id, "timeline"),
    timelineState: "CURRENT",
    timelineSegmentId: dbText(row.timeline_segment_id, "segment"),
    timelineLayout: layout as TimelineLayout,
    avatarProfileId: dbText(row.avatar_profile_id, "avatar profile"),
    avatarProfileVersionId: dbText(row.avatar_profile_version_id, "avatar version"),
    avatarProfileHash: avatarHash,
    runtimeSourceAssetId: dbText(row.runtime_source_asset_id, "runtime asset"),
    runtimeSourceSha256: runtimeHash,
    sourcePreparationVersion: dbText(row.avatar_source_preparation_profile, "source preparation"),
    sourceValidationProfileVersion: dbText(
      row.avatar_source_validation_profile,
      "source validation",
    ),
    avatarState: avatarReady ? "READY" : "STALE",
    selectedSpanAudioId: dbText(row.selected_span_audio_id, "selected span"),
    spanAudioAssetId: dbText(row.span_audio_asset_id, "span asset"),
    spanAudioSha256: spanHash,
    spanState: spanReady ? "READY" : "STALE",
    sourceStartMs: selectedStartMs,
    sourceEndMs: selectedEndMs,
    trimStartSample: trimStartMs * 48,
    trimEndSampleExclusive: trimEndMs * 48,
    taskId: dbText(row.task_id, "task"),
    taskState: mappedTask,
    attemptId: dbText(row.attempt_id, "attempt"),
    attemptOrdinal: dbInteger(row.ordinal, "attempt ordinal"),
    attemptState: mappedAttempt,
    claimTokenHash: dbText(row.execution_claim_token_hash, "claim hash") as Sha256Digest,
    recordedInputHash: dbText(row.input_hash, "input hash") as Sha256Digest,
    outboxId: dbText(row.outbox_id, "outbox"),
    outboxState:
      dbText(row.outbox_state, "outbox state") === "DELIVERED" &&
      dbText(row.outbox_kind, "outbox kind") === "DISPATCH" &&
      dbText(row.dispatch_state, "dispatch state") === "ACKNOWLEDGED" &&
      dbText(row.claim_state, "claim state") === "CLAIMED"
        ? "ACKNOWLEDGED"
        : "STALE",
    callbackReceiptId: dbText(row.callback_receipt_id, "callback"),
    callbackPayloadHash: dbText(row.callback_payload_hash, "callback hash") as Sha256Digest,
    callbackState:
      dbText(row.callback_kind, "callback kind") === "avatar_fixture_result" ? "RECEIVED" : "STALE",
    reservedCostMicroUsd: dbInteger(row.reserved_cost_micro_usd, "reserved cost"),
    accepted:
      row.acceptance_payload === null
        ? null
        : (dbObject(row.acceptance_payload, "acceptance") as unknown as AcceptedFixtureAvatar),
  });
}

async function lockAuthority(
  executor: SqlExecutor,
  scope: AvatarAcceptanceScope,
  authority: AvatarExecutionAuthority,
): Promise<void> {
  for (const [table, clause, values] of [
    ["project_revisions", "workspace_id=$1 AND id=$2", [scope.workspaceId, authority.revisionId]],
    [
      "revision_timing_heads",
      "workspace_id=$1 AND project_revision_id=$2",
      [scope.workspaceId, authority.revisionId],
    ],
    ["generation_tasks", "workspace_id=$1 AND id=$2", [scope.workspaceId, authority.taskId]],
    [
      "attempts",
      "workspace_id=$1 AND task_id=$2 AND id=$3",
      [scope.workspaceId, authority.taskId, authority.attemptId],
    ],
    ["outbox", "workspace_id=$1 AND id=$2", [scope.workspaceId, authority.outboxId]],
    [
      "callback_receipts",
      "workspace_id=$1 AND id=$2",
      [scope.workspaceId, authority.callbackReceiptId],
    ],
  ] as const)
    await executor.query(`SELECT 1 FROM public.${table} WHERE ${clause} FOR UPDATE`, values);
}

export class PGliteFixtureAvatarAcceptanceStore implements AvatarAcceptanceStore {
  public constructor(private readonly database: TransactionalSqlExecutor) {}
  public resolve(
    scope: AvatarAcceptanceScope,
    command: AvatarAcceptanceCommand,
  ): Promise<AvatarExecutionAuthority | null> {
    return loadAuthority(this.database, scope, command);
  }
  public async accept(
    scope: AvatarAcceptanceScope,
    authority: AvatarExecutionAuthority,
    acceptance: AcceptedFixtureAvatar,
  ): Promise<{ readonly accepted: AcceptedFixtureAvatar; readonly replayed: boolean }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await lockAuthority(transaction, scope, authority);
        const command: AvatarAcceptanceCommand = {
          projectId: authority.projectId,
          revisionId: authority.revisionId,
          timelineId: authority.timelineId,
          timelineSegmentId: authority.timelineSegmentId,
          selectedSpanAudioId: authority.selectedSpanAudioId,
          taskId: authority.taskId,
          attemptId: authority.attemptId,
          outboxId: authority.outboxId,
          callbackReceiptId: authority.callbackReceiptId,
          presentedClaimTokenHash: authority.claimTokenHash,
        };
        const current = await loadAuthority(transaction, scope, command);
        if (current === null)
          throw new AvatarAcceptanceError("REPOSITORY_FAILURE", "Avatar authority disappeared.");
        if (current.accepted !== null) {
          if (current.accepted.acceptanceFingerprintHash !== acceptance.acceptanceFingerprintHash)
            throw new AvatarAcceptanceError(
              "HASH_MISMATCH",
              "Avatar replay conflicts with accepted bytes.",
            );
          return Object.freeze({ accepted: current.accepted, replayed: true });
        }
        if (!same(current, authority))
          throw new AvatarAcceptanceError(
            "DURABLE_STATE_INVALID",
            "Avatar authority changed before acceptance.",
          );
        const result = acceptance.result;
        const acceptanceId = deterministicUuid(`avatar-acceptance:${current.attemptId}`);
        const assetId = deterministicUuid(`avatar-output:${current.attemptId}`);
        const qaId = deterministicUuid(`avatar-technical-qa:${current.attemptId}`);
        const reservation = await transaction.query<Row>(
          `SELECT id FROM public.cost_events WHERE workspace_id=$1 AND task_id=$2 AND attempt_id=$3 AND event_type='RESERVED'`,
          [scope.workspaceId, current.taskId, current.attemptId],
        );
        if (reservation.rows.length !== 1)
          throw new AvatarAcceptanceError("COST_MISMATCH", "Avatar reservation is not exact.");
        const reservationId = dbText(reservation.rows[0]!.id, "reservation");
        const objectKey = `workspace/${scope.workspaceId}/project/${current.projectId}/revision/${current.revisionId}/avatar/primary/${current.attemptId}.mp4`;
        await transaction.query(
          `INSERT INTO public.assets (id,workspace_id,project_id,project_revision_id,source_attempt_id,
             kind,state,object_key,binary_sha256,content_type,byte_size,width_px,height_px,duration_ms,
             metadata,verified_at)
           VALUES ($1,$2,$3,$4,$5,'AVATAR_CLIP','ACCEPTED',$6,$7,'video/mp4',$8,$9,$10,$11,$12::jsonb,$13)`,
          [
            assetId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            current.attemptId,
            objectKey,
            result.binarySha256,
            result.byteSize,
            result.widthPx,
            result.heightPx,
            result.durationMs,
            JSON.stringify({
              fixture_non_production: true,
              selected_span_audio_id: current.selectedSpanAudioId,
              avatar_profile_version_id: current.avatarProfileVersionId,
              result_hash: result.resultHash,
              renderer_source_profile: result.sourceProfile,
            }),
            acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `INSERT INTO public.qa_results (id,workspace_id,project_revision_id,attempt_id,asset_id,
             qa_kind,state,notes,created_at,decided_at)
           VALUES ($1,$2,$3,$4,$5,'TECHNICAL','PASSED',$6,$7,$7)`,
          [
            qaId,
            scope.workspaceId,
            current.revisionId,
            current.attemptId,
            assetId,
            "Fixture native clip signature, checksum, duration, cadence, crop, and audio binding passed; subjective quality remains unreviewed.",
            acceptance.acceptedAt,
          ],
        );
        const sequence = await transaction.query<Row>(
          `SELECT COALESCE(max(sequence),0)::int AS value FROM public.cost_events
            WHERE workspace_id=$1 AND owner_type='PROJECT_REVISION' AND owner_id=$2`,
          [scope.workspaceId, current.revisionId],
        );
        const firstSequence = dbInteger(sequence.rows[0]!.value, "cost sequence") + 1;
        for (const [offset, eventType] of ["REPORTED", "SETTLED"].entries())
          await transaction.query(
            `INSERT INTO public.cost_events (id,workspace_id,owner_type,owner_id,task_id,attempt_id,
             sequence,event_type,amount_micro_usd,idempotency_key,details,occurred_at)
           VALUES ($1,$2,'PROJECT_REVISION',$3,$4,$5,$6,$7,0,$8,$9::jsonb,$10)`,
            [
              deterministicUuid(`avatar-cost:${eventType}:${current.attemptId}`),
              scope.workspaceId,
              current.revisionId,
              current.taskId,
              current.attemptId,
              firstSequence + offset,
              eventType,
              `avatar:${current.attemptId}:${eventType.toLowerCase()}`,
              JSON.stringify({
                source: "fixture-avatar-acceptance",
                result_hash: result.resultHash,
              }),
              acceptance.acceptedAt,
            ],
          );
        await transaction.query(
          `INSERT INTO public.avatar_generation_acceptances (
             id,workspace_id,project_id,project_revision_id,timeline_plan_id,timeline_segment_id,
             avatar_profile_id,avatar_profile_version_id,avatar_profile_hash,runtime_source_asset_id,
             runtime_source_sha256,selected_span_audio_id,span_audio_asset_id,span_audio_sha256,
             task_id,attempt_id,outbox_id,callback_receipt_id,reservation_cost_event_id,
             output_asset_id,qa_result_id,schema_version,input_hash,result_hash,
             acceptance_fingerprint_hash,binary_sha256,source_profile,rate_profile,
             subjective_classification,reserved_cost_micro_usd,reported_cost_micro_usd,
             technical_validation,acceptance_payload,accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,'UNREVIEWED',$29,0,$30::jsonb,$31::jsonb,$32)`,
          [
            acceptanceId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            current.timelineId,
            current.timelineSegmentId,
            current.avatarProfileId,
            current.avatarProfileVersionId,
            current.avatarProfileHash,
            current.runtimeSourceAssetId,
            current.runtimeSourceSha256,
            current.selectedSpanAudioId,
            current.spanAudioAssetId,
            current.spanAudioSha256,
            current.taskId,
            current.attemptId,
            current.outboxId,
            current.callbackReceiptId,
            reservationId,
            assetId,
            qaId,
            acceptance.schemaVersion,
            current.recordedInputHash,
            result.resultHash,
            acceptance.acceptanceFingerprintHash,
            result.binarySha256,
            result.sourceProfile,
            result.rateProfile,
            current.reservedCostMicroUsd,
            JSON.stringify({
              technical_status: "PASS",
              subjective_classification: "UNREVIEWED",
              width_px: result.widthPx,
              height_px: result.heightPx,
              fps_num: result.fpsNum,
              fps_den: result.fpsDen,
              frame_count: result.frameCount,
              duration_ms: result.durationMs,
            }),
            JSON.stringify(acceptance),
            acceptance.acceptedAt,
          ],
        );
        for (const binding of acceptance.rendererBindings)
          await transaction.query(
            `INSERT INTO public.avatar_renderer_bindings (id,workspace_id,avatar_generation_acceptance_id,
             output_asset_id,layout,source_profile,crop_profile,rate_profile,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              deterministicUuid(`avatar-binding:${current.attemptId}:${binding.layout}`),
              scope.workspaceId,
              acceptanceId,
              assetId,
              binding.layout,
              result.sourceProfile,
              binding.cropProfile,
              result.rateProfile,
              acceptance.acceptedAt,
            ],
          );
        await transaction.query(
          `UPDATE public.attempts SET state='SUCCEEDED',output_asset_id=$4,result_disposition='ACCEPTED',
             provider_details=$5::jsonb,finished_at=$6 WHERE workspace_id=$1 AND task_id=$2 AND id=$3`,
          [
            scope.workspaceId,
            current.taskId,
            current.attemptId,
            assetId,
            JSON.stringify({
              operation: "fixture.avatar.accept",
              result_hash: result.resultHash,
              callback_receipt_id: current.callbackReceiptId,
              fixture_non_production: true,
              subjective_classification: "UNREVIEWED",
            }),
            acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `UPDATE public.generation_tasks SET state='COMPLETE',accepted_attempt_id=$3,
             version=version+1,finished_at=$4,updated_at=$4 WHERE workspace_id=$1 AND id=$2`,
          [scope.workspaceId, current.taskId, current.attemptId, acceptance.acceptedAt],
        );
        return Object.freeze({ accepted: acceptance, replayed: false });
      });
    } catch (error) {
      if (error instanceof AvatarAcceptanceError) throw error;
      throw new AvatarAcceptanceError(
        "REPOSITORY_FAILURE",
        "Avatar acceptance transaction failed.",
      );
    }
  }
}
