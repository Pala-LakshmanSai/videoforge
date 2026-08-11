import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import { verifyCompiledImagePrompt, type CompiledImagePrompt } from "@videoforge/pipeline";

import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import type { TelemetryPort } from "../telemetry/telemetry.js";

export const FIXTURE_IMAGE_RESULT_VERSION = "videoforge.fixture-image-result/v1" as const;
export const FIXTURE_IMAGE_ACCEPTANCE_VERSION = "videoforge.fixture-image-acceptance/v1" as const;

type Row = Record<string, unknown>;
type Layout = "IMAGE_FULL" | "SPLIT_RIGHT_IMAGE";

export type ImageAcceptanceErrorCode =
  | "CALLBACK_INVALID"
  | "CANCELLED"
  | "CLAIM_STALE"
  | "COST_MISMATCH"
  | "DURABLE_STATE_INVALID"
  | "HASH_MISMATCH"
  | "MEDIA_INVALID"
  | "REPOSITORY_FAILURE"
  | "WORKSPACE_MISMATCH";

export class ImageAcceptanceError extends Error {
  public constructor(
    public readonly code: ImageAcceptanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImageAcceptanceError";
  }
}

export interface ImageAcceptanceScope {
  readonly workspaceId: string;
  readonly actorUserId: string;
}

export interface ImageAcceptanceCommand {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly promptExecutionId: string;
  readonly promptSceneResultId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly outboxId: string;
  readonly callbackReceiptId: string;
  readonly presentedClaimTokenHash: Sha256Digest;
}

export interface ImageExecutionAuthority {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly revisionState: "GENERATING" | "STALE";
  readonly timelineId: string;
  readonly timelineHash: Sha256Digest;
  readonly timelineState: "CURRENT" | "STALE";
  readonly imageStyleId: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileArtifactId: string | null;
  readonly styleProfileHash: Sha256Digest;
  readonly styleState: "PUBLISHED" | "STALE";
  readonly promptExecutionId: string;
  readonly promptSceneResultId: string;
  readonly sceneId: string;
  readonly layout: Layout;
  readonly compiledPrompt: CompiledImagePrompt;
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
  readonly accepted: AcceptedFixtureImage | null;
}

export interface FixtureImageResult {
  readonly schemaVersion: typeof FIXTURE_IMAGE_RESULT_VERSION;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileArtifactId: string | null;
  readonly styleProfileHash: Sha256Digest;
  readonly promptExecutionId: string;
  readonly promptSceneResultId: string;
  readonly sceneId: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly attemptOrdinal: number;
  readonly outboxId: string;
  readonly inputHash: Sha256Digest;
  readonly positivePromptHash: Sha256Digest;
  readonly negativePromptHash: Sha256Digest;
  readonly fixtureModel: "mage-shaped-fixture-v1";
  readonly seed: number;
  readonly layout: Layout;
  readonly media: {
    readonly contentType: "image/png";
    readonly widthPx: number;
    readonly heightPx: number;
    readonly byteSize: number;
    readonly binarySha256: Sha256Digest;
    readonly objectKey: string;
  };
  readonly technicalValidation: {
    readonly decoder: "fixture-png-structural-v1";
    readonly signatureValid: true;
    readonly dimensionsValid: true;
    readonly aspectRatioValid: true;
  };
  readonly reportedCostMicroUsd: number;
  readonly resultHash: Sha256Digest;
}

export interface AcceptedFixtureImage {
  readonly schemaVersion: typeof FIXTURE_IMAGE_ACCEPTANCE_VERSION;
  readonly result: FixtureImageResult;
  readonly callbackReceiptId: string;
  readonly acceptedAt: string;
  readonly acceptanceFingerprintHash: Sha256Digest;
}

export interface ImageAcceptanceStore {
  resolve(
    scope: ImageAcceptanceScope,
    command: ImageAcceptanceCommand,
  ): Promise<ImageExecutionAuthority | null>;
  accept(
    scope: ImageAcceptanceScope,
    authority: ImageExecutionAuthority,
    acceptance: AcceptedFixtureImage,
  ): Promise<{ readonly accepted: AcceptedFixtureImage; readonly replayed: boolean }>;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.byteLength);
  result.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(result, 4);
  Buffer.from(data).copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return result;
}

function fixturePng(
  width: number,
  height: number,
  color: readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let pixel = 0; pixel < width; pixel += 1) {
    row[1 + pixel * 3] = color[0];
    row[2 + pixel * 3] = color[1];
    row[3 + pixel * 3] = color[2];
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngDimensions(media: Uint8Array): { width: number; height: number } {
  const bytes = Buffer.from(media);
  if (
    bytes.byteLength < 45 ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(8) !== 13 ||
    !bytes.includes(Buffer.from("IEND", "ascii"))
  )
    throw new ImageAcceptanceError("MEDIA_INVALID", "Fixture image is not a structural PNG.");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function resultBase(
  authority: ImageExecutionAuthority,
  media: Uint8Array,
): Omit<FixtureImageResult, "resultHash"> {
  const dimensions = pngDimensions(media);
  const expected =
    authority.layout === "IMAGE_FULL" ? { width: 64, height: 36 } : { width: 32, height: 36 };
  if (dimensions.width !== expected.width || dimensions.height !== expected.height)
    throw new ImageAcceptanceError("MEDIA_INVALID", "Fixture image dimensions drifted.");
  return Object.freeze({
    schemaVersion: FIXTURE_IMAGE_RESULT_VERSION,
    workspaceId: authority.workspaceId,
    projectId: authority.projectId,
    revisionId: authority.revisionId,
    timelineId: authority.timelineId,
    imageStyleVersionId: authority.imageStyleVersionId,
    styleProfileArtifactId: authority.styleProfileArtifactId,
    styleProfileHash: authority.styleProfileHash,
    promptExecutionId: authority.promptExecutionId,
    promptSceneResultId: authority.promptSceneResultId,
    sceneId: authority.sceneId,
    taskId: authority.taskId,
    attemptId: authority.attemptId,
    attemptOrdinal: authority.attemptOrdinal,
    outboxId: authority.outboxId,
    inputHash: authority.recordedInputHash,
    positivePromptHash: authority.compiledPrompt.positivePromptSha256,
    negativePromptHash: authority.compiledPrompt.negativePromptSha256,
    fixtureModel: "mage-shaped-fixture-v1",
    seed: Number.parseInt(authority.recordedInputHash.slice(7, 15), 16),
    layout: authority.layout,
    media: Object.freeze({
      contentType: "image/png",
      widthPx: dimensions.width,
      heightPx: dimensions.height,
      byteSize: media.byteLength,
      binarySha256: hashBytes(media),
      objectKey: `workspace/${authority.workspaceId}/project/${authority.projectId}/revision/${authority.revisionId}/images/${authority.attemptId}.png`,
    }),
    technicalValidation: Object.freeze({
      decoder: "fixture-png-structural-v1",
      signatureValid: true,
      dimensionsValid: true,
      aspectRatioValid: true,
    }),
    reportedCostMicroUsd: 0,
  });
}

export class DeterministicMageFixtureWorker {
  public readonly operation = "fixture.image.generate" as const;
  public generate(authority: ImageExecutionAuthority): {
    readonly result: FixtureImageResult;
    readonly media: Buffer;
  } {
    verifyCompiledImagePrompt(authority.compiledPrompt);
    const dimensions =
      authority.layout === "IMAGE_FULL" ? { width: 64, height: 36 } : { width: 32, height: 36 };
    const colorBytes = createHash("sha256").update(authority.recordedInputHash, "utf8").digest();
    const media = fixturePng(dimensions.width, dimensions.height, [
      colorBytes[0]!,
      colorBytes[1]!,
      colorBytes[2]!,
    ]);
    const base = resultBase(authority, media);
    return Object.freeze({
      result: Object.freeze({ ...base, resultHash: hashCanonical(base) }),
      media,
    });
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

function assertAuthority(
  scope: ImageAcceptanceScope,
  command: ImageAcceptanceCommand,
  authority: ImageExecutionAuthority,
): void {
  if (scope.workspaceId !== authority.workspaceId)
    throw new ImageAcceptanceError(
      "WORKSPACE_MISMATCH",
      "Image workspace does not match actor scope.",
    );
  if (
    authority.projectId !== command.projectId ||
    authority.revisionId !== command.revisionId ||
    authority.timelineId !== command.timelineId ||
    authority.promptExecutionId !== command.promptExecutionId ||
    authority.promptSceneResultId !== command.promptSceneResultId ||
    authority.taskId !== command.taskId ||
    authority.attemptId !== command.attemptId ||
    authority.outboxId !== command.outboxId ||
    authority.callbackReceiptId !== command.callbackReceiptId
  )
    throw new ImageAcceptanceError("DURABLE_STATE_INVALID", "Image authority identity drifted.");
  if (authority.taskState === "CANCELLED" || authority.attemptState === "CANCELLED")
    throw new ImageAcceptanceError("CANCELLED", "Image execution was cancelled.");
  if (authority.claimTokenHash !== command.presentedClaimTokenHash)
    throw new ImageAcceptanceError("CLAIM_STALE", "Image execution claim is stale.");
  if (
    authority.revisionState !== "GENERATING" ||
    authority.timelineState !== "CURRENT" ||
    authority.styleState !== "PUBLISHED" ||
    authority.outboxState !== "ACKNOWLEDGED" ||
    authority.callbackState !== "RECEIVED"
  )
    throw new ImageAcceptanceError(
      "DURABLE_STATE_INVALID",
      "Image authority is stale or incomplete.",
    );
  if (
    (authority.accepted === null &&
      (authority.taskState !== "RUNNING" || authority.attemptState !== "CLAIMED")) ||
    (authority.accepted !== null &&
      (authority.taskState !== "SUCCEEDED" || authority.attemptState !== "SUCCEEDED"))
  )
    throw new ImageAcceptanceError(
      "DURABLE_STATE_INVALID",
      "Image state does not match acceptance.",
    );
}

function validateResult(
  authority: ImageExecutionAuthority,
  result: FixtureImageResult,
  media: Uint8Array,
): void {
  const { resultHash, ...providedBase } = result;
  const expectedBase = resultBase(authority, media);
  if (!same(providedBase, expectedBase) || resultHash !== hashCanonical(providedBase))
    throw new ImageAcceptanceError("HASH_MISMATCH", "Image result bytes or lineage drifted.");
  if (authority.callbackPayloadHash !== resultHash)
    throw new ImageAcceptanceError(
      "CALLBACK_INVALID",
      "Callback payload does not bind the image result.",
    );
  if (result.reportedCostMicroUsd > authority.reservedCostMicroUsd)
    throw new ImageAcceptanceError("COST_MISMATCH", "Image reported cost exceeds reservation.");
}

export class DurableFixtureImageAcceptanceService {
  public constructor(
    private readonly store: ImageAcceptanceStore,
    private readonly clock: { now(): string },
    private readonly telemetry: TelemetryPort,
  ) {}

  public async accept(
    scope: ImageAcceptanceScope,
    command: ImageAcceptanceCommand,
    result: FixtureImageResult,
    media: Uint8Array,
  ): Promise<{ readonly accepted: AcceptedFixtureImage; readonly replayed: boolean }> {
    const expectedKeys = [
      "attemptId",
      "callbackReceiptId",
      "outboxId",
      "presentedClaimTokenHash",
      "projectId",
      "promptExecutionId",
      "promptSceneResultId",
      "revisionId",
      "taskId",
      "timelineId",
    ].sort();
    const actualKeys = Object.keys(command).sort();
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key, index) => key !== expectedKeys[index])
    )
      throw new ImageAcceptanceError("DURABLE_STATE_INVALID", "Image command shape is invalid.");
    for (const value of [
      command.projectId,
      command.revisionId,
      command.timelineId,
      command.promptExecutionId,
      command.promptSceneResultId,
      command.taskId,
      command.attemptId,
      command.outboxId,
      command.callbackReceiptId,
    ])
      if (!TOKEN.test(value))
        throw new ImageAcceptanceError("DURABLE_STATE_INVALID", "Image command ID is invalid.");
    if (!SHA256.test(command.presentedClaimTokenHash))
      throw new ImageAcceptanceError("CLAIM_STALE", "Image claim token hash is invalid.");
    const authority = await this.store.resolve(scope, command);
    if (authority === null)
      throw new ImageAcceptanceError("WORKSPACE_MISMATCH", "Image authority was not found.");
    assertAuthority(scope, command, authority);
    if (authority.accepted !== null) {
      if (authority.accepted.result.resultHash !== result.resultHash)
        throw new ImageAcceptanceError(
          "HASH_MISMATCH",
          "Image replay conflicts with accepted bytes.",
        );
      return Object.freeze({ accepted: authority.accepted, replayed: true });
    }
    validateResult(authority, result, media);
    const acceptedAt = this.clock.now();
    if (Number.isNaN(Date.parse(acceptedAt)))
      throw new ImageAcceptanceError("DURABLE_STATE_INVALID", "Image acceptance clock is invalid.");
    const base = {
      schemaVersion: FIXTURE_IMAGE_ACCEPTANCE_VERSION,
      result,
      callbackReceiptId: authority.callbackReceiptId,
      acceptedAt,
    } as const;
    const acceptance = Object.freeze({ ...base, acceptanceFingerprintHash: hashCanonical(base) });
    const persisted = await this.store.accept(scope, authority, acceptance);
    try {
      await this.telemetry.record({
        schemaVersion: "telemetry-event/v1",
        streamId: `image:${authority.attemptId}`,
        sequence: 1,
        eventName: "fixture_image.accepted",
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
        stage: "IMAGE",
        providerOperation: "fixture.image.accept",
        retry: {
          attemptNumber: authority.attemptOrdinal,
          maximumAttempts: 32,
          parentAttemptId: null,
        },
        queueWaitMs: null,
        durationMs: null,
        cost: {
          reservedMicroUsd: authority.reservedCostMicroUsd,
          reportedMicroUsd: result.reportedCostMicroUsd,
          settledMicroUsd: result.reportedCostMicroUsd,
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

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be text`);
  return value;
}
function integer(value: unknown, name: string): number {
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
function object(value: unknown, name: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new TypeError(`${name} must be an object`);
  return parsed as Record<string, unknown>;
}
function accepted(value: unknown): AcceptedFixtureImage {
  return object(value, "acceptance_payload") as unknown as AcceptedFixtureImage;
}
function taskState(value: string): ImageExecutionAuthority["taskState"] | null {
  if (value === "RUNNING") return "RUNNING";
  if (value === "COMPLETE") return "SUCCEEDED";
  if (value === "CANCEL_REQUESTED" || value === "CANCELLED") return "CANCELLED";
  return null;
}
function attemptState(value: string): ImageExecutionAuthority["attemptState"] | null {
  if (value === "CLAIMED" || value === "RUNNING") return "CLAIMED";
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "CANCELLED") return "CANCELLED";
  return null;
}

async function loadAuthority(
  executor: SqlExecutor,
  scope: ImageAcceptanceScope,
  command: ImageAcceptanceCommand,
): Promise<ImageExecutionAuthority | null> {
  const result = await executor.query<Row>(
    `SELECT revision.workspace_id, revision.project_id, revision.id AS revision_id,
            revision.status AS revision_state, revision.image_style_id,
            revision.image_style_version_id, revision.style_profile_hash AS revision_style_hash,
            head.current_timeline_plan_id, plan.canonical_document_hash AS timeline_hash,
            style.state AS style_state, style.style_profile_hash,
            style.current_profile_artifact_id, artifact.profile_hash AS artifact_hash,
            prompt.id AS prompt_execution_id, prompt.timeline_plan_id AS prompt_timeline_id,
            prompt.style_profile_hash AS prompt_style_hash,
            scene.id AS prompt_scene_result_id, scene.scene_id, scene.compiled_prompt,
            segment.timeline_composition,
            task.id AS task_id, task.state AS task_state, task.lane, task.owner_type, task.owner_id,
            attempt.id AS attempt_id, attempt.ordinal, attempt.state AS attempt_state,
            attempt.claim_state, attempt.dispatch_state, attempt.execution_claim_token_hash,
            attempt.input_hash, dispatch.id AS outbox_id, dispatch.kind AS outbox_kind,
            dispatch.state AS outbox_state, callback.id AS callback_receipt_id,
            callback.payload_hash AS callback_payload_hash, callback.callback_kind,
            reservation.id AS reservation_cost_event_id,
            reservation.amount_micro_usd AS reserved_cost_micro_usd,
            accepted.acceptance_payload
       FROM public.memberships membership
       JOIN public.project_revisions revision
         ON revision.workspace_id = membership.workspace_id AND revision.id = $3
       JOIN public.projects project
         ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id
       JOIN public.revision_timing_heads head
         ON head.workspace_id = revision.workspace_id AND head.project_revision_id = revision.id
       JOIN public.timeline_plans plan
         ON plan.workspace_id = head.workspace_id AND plan.project_revision_id = head.project_revision_id
        AND plan.id = head.current_timeline_plan_id
       JOIN public.image_style_versions style
         ON style.workspace_id = revision.workspace_id AND style.style_id = revision.image_style_id
        AND style.id = revision.image_style_version_id
       LEFT JOIN public.image_style_profile_artifacts artifact
         ON artifact.workspace_id = style.workspace_id AND artifact.id = style.current_profile_artifact_id
       JOIN public.prompt_executions prompt
         ON prompt.workspace_id = revision.workspace_id AND prompt.id = $6
       JOIN public.prompt_scene_results scene
         ON scene.workspace_id = prompt.workspace_id AND scene.prompt_execution_id = prompt.id AND scene.id = $7
       JOIN public.timeline_segments segment
         ON segment.workspace_id = revision.workspace_id AND segment.project_revision_id = revision.id
        AND segment.timeline_plan_id = head.current_timeline_plan_id AND segment.segment_key = scene.scene_id
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
       LEFT JOIN public.image_generation_acceptances accepted
         ON accepted.workspace_id = attempt.workspace_id AND accepted.attempt_id = attempt.id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2 AND membership.status = 'ACTIVE'
        AND revision.project_id = $4 AND head.current_timeline_plan_id = $5`,
    [
      scope.workspaceId,
      scope.actorUserId,
      command.revisionId,
      command.projectId,
      command.timelineId,
      command.promptExecutionId,
      command.promptSceneResultId,
      command.taskId,
      command.attemptId,
      command.outboxId,
      command.callbackReceiptId,
    ],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0]!;
  const mappedTask = taskState(text(row.task_state, "task state"));
  const mappedAttempt = attemptState(text(row.attempt_state, "attempt state"));
  const composition = text(row.timeline_composition, "timeline composition");
  if (
    mappedTask === null ||
    mappedAttempt === null ||
    !["IMAGE_FULL", "AVATAR_SPLIT_IMAGE"].includes(composition)
  )
    return null;
  const compiled = object(row.compiled_prompt, "compiled prompt") as unknown as CompiledImagePrompt;
  verifyCompiledImagePrompt(compiled);
  const styleHash = text(row.style_profile_hash, "style hash") as Sha256Digest;
  const currentArtifactId =
    row.current_profile_artifact_id === null
      ? null
      : text(row.current_profile_artifact_id, "style artifact");
  const styleCurrent =
    text(row.style_state, "style state") === "PUBLISHED" &&
    text(row.revision_style_hash, "revision style hash") === styleHash &&
    text(row.prompt_style_hash, "prompt style hash") === styleHash &&
    (currentArtifactId === null || text(row.artifact_hash, "artifact hash") === styleHash);
  return Object.freeze({
    workspaceId: text(row.workspace_id, "workspace"),
    projectId: text(row.project_id, "project"),
    revisionId: text(row.revision_id, "revision"),
    revisionState: text(row.revision_state, "revision state") === "LOCKED" ? "GENERATING" : "STALE",
    timelineId: text(row.current_timeline_plan_id, "timeline"),
    timelineHash: text(row.timeline_hash, "timeline hash") as Sha256Digest,
    timelineState:
      text(row.prompt_timeline_id, "prompt timeline") === command.timelineId ? "CURRENT" : "STALE",
    imageStyleId: text(row.image_style_id, "style"),
    imageStyleVersionId: text(row.image_style_version_id, "style version"),
    styleProfileArtifactId: currentArtifactId,
    styleProfileHash: styleHash,
    styleState: styleCurrent ? "PUBLISHED" : "STALE",
    promptExecutionId: text(row.prompt_execution_id, "prompt execution"),
    promptSceneResultId: text(row.prompt_scene_result_id, "prompt scene"),
    sceneId: text(row.scene_id, "scene"),
    layout: composition === "IMAGE_FULL" ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
    compiledPrompt: compiled,
    taskId: text(row.task_id, "task"),
    taskState: mappedTask,
    attemptId: text(row.attempt_id, "attempt"),
    attemptOrdinal: integer(row.ordinal, "attempt ordinal"),
    attemptState: mappedAttempt,
    claimTokenHash: text(row.execution_claim_token_hash, "claim hash") as Sha256Digest,
    recordedInputHash: text(row.input_hash, "input hash") as Sha256Digest,
    outboxId: text(row.outbox_id, "outbox"),
    outboxState:
      text(row.outbox_state, "outbox state") === "DELIVERED" &&
      text(row.outbox_kind, "outbox kind") === "DISPATCH" &&
      text(row.dispatch_state, "dispatch state") === "ACKNOWLEDGED" &&
      text(row.claim_state, "claim state") === "CLAIMED"
        ? "ACKNOWLEDGED"
        : "STALE",
    callbackReceiptId: text(row.callback_receipt_id, "callback"),
    callbackPayloadHash: text(row.callback_payload_hash, "callback payload hash") as Sha256Digest,
    callbackState:
      text(row.callback_kind, "callback kind") === "fixture_image_result" ? "RECEIVED" : "STALE",
    reservedCostMicroUsd: integer(row.reserved_cost_micro_usd, "reserved cost"),
    accepted: row.acceptance_payload === null ? null : accepted(row.acceptance_payload),
  });
}

async function lockAuthority(
  executor: SqlExecutor,
  scope: ImageAcceptanceScope,
  authority: ImageExecutionAuthority,
): Promise<void> {
  for (const [table, clause, values] of [
    [
      "project_revisions",
      "workspace_id = $1 AND id = $2",
      [scope.workspaceId, authority.revisionId],
    ],
    [
      "revision_timing_heads",
      "workspace_id = $1 AND project_revision_id = $2",
      [scope.workspaceId, authority.revisionId],
    ],
    ["generation_tasks", "workspace_id = $1 AND id = $2", [scope.workspaceId, authority.taskId]],
    [
      "attempts",
      "workspace_id = $1 AND task_id = $2 AND id = $3",
      [scope.workspaceId, authority.taskId, authority.attemptId],
    ],
    ["outbox", "workspace_id = $1 AND id = $2", [scope.workspaceId, authority.outboxId]],
    [
      "callback_receipts",
      "workspace_id = $1 AND id = $2",
      [scope.workspaceId, authority.callbackReceiptId],
    ],
  ] as const)
    await executor.query(`SELECT 1 FROM public.${table} WHERE ${clause} FOR UPDATE`, values);
}

export class PGliteFixtureImageAcceptanceStore implements ImageAcceptanceStore {
  public constructor(private readonly database: TransactionalSqlExecutor) {}
  public resolve(
    scope: ImageAcceptanceScope,
    command: ImageAcceptanceCommand,
  ): Promise<ImageExecutionAuthority | null> {
    return loadAuthority(this.database, scope, command);
  }
  public async accept(
    scope: ImageAcceptanceScope,
    authority: ImageExecutionAuthority,
    acceptance: AcceptedFixtureImage,
  ): Promise<{ readonly accepted: AcceptedFixtureImage; readonly replayed: boolean }> {
    try {
      return await this.database.transaction(async (transaction) => {
        await lockAuthority(transaction, scope, authority);
        const command: ImageAcceptanceCommand = {
          projectId: authority.projectId,
          revisionId: authority.revisionId,
          timelineId: authority.timelineId,
          promptExecutionId: authority.promptExecutionId,
          promptSceneResultId: authority.promptSceneResultId,
          taskId: authority.taskId,
          attemptId: authority.attemptId,
          outboxId: authority.outboxId,
          callbackReceiptId: authority.callbackReceiptId,
          presentedClaimTokenHash: authority.claimTokenHash,
        };
        const current = await loadAuthority(transaction, scope, command);
        if (current === null)
          throw new ImageAcceptanceError("REPOSITORY_FAILURE", "Image authority disappeared.");
        if (current.accepted !== null) {
          if (current.accepted.acceptanceFingerprintHash !== acceptance.acceptanceFingerprintHash)
            throw new ImageAcceptanceError(
              "HASH_MISMATCH",
              "Image replay conflicts with accepted bytes.",
            );
          return Object.freeze({ accepted: current.accepted, replayed: true });
        }
        if (!same(current, authority))
          throw new ImageAcceptanceError(
            "DURABLE_STATE_INVALID",
            "Image authority changed before acceptance.",
          );
        const result = acceptance.result;
        const acceptanceId = deterministicUuid(`image-acceptance:${current.attemptId}`);
        const assetId = deterministicUuid(`image-output:${current.attemptId}`);
        const qaId = deterministicUuid(`image-technical-qa:${current.attemptId}`);
        const reservation = await transaction.query<Row>(
          `SELECT id FROM public.cost_events WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3 AND event_type = 'RESERVED'`,
          [scope.workspaceId, current.taskId, current.attemptId],
        );
        if (reservation.rows.length !== 1)
          throw new ImageAcceptanceError("COST_MISMATCH", "Image reservation is not exact.");
        const reservationId = text(reservation.rows[0]!.id, "reservation");
        await transaction.query(
          `INSERT INTO public.assets (id, workspace_id, project_id, project_revision_id, source_attempt_id,
             kind, state, object_key, binary_sha256, content_type, byte_size, width_px, height_px,
             metadata, verified_at)
           VALUES ($1, $2, $3, $4, $5, 'IMAGE', 'ACCEPTED', $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
          [
            assetId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            current.attemptId,
            result.media.objectKey,
            result.media.binarySha256,
            result.media.contentType,
            result.media.byteSize,
            result.media.widthPx,
            result.media.heightPx,
            JSON.stringify({
              fixture_non_production: true,
              scene_id: result.sceneId,
              layout: result.layout,
              result_hash: result.resultHash,
              prompt_scene_result_id: result.promptSceneResultId,
            }),
            acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `INSERT INTO public.qa_results (id, workspace_id, project_revision_id, attempt_id, asset_id,
             qa_kind, state, notes, created_at, decided_at)
           VALUES ($1, $2, $3, $4, $5, 'TECHNICAL', 'PASSED', $6, $7, $7)`,
          [
            qaId,
            scope.workspaceId,
            current.revisionId,
            current.attemptId,
            assetId,
            "Deterministic fixture PNG structure, checksum, dimensions, and aspect ratio passed.",
            acceptance.acceptedAt,
          ],
        );
        const sequence = await transaction.query<Row>(
          `SELECT COALESCE(max(sequence), 0)::int AS value FROM public.cost_events
            WHERE workspace_id = $1 AND owner_type = 'PROJECT_REVISION' AND owner_id = $2`,
          [scope.workspaceId, current.revisionId],
        );
        const firstSequence = integer(sequence.rows[0]!.value, "cost sequence") + 1;
        for (const [offset, eventType] of ["REPORTED", "SETTLED"].entries())
          await transaction.query(
            `INSERT INTO public.cost_events (id, workspace_id, owner_type, owner_id, task_id, attempt_id,
             sequence, event_type, amount_micro_usd, idempotency_key, details, occurred_at)
           VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
            [
              deterministicUuid(`image-cost:${eventType}:${current.attemptId}`),
              scope.workspaceId,
              current.revisionId,
              current.taskId,
              current.attemptId,
              firstSequence + offset,
              eventType,
              result.reportedCostMicroUsd,
              `image:${current.attemptId}:${eventType.toLowerCase()}`,
              JSON.stringify({
                source: "fixture-image-acceptance",
                result_hash: result.resultHash,
              }),
              acceptance.acceptedAt,
            ],
          );
        await transaction.query(
          `INSERT INTO public.image_generation_acceptances (
             id, workspace_id, project_id, project_revision_id, timeline_plan_id, image_style_id,
             image_style_version_id, style_profile_artifact_id, prompt_execution_id,
             prompt_scene_result_id, task_id, attempt_id, outbox_id, callback_receipt_id,
             reservation_cost_event_id, output_asset_id, qa_result_id, schema_version, input_hash,
             result_hash, acceptance_fingerprint_hash, timeline_hash, style_profile_hash,
             positive_prompt_hash, negative_prompt_hash, binary_sha256, reserved_cost_micro_usd,
             reported_cost_micro_usd, technical_validation, acceptance_payload, accepted_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30::jsonb,$31)`,
          [
            acceptanceId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            current.timelineId,
            current.imageStyleId,
            current.imageStyleVersionId,
            current.styleProfileArtifactId,
            current.promptExecutionId,
            current.promptSceneResultId,
            current.taskId,
            current.attemptId,
            current.outboxId,
            current.callbackReceiptId,
            reservationId,
            assetId,
            qaId,
            acceptance.schemaVersion,
            result.inputHash,
            result.resultHash,
            acceptance.acceptanceFingerprintHash,
            current.timelineHash,
            current.styleProfileHash,
            result.positivePromptHash,
            result.negativePromptHash,
            result.media.binarySha256,
            current.reservedCostMicroUsd,
            result.reportedCostMicroUsd,
            JSON.stringify(result.technicalValidation),
            JSON.stringify(acceptance),
            acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `UPDATE public.attempts SET state = 'SUCCEEDED', output_asset_id = $4,
             result_disposition = 'ACCEPTED', provider_details = $5::jsonb, finished_at = $6
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            current.taskId,
            current.attemptId,
            assetId,
            JSON.stringify({
              operation: "fixture.image.generate",
              result_hash: result.resultHash,
              callback_receipt_id: current.callbackReceiptId,
              fixture_non_production: true,
            }),
            acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `UPDATE public.generation_tasks SET state = 'COMPLETE', accepted_attempt_id = $3,
             version = version + 1, finished_at = $4, updated_at = $4
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, current.taskId, current.attemptId, acceptance.acceptedAt],
        );
        return Object.freeze({ accepted: acceptance, replayed: false });
      });
    } catch (error) {
      if (error instanceof ImageAcceptanceError) throw error;
      throw new ImageAcceptanceError("REPOSITORY_FAILURE", "Image acceptance transaction failed.");
    }
  }
}
