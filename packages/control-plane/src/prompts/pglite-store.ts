import { createHash } from "node:crypto";

import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import { verifyCompiledImagePrompt, type PromptSceneInput } from "@videoforge/pipeline";

import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import { PromptExecutionError, promptExecutionInputHash } from "./service.js";
import type {
  AcceptedPromptExecution,
  AcceptPromptExecutionCommand,
  PromptExecutionAuthority,
  PromptExecutionCommand,
  PromptExecutionScope,
  PromptExecutionStore,
} from "./types.js";
import { DURABLE_PROMPT_EXECUTION_VERSION } from "./types.js";

type Row = Record<string, unknown>;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function text(value: unknown, column: string): string {
  if (typeof value !== "string") throw new TypeError(`${column} must be text`);
  return value;
}

function integer(value: unknown, column: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint"
        ? Number(value)
        : typeof value === "string" && /^-?[0-9]+$/u.test(value)
          ? Number(value)
          : Number.NaN;
  if (!Number.isSafeInteger(parsed)) throw new TypeError(`${column} must be a safe integer`);
  return parsed;
}

function timestamp(value: unknown, column: string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = text(value, column);
  if (Number.isNaN(Date.parse(parsed))) throw new TypeError(`${column} must be a timestamp`);
  return new Date(parsed).toISOString();
}

function object(value: unknown, column: string): Record<string, unknown> {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${column} must be an object`);
  }
  return parsed as Record<string, unknown>;
}

function stringArray(value: unknown, column: string): readonly string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`${column} must be a string array`);
  }
  return Object.freeze([...parsed]);
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function deterministicUuid(label: string): string {
  const bytes = createHash("sha256").update(label, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function promptProfile(value: unknown): {
  readonly plannerGuidance: string;
  readonly positiveSuffix: string;
  readonly negativeSuffix: string;
  readonly fullImageGuidance: string;
  readonly splitImageGuidance: string;
} {
  const profile = object(value, "image_style_versions.profile_payload");
  const prompt = object(profile.prompt_profile, "image style prompt_profile");
  return Object.freeze({
    plannerGuidance: text(prompt.planner_guidance, "prompt_profile.planner_guidance"),
    positiveSuffix: text(prompt.positive_suffix, "prompt_profile.positive_suffix"),
    negativeSuffix: text(prompt.negative_suffix, "prompt_profile.negative_suffix"),
    fullImageGuidance: text(prompt.full_image_guidance, "prompt_profile.full_image_guidance"),
    splitImageGuidance: text(prompt.split_image_guidance, "prompt_profile.split_image_guidance"),
  });
}

function continuityTags(value: unknown): readonly string[] {
  const payload = object(value, "outbox.payload");
  return payload.continuity_tags === undefined
    ? Object.freeze([])
    : stringArray(payload.continuity_tags, "outbox.payload.continuity_tags");
}

function taskState(value: string): PromptExecutionAuthority["taskState"] | null {
  if (value === "RUNNING") return "RUNNING";
  if (value === "COMPLETE") return "SUCCEEDED";
  if (value === "CANCEL_REQUESTED" || value === "CANCELLED") return "CANCELLED";
  return null;
}

function attemptState(value: string): PromptExecutionAuthority["attemptState"] | null {
  if (value === "CLAIMED" || value === "RUNNING") return "CLAIMED";
  if (value === "SUCCEEDED") return "SUCCEEDED";
  if (value === "CANCELLED") return "CANCELLED";
  return null;
}

function acceptedFromRow(value: unknown): AcceptedPromptExecution {
  const candidate = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new TypeError("prompt_executions.acceptance_payload must be an object");
  }
  return candidate as AcceptedPromptExecution;
}

async function loadAuthority(
  executor: SqlExecutor,
  scope: PromptExecutionScope,
  command: PromptExecutionCommand,
): Promise<PromptExecutionAuthority | null> {
  const result = await executor.query<Row>(
    `SELECT revision.workspace_id, revision.project_id, revision.id AS revision_id,
            revision.title, revision.status AS revision_status,
            revision.image_style_id, revision.image_style_version_id,
            revision.style_profile_hash AS revision_style_profile_hash,
            revision.extra_prompt_keywords, revision.apply_extra_prompt_keywords,
            head.current_timeline_plan_id, plan.canonical_document_hash AS timeline_hash,
            style.state AS style_state, style.style_profile_hash, style.profile_payload,
            task.id AS task_id, task.state AS task_state, task.lane, task.owner_type,
            task.owner_id, attempt.id AS attempt_id, attempt.ordinal,
            attempt.state AS attempt_state, attempt.claim_state,
            attempt.dispatch_state, attempt.execution_claim_token_hash, attempt.input_hash,
            dispatch.id AS outbox_id, dispatch.kind AS outbox_kind,
            dispatch.state AS outbox_state, dispatch.payload AS outbox_payload,
            reservation.id AS reservation_cost_event_id,
            reservation.amount_micro_usd AS reserved_cost_micro_usd,
            accepted.acceptance_payload
       FROM public.memberships membership
       JOIN public.project_revisions revision
         ON revision.workspace_id = membership.workspace_id AND revision.id = $3
       JOIN public.projects project
         ON project.workspace_id = revision.workspace_id AND project.id = revision.project_id
       JOIN public.revision_timing_heads head
         ON head.workspace_id = revision.workspace_id
        AND head.project_revision_id = revision.id
       JOIN public.timeline_plans plan
         ON plan.workspace_id = head.workspace_id
        AND plan.project_revision_id = head.project_revision_id
        AND plan.id = head.current_timeline_plan_id
       JOIN public.image_style_versions style
         ON style.workspace_id = revision.workspace_id
        AND style.style_id = revision.image_style_id
        AND style.id = revision.image_style_version_id
       JOIN public.generation_tasks task
         ON task.workspace_id = revision.workspace_id AND task.id = $5
       JOIN public.attempts attempt
         ON attempt.workspace_id = task.workspace_id
        AND attempt.task_id = task.id AND attempt.id = $6
       JOIN public.outbox dispatch
         ON dispatch.workspace_id = attempt.workspace_id
        AND dispatch.task_id = attempt.task_id
        AND dispatch.attempt_id = attempt.id AND dispatch.id = $7
       JOIN public.cost_events reservation
         ON reservation.workspace_id = attempt.workspace_id
        AND reservation.task_id = attempt.task_id
        AND reservation.attempt_id = attempt.id
        AND reservation.event_type = 'RESERVED'
       LEFT JOIN public.prompt_executions accepted
         ON accepted.workspace_id = attempt.workspace_id AND accepted.attempt_id = attempt.id
      WHERE membership.workspace_id = $1 AND membership.user_id = $2
        AND membership.status = 'ACTIVE'
        AND revision.project_id = $4
        AND head.current_timeline_plan_id = $8
      ORDER BY reservation.sequence`,
    [
      scope.workspaceId,
      scope.actorUserId,
      command.revisionId,
      command.projectId,
      command.taskId,
      command.attemptId,
      command.outboxId,
      command.timelineId,
    ],
  );
  if (result.rows.length !== 1) return null;
  const row = result.rows[0]!;
  const mappedTaskState = taskState(text(row.task_state, "generation_tasks.state"));
  const mappedAttemptState = attemptState(text(row.attempt_state, "attempts.state"));
  if (mappedTaskState === null || mappedAttemptState === null) return null;
  if (
    text(row.lane, "generation_tasks.lane") !== "PROMPT" ||
    text(row.owner_type, "generation_tasks.owner_type") !== "PROJECT_REVISION" ||
    text(row.owner_id, "generation_tasks.owner_id") !== command.revisionId ||
    text(row.outbox_kind, "outbox.kind") !== "DISPATCH"
  ) {
    return null;
  }

  const segmentResult = await executor.query<Row>(
    `SELECT segment_key, segment_index, timeline_composition, in_image_shot_role, narration
       FROM public.timeline_segments
      WHERE workspace_id = $1 AND project_revision_id = $2 AND timeline_plan_id = $3
      ORDER BY segment_index`,
    [scope.workspaceId, command.revisionId, command.timelineId],
  );
  const allSegments = segmentResult.rows;
  const scenes: PromptSceneInput[] = [];
  for (const [index, segment] of allSegments.entries()) {
    const composition = text(segment.timeline_composition, "timeline_segments composition");
    if (composition === "AVATAR_FULL") continue;
    const role = text(segment.in_image_shot_role, "timeline_segments in_image_shot_role");
    if (
      ![
        "ENVIRONMENTAL_WIDE",
        "HUMAN_MEDIUM",
        "HANDS_ACTION",
        "OBJECT_EVIDENCE",
        "MACRO_DETAIL",
        "REACTION_RESULT",
      ].includes(role)
    ) {
      throw new TypeError("timeline segment has an invalid image shot role");
    }
    scenes.push(
      Object.freeze({
        sceneId: text(segment.segment_key, "timeline_segments.segment_key"),
        phrase: text(segment.narration, "timeline_segments.narration"),
        sentenceContext: text(segment.narration, "timeline_segments.narration"),
        priorContext:
          index === 0 ? null : text(allSegments[index - 1]!.narration, "prior narration"),
        nextContext:
          index + 1 === allSegments.length
            ? null
            : text(allSegments[index + 1]!.narration, "next narration"),
        inImageShotRole: role as PromptSceneInput["inImageShotRole"],
        layout: composition === "IMAGE_FULL" ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
      }),
    );
  }
  const profile = promptProfile(row.profile_payload);
  const accepted = row.acceptance_payload === null ? null : acceptedFromRow(row.acceptance_payload);
  const authority: PromptExecutionAuthority = Object.freeze({
    workspaceId: text(row.workspace_id, "workspace_id"),
    projectId: text(row.project_id, "project_id"),
    revisionId: text(row.revision_id, "revision_id"),
    projectTitle: text(row.title, "project_revisions.title"),
    revisionState:
      text(row.revision_status, "project_revisions.status") === "LOCKED" ? "GENERATING" : "STALE",
    timelineId: text(row.current_timeline_plan_id, "current_timeline_plan_id"),
    timelineHash: text(row.timeline_hash, "timeline_hash") as Sha256Digest,
    timelineState: "CURRENT",
    imageStyleVersionId: text(row.image_style_version_id, "image_style_version_id"),
    styleProfileHash: text(row.style_profile_hash, "style_profile_hash") as Sha256Digest,
    styleState:
      text(row.style_state, "image_style_versions.state") === "PUBLISHED" &&
      text(row.revision_style_profile_hash, "revision style hash") ===
        text(row.style_profile_hash, "style profile hash")
        ? "PUBLISHED"
        : "STALE",
    plannerGuidance: profile.plannerGuidance,
    storyContext: JSON.stringify({
      summary: "Fixture story context derived from the ordered transcript.",
    }),
    style: Object.freeze({
      positiveSuffix: profile.positiveSuffix,
      negativeSuffix: profile.negativeSuffix,
      fullImageGuidance: profile.fullImageGuidance,
      splitImageGuidance: profile.splitImageGuidance,
    }),
    extraPromptKeywords:
      row.extra_prompt_keywords === null ? null : text(row.extra_prompt_keywords, "extra keywords"),
    applyExtraPromptKeywords: row.apply_extra_prompt_keywords === true,
    continuityTags: continuityTags(row.outbox_payload),
    scenes: Object.freeze(scenes),
    taskId: text(row.task_id, "task_id"),
    taskState: mappedTaskState,
    attemptId: text(row.attempt_id, "attempt_id"),
    attemptOrdinal: integer(row.ordinal, "attempts.ordinal"),
    attemptState: mappedAttemptState,
    claimTokenHash: text(row.execution_claim_token_hash, "claim hash") as Sha256Digest,
    recordedInputHash: text(row.input_hash, "attempts.input_hash") as Sha256Digest,
    outboxId: text(row.outbox_id, "outbox_id"),
    outboxState:
      text(row.outbox_state, "outbox.state") === "DELIVERED" &&
      text(row.dispatch_state, "attempts.dispatch_state") === "ACKNOWLEDGED" &&
      text(row.claim_state, "attempts.claim_state") === "CLAIMED"
        ? "ACKNOWLEDGED"
        : "STALE",
    reservedCostMicroUsd: integer(row.reserved_cost_micro_usd, "reserved cost"),
    accepted,
  });
  return authority;
}

function validateAcceptance(
  authority: PromptExecutionAuthority,
  acceptance: AcceptedPromptExecution,
): void {
  const { acceptanceFingerprintHash, ...base } = acceptance;
  if (
    acceptance.schemaVersion !== DURABLE_PROMPT_EXECUTION_VERSION ||
    !SHA256.test(acceptanceFingerprintHash) ||
    sha256(canonicalizeJson(base)) !== acceptanceFingerprintHash ||
    acceptance.workspaceId !== authority.workspaceId ||
    acceptance.projectId !== authority.projectId ||
    acceptance.revisionId !== authority.revisionId ||
    acceptance.timelineId !== authority.timelineId ||
    acceptance.timelineHash !== authority.timelineHash ||
    acceptance.imageStyleVersionId !== authority.imageStyleVersionId ||
    acceptance.styleProfileHash !== authority.styleProfileHash ||
    acceptance.taskId !== authority.taskId ||
    acceptance.attemptId !== authority.attemptId ||
    acceptance.attemptOrdinal !== authority.attemptOrdinal ||
    acceptance.outboxId !== authority.outboxId ||
    acceptance.inputHash !== authority.recordedInputHash ||
    acceptance.inputHash !== promptExecutionInputHash(authority) ||
    acceptance.requestHash !== acceptance.writerAttempts[0]?.requestHash ||
    acceptance.responseHash !== sha256(canonicalizeJson(acceptance.writerOutput)) ||
    acceptance.compiledOutputHash !== sha256(canonicalizeJson(acceptance.compiledPrompts)) ||
    acceptance.writerOutput.scenes.length !== authority.scenes.length ||
    acceptance.compiledPrompts.length !== authority.scenes.length
  ) {
    throw new PromptExecutionError("HASH_MISMATCH", "Prompt acceptance bytes or lineage drifted.");
  }
  const totalCost = acceptance.writerAttempts.reduce(
    (total, attempt) => total + attempt.reportedCostMicroUsd,
    0,
  );
  if (
    !Number.isSafeInteger(totalCost) ||
    totalCost !== acceptance.reportedCostMicroUsd ||
    totalCost > authority.reservedCostMicroUsd
  ) {
    throw new PromptExecutionError("COST_MISMATCH", "Prompt acceptance cost drifted.");
  }
  for (const [index, compiled] of acceptance.compiledPrompts.entries()) {
    verifyCompiledImagePrompt(compiled);
    if (
      compiled.sceneId !== authority.scenes[index]?.sceneId ||
      acceptance.writerOutput.scenes[index]?.scene_id !== compiled.sceneId
    ) {
      throw new PromptExecutionError("OUTPUT_INVALID", "Prompt scene ordering drifted.");
    }
  }
  timestamp(acceptance.acceptedAt, "acceptedAt");
}

async function lockAuthority(
  executor: SqlExecutor,
  scope: PromptExecutionScope,
  command: PromptExecutionCommand,
): Promise<void> {
  await executor.query(
    `SELECT id FROM public.project_revisions
      WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [scope.workspaceId, command.revisionId],
  );
  await executor.query(
    `SELECT project_revision_id FROM public.revision_timing_heads
      WHERE workspace_id = $1 AND project_revision_id = $2 FOR UPDATE`,
    [scope.workspaceId, command.revisionId],
  );
  await executor.query(
    `SELECT id FROM public.generation_tasks
      WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
    [scope.workspaceId, command.taskId],
  );
  await executor.query(
    `SELECT id FROM public.attempts
      WHERE workspace_id = $1 AND task_id = $2 AND id = $3 FOR UPDATE`,
    [scope.workspaceId, command.taskId, command.attemptId],
  );
  await executor.query(
    `SELECT id FROM public.outbox
      WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3 AND id = $4 FOR UPDATE`,
    [scope.workspaceId, command.taskId, command.attemptId, command.outboxId],
  );
}

function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export class PGlitePromptExecutionStore implements PromptExecutionStore {
  public constructor(private readonly database: TransactionalSqlExecutor) {}

  public resolve(
    scope: PromptExecutionScope,
    command: PromptExecutionCommand,
  ): Promise<PromptExecutionAuthority | null> {
    return loadAuthority(this.database, scope, command);
  }

  public async accept(
    scope: PromptExecutionScope,
    request: AcceptPromptExecutionCommand,
  ): Promise<{ readonly accepted: AcceptedPromptExecution; readonly replayed: boolean }> {
    try {
      return await this.database.transaction(async (transaction) => {
        const command: PromptExecutionCommand = {
          projectId: request.authority.projectId,
          revisionId: request.authority.revisionId,
          timelineId: request.authority.timelineId,
          taskId: request.authority.taskId,
          attemptId: request.authority.attemptId,
          outboxId: request.authority.outboxId,
          presentedClaimTokenHash: request.authority.claimTokenHash,
        };
        await lockAuthority(transaction, scope, command);
        const current = await loadAuthority(transaction, scope, command);
        if (current === null) {
          throw new PromptExecutionError("REPOSITORY_FAILURE", "Prompt authority disappeared.");
        }
        if (current.accepted !== null) {
          if (
            current.accepted.acceptanceFingerprintHash !==
            request.acceptance.acceptanceFingerprintHash
          ) {
            throw new PromptExecutionError(
              "HASH_MISMATCH",
              "Prompt replay conflicts with accepted bytes.",
            );
          }
          return Object.freeze({ accepted: current.accepted, replayed: true });
        }
        if (!same(current, request.authority)) {
          throw new PromptExecutionError(
            "DURABLE_STATE_INVALID",
            "Prompt authority changed before acceptance.",
          );
        }
        validateAcceptance(current, request.acceptance);

        const executionId = deterministicUuid(`prompt-execution:${current.attemptId}`);
        const outputAssetId = deterministicUuid(`prompt-output:${current.attemptId}`);
        const acceptanceBytes = canonicalizeJson(request.acceptance);
        const reservation = await transaction.query<Row>(
          `SELECT id FROM public.cost_events
          WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3
            AND event_type = 'RESERVED'`,
          [scope.workspaceId, current.taskId, current.attemptId],
        );
        if (reservation.rows.length !== 1) {
          throw new PromptExecutionError("COST_MISMATCH", "Prompt reservation is not exact.");
        }
        const reservationCostEventId = text(reservation.rows[0]!.id, "reservation cost event");

        await transaction.query(
          `INSERT INTO public.assets (
           id, workspace_id, project_id, project_revision_id, kind, state,
           canonical_contract_name, canonical_contract_version,
           canonical_document_sha256, content_type, byte_size, metadata, verified_at
         ) VALUES ($1, $2, $3, $4, 'CANONICAL_DOCUMENT', 'ACCEPTED',
                   'durable-prompt-execution', 'v1', $5, 'application/json', $6,
                   $7::jsonb, $8)`,
          [
            outputAssetId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            request.acceptance.acceptanceFingerprintHash,
            Buffer.byteLength(acceptanceBytes, "utf8"),
            json({ source: "prompt-execution", embedded_table: "prompt_executions" }),
            request.acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `INSERT INTO public.prompt_executions (
           id, workspace_id, project_id, project_revision_id, timeline_plan_id,
           image_style_id, image_style_version_id, task_id, attempt_id, outbox_id,
           reservation_cost_event_id, output_asset_id, schema_version, input_hash,
           request_hash, response_hash, compiled_output_hash, acceptance_fingerprint_hash,
           timeline_hash, style_profile_hash, reserved_cost_micro_usd,
           reported_cost_micro_usd, acceptance_payload, accepted_at
         ) SELECT $1, $2, $3, $4, $5, revision.image_style_id, $6, $7, $8, $9,
                  $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21,
                  $22::jsonb, $23
             FROM public.project_revisions revision
            WHERE revision.workspace_id = $2 AND revision.id = $4`,
          [
            executionId,
            scope.workspaceId,
            current.projectId,
            current.revisionId,
            current.timelineId,
            current.imageStyleVersionId,
            current.taskId,
            current.attemptId,
            current.outboxId,
            reservationCostEventId,
            outputAssetId,
            request.acceptance.schemaVersion,
            request.acceptance.inputHash,
            request.acceptance.requestHash,
            request.acceptance.responseHash,
            request.acceptance.compiledOutputHash,
            request.acceptance.acceptanceFingerprintHash,
            request.acceptance.timelineHash,
            request.acceptance.styleProfileHash,
            current.reservedCostMicroUsd,
            request.acceptance.reportedCostMicroUsd,
            json(request.acceptance),
            request.acceptance.acceptedAt,
          ],
        );
        for (const attempt of request.acceptance.writerAttempts) {
          await transaction.query(
            `INSERT INTO public.prompt_writer_attempts (
             id, workspace_id, prompt_execution_id, execution_attempt_id, attempt_index,
             requested_scene_ids, request_bytes, request_hash, response_bytes, response_hash,
             retry_of_request_hash, accepted_scene_ids, unresolved_scene_ids,
             input_tokens, output_tokens, reported_cost_micro_usd
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11,
                     $12::jsonb, $13::jsonb, $14, $15, $16)`,
            [
              deterministicUuid(
                `prompt-writer-attempt:${current.attemptId}:${attempt.attemptIndex}`,
              ),
              scope.workspaceId,
              executionId,
              current.attemptId,
              attempt.attemptIndex,
              json(attempt.requestedSceneIds),
              attempt.requestBytes,
              attempt.requestHash,
              attempt.responseBytes,
              attempt.responseHash,
              attempt.retryOfRequestHash,
              json(attempt.acceptedSceneIds),
              json(attempt.unresolvedSceneIds),
              attempt.inputTokens,
              attempt.outputTokens,
              attempt.reportedCostMicroUsd,
            ],
          );
        }
        for (const [index, compiled] of request.acceptance.compiledPrompts.entries()) {
          await transaction.query(
            `INSERT INTO public.prompt_scene_results (
             id, workspace_id, prompt_execution_id, execution_attempt_id, scene_ordinal,
             scene_id, writer_output, compiled_prompt, positive_prompt_hash, negative_prompt_hash
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
            [
              deterministicUuid(`prompt-scene:${current.attemptId}:${compiled.sceneId}`),
              scope.workspaceId,
              executionId,
              current.attemptId,
              index,
              compiled.sceneId,
              json(request.acceptance.writerOutput.scenes[index]),
              json(compiled),
              compiled.positivePromptSha256,
              compiled.negativePromptSha256,
            ],
          );
        }

        const sequence = await transaction.query<Row>(
          `SELECT COALESCE(max(sequence), 0)::int AS value FROM public.cost_events
          WHERE workspace_id = $1 AND owner_type = 'PROJECT_REVISION' AND owner_id = $2`,
          [scope.workspaceId, current.revisionId],
        );
        const firstSequence = integer(sequence.rows[0]!.value, "cost event sequence") + 1;
        for (const [offset, eventType] of ["REPORTED", "SETTLED"].entries()) {
          await transaction.query(
            `INSERT INTO public.cost_events (
             id, workspace_id, owner_type, owner_id, task_id, attempt_id, sequence,
             event_type, amount_micro_usd, idempotency_key, details, occurred_at
           ) VALUES ($1, $2, 'PROJECT_REVISION', $3, $4, $5, $6, $7, $8, $9,
                     $10::jsonb, $11)`,
            [
              deterministicUuid(`prompt-cost:${eventType}:${current.attemptId}`),
              scope.workspaceId,
              current.revisionId,
              current.taskId,
              current.attemptId,
              firstSequence + offset,
              eventType,
              request.acceptance.reportedCostMicroUsd,
              `prompt:${current.attemptId}:${eventType.toLowerCase()}`,
              json({
                source: "prompt-execution",
                acceptance_fingerprint_hash: request.acceptance.acceptanceFingerprintHash,
              }),
              request.acceptance.acceptedAt,
            ],
          );
        }
        await transaction.query(
          `UPDATE public.attempts
            SET state = 'SUCCEEDED', output_asset_id = $4, result_disposition = 'ACCEPTED',
                provider_details = $5::jsonb, finished_at = $6
          WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            current.taskId,
            current.attemptId,
            outputAssetId,
            json({
              source: "prompt-execution",
              operation: "fixture-or-injected",
              request_hash: request.acceptance.requestHash,
              response_hash: request.acceptance.responseHash,
              compiled_output_hash: request.acceptance.compiledOutputHash,
            }),
            request.acceptance.acceptedAt,
          ],
        );
        await transaction.query(
          `UPDATE public.generation_tasks
            SET state = 'COMPLETE', accepted_attempt_id = $3, version = version + 1,
                finished_at = $4, updated_at = $4
          WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, current.taskId, current.attemptId, request.acceptance.acceptedAt],
        );
        return Object.freeze({ accepted: request.acceptance, replayed: false });
      });
    } catch (error) {
      if (error instanceof PromptExecutionError) throw error;
      throw new PromptExecutionError(
        "REPOSITORY_FAILURE",
        "Prompt persistence transaction failed.",
      );
    }
  }
}
