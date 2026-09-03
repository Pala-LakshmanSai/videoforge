import { canonicalizeJson, type Sha256Digest } from "@videoforge/contracts";
import {
  buildPromptBatch,
  compileImagePrompt,
  validatePromptWriterOutput,
  verifyCompiledImagePrompt,
  type PromptBatch,
} from "@videoforge/pipeline/prompts";

import type { TelemetryEvent, TelemetryPort } from "../telemetry/telemetry.js";
import { hashCanonical, hashUtf8 } from "./hashes.js";
import type {
  AcceptedPromptExecution,
  DurablePromptWriterPort,
  PromptExecutionAuthority,
  PromptExecutionClock,
  PromptExecutionCommand,
  PromptExecutionScope,
  PromptExecutionStore,
  PromptWriterAttemptFact,
} from "./types.js";
import { DURABLE_PROMPT_EXECUTION_VERSION } from "./types.js";

export type PromptExecutionErrorCode =
  | "CANCELLED"
  | "CLAIM_STALE"
  | "COST_MISMATCH"
  | "DURABLE_STATE_INVALID"
  | "HASH_MISMATCH"
  | "OUTPUT_INVALID"
  | "REPOSITORY_FAILURE"
  | "WORKSPACE_MISMATCH";

export class PromptExecutionError extends Error {
  public constructor(
    public readonly code: PromptExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PromptExecutionError";
  }
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

const fail = (code: PromptExecutionErrorCode, message: string): never => {
  throw new PromptExecutionError(code, message);
};

const exactCommand = (input: PromptExecutionCommand): PromptExecutionCommand => {
  const keys = Object.keys(input).sort();
  const expected = [
    "attemptId",
    "outboxId",
    "presentedClaimTokenHash",
    "projectId",
    "revisionId",
    "taskId",
    "timelineId",
  ].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index]))
    return fail("DURABLE_STATE_INVALID", "Prompt execution command shape is invalid.");
  for (const value of [
    input.projectId,
    input.revisionId,
    input.timelineId,
    input.taskId,
    input.attemptId,
    input.outboxId,
  ])
    if (!TOKEN.test(value)) return fail("DURABLE_STATE_INVALID", "Prompt execution ID is invalid.");
  if (!SHA256.test(input.presentedClaimTokenHash))
    return fail("CLAIM_STALE", "Prompt execution claim token is invalid.");
  return Object.freeze({ ...input });
};

const inputDocument = (authority: PromptExecutionAuthority): unknown => ({
  schema_version: DURABLE_PROMPT_EXECUTION_VERSION,
  workspace_id: authority.workspaceId,
  project_id: authority.projectId,
  revision_id: authority.revisionId,
  project_title: authority.projectTitle,
  timeline_id: authority.timelineId,
  timeline_hash: authority.timelineHash,
  image_style_version_id: authority.imageStyleVersionId,
  style_profile_hash: authority.styleProfileHash,
  style_treatment: authority.styleTreatment,
  planner_guidance: authority.plannerGuidance,
  story_context: authority.storyContext,
  style: authority.style,
  extra_prompt_keywords: authority.extraPromptKeywords,
  apply_extra_prompt_keywords: authority.applyExtraPromptKeywords,
  continuity_tags: authority.continuityTags,
  scenes: authority.scenes,
  task_id: authority.taskId,
  attempt_id: authority.attemptId,
  attempt_ordinal: authority.attemptOrdinal,
  outbox_id: authority.outboxId,
});

export const promptExecutionInputHash = (authority: PromptExecutionAuthority): Sha256Digest =>
  hashCanonical(inputDocument(authority));

const assertAuthority = (
  scope: PromptExecutionScope,
  command: PromptExecutionCommand,
  authority: PromptExecutionAuthority,
): void => {
  if (authority.workspaceId !== scope.workspaceId)
    return fail("WORKSPACE_MISMATCH", "Prompt execution workspace does not match the actor scope.");
  if (
    authority.projectId !== command.projectId ||
    authority.revisionId !== command.revisionId ||
    authority.timelineId !== command.timelineId ||
    authority.taskId !== command.taskId ||
    authority.attemptId !== command.attemptId ||
    authority.outboxId !== command.outboxId
  )
    return fail("DURABLE_STATE_INVALID", "Prompt execution identity drifted.");
  if (authority.taskState === "CANCELLED" || authority.attemptState === "CANCELLED")
    return fail("CANCELLED", "Prompt execution was cancelled.");
  if (
    authority.revisionState !== "GENERATING" ||
    authority.timelineState !== "CURRENT" ||
    authority.styleState !== "PUBLISHED" ||
    authority.outboxState !== "ACKNOWLEDGED"
  )
    return fail("DURABLE_STATE_INVALID", "Prompt execution authority is stale or incomplete.");
  if (
    (authority.accepted === null &&
      (authority.taskState !== "RUNNING" || authority.attemptState !== "CLAIMED")) ||
    (authority.accepted !== null &&
      (authority.taskState !== "SUCCEEDED" || authority.attemptState !== "SUCCEEDED"))
  )
    return fail("DURABLE_STATE_INVALID", "Prompt execution state does not match its acceptance.");
  if (
    authority.claimTokenHash !== command.presentedClaimTokenHash ||
    authority.attemptOrdinal < 1 ||
    !Number.isSafeInteger(authority.attemptOrdinal)
  )
    return fail("CLAIM_STALE", "Prompt execution claim is stale.");
  if (!Number.isSafeInteger(authority.reservedCostMicroUsd) || authority.reservedCostMicroUsd < 0)
    return fail("COST_MISMATCH", "Prompt execution cost reservation is invalid.");
  if (promptExecutionInputHash(authority) !== authority.recordedInputHash)
    return fail("HASH_MISMATCH", "Prompt execution durable input hash drifted.");
};

const buildBatch = (authority: PromptExecutionAuthority): PromptBatch =>
  buildPromptBatch({
    batchId: `${authority.taskId}:batch:${authority.attemptOrdinal}`,
    projectTitle: authority.projectTitle,
    imageStyleVersionId: authority.imageStyleVersionId,
    styleProfileHash: authority.styleProfileHash,
    styleTreatment: authority.styleTreatment,
    plannerGuidance: authority.plannerGuidance,
    storyContext: authority.storyContext,
    continuityTags: authority.continuityTags,
    scenes: authority.scenes,
  });

const safeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const validateAttempts = (
  batch: PromptBatch,
  attempts: readonly PromptWriterAttemptFact[],
): number => {
  if (attempts.length < 1 || attempts.length > 2)
    return fail("OUTPUT_INVALID", "Prompt writer must use one attempt and at most one retry.");
  const expectedIds = batch.scenes.map((scene) => scene.sceneId);
  let priorRequestHash: Sha256Digest | null = null;
  let unresolved = expectedIds;
  let cost = 0;
  for (const [index, attempt] of attempts.entries()) {
    if (attempt.attemptIndex !== index + 1)
      return fail("OUTPUT_INVALID", "Prompt writer attempt order is invalid.");
    if (
      hashUtf8(attempt.requestBytes) !== attempt.requestHash ||
      hashUtf8(attempt.responseBytes) !== attempt.responseHash
    )
      return fail(
        "HASH_MISMATCH",
        "Prompt writer request or response bytes do not match its hash.",
      );
    if (attempt.retryOfRequestHash !== priorRequestHash)
      return fail("OUTPUT_INVALID", "Prompt writer retry lineage is invalid.");
    if (
      attempt.requestedSceneIds.length !== unresolved.length ||
      attempt.requestedSceneIds.some((sceneId, sceneIndex) => sceneId !== unresolved[sceneIndex])
    )
      return fail("OUTPUT_INVALID", "Prompt writer retried outside the unresolved scene set.");
    const requested = new Set(attempt.requestedSceneIds);
    const accepted = new Set(attempt.acceptedSceneIds);
    const nextUnresolved = attempt.unresolvedSceneIds;
    const unresolvedSet = new Set(nextUnresolved);
    const acceptedInRequestOrder = attempt.requestedSceneIds.filter((sceneId) =>
      accepted.has(sceneId),
    );
    const unresolvedInRequestOrder = attempt.requestedSceneIds.filter((sceneId) =>
      unresolvedSet.has(sceneId),
    );
    if (
      accepted.size !== attempt.acceptedSceneIds.length ||
      unresolvedSet.size !== nextUnresolved.length ||
      [...accepted, ...nextUnresolved].some((sceneId) => !requested.has(sceneId)) ||
      attempt.acceptedSceneIds.some(
        (sceneId, sceneIndex) => sceneId !== acceptedInRequestOrder[sceneIndex],
      ) ||
      nextUnresolved.some(
        (sceneId, sceneIndex) => sceneId !== unresolvedInRequestOrder[sceneIndex],
      ) ||
      attempt.acceptedSceneIds.some((sceneId) => unresolvedSet.has(sceneId)) ||
      attempt.requestedSceneIds.some(
        (sceneId) => !accepted.has(sceneId) && !unresolvedSet.has(sceneId),
      ) ||
      accepted.size + nextUnresolved.length !== requested.size ||
      !safeInteger(attempt.inputTokens) ||
      !safeInteger(attempt.outputTokens) ||
      !safeInteger(attempt.reportedCostMicroUsd)
    )
      return fail("OUTPUT_INVALID", "Prompt writer attempt facts are invalid.");
    cost += attempt.reportedCostMicroUsd;
    if (!Number.isSafeInteger(cost)) return fail("COST_MISMATCH", "Prompt writer cost overflowed.");
    unresolved = [...nextUnresolved];
    priorRequestHash = attempt.requestHash;
  }
  if (unresolved.length !== 0)
    return fail("OUTPUT_INVALID", "Prompt writer left unresolved scenes after its bounded retry.");
  return cost;
};

const assertStoredAcceptance = (
  authority: PromptExecutionAuthority,
  acceptance: AcceptedPromptExecution,
): void => {
  if (
    acceptance.schemaVersion !== DURABLE_PROMPT_EXECUTION_VERSION ||
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
    acceptance.requestHash !== acceptance.writerAttempts[0]?.requestHash ||
    hashCanonical(acceptance.writerOutput) !== acceptance.responseHash ||
    hashCanonical(acceptance.compiledPrompts) !== acceptance.compiledOutputHash
  )
    return fail("HASH_MISMATCH", "Stored prompt acceptance lineage or canonical bytes drifted.");
  const cost = validateAttempts(buildBatch(authority), acceptance.writerAttempts);
  if (cost !== acceptance.reportedCostMicroUsd || cost > authority.reservedCostMicroUsd)
    return fail("COST_MISMATCH", "Stored prompt acceptance cost does not reconcile.");
  for (const compiled of acceptance.compiledPrompts) verifyCompiledImagePrompt(compiled);
  const { acceptanceFingerprintHash, ...acceptanceBase } = acceptance;
  if (hashCanonical(acceptanceBase) !== acceptanceFingerprintHash)
    return fail("HASH_MISMATCH", "Stored prompt acceptance fingerprint drifted.");
};

function telemetryEvent(
  authority: PromptExecutionAuthority,
  operation: DurablePromptWriterPort["operation"],
  sequence: number,
  occurredAt: string,
  outcome: "STARTED" | "SUCCEEDED" | "FAILED" | "CANCELLED",
  cost: number | null,
  error: TelemetryEvent["error"],
): TelemetryEvent {
  return {
    schemaVersion: "telemetry-event/v1",
    streamId: `prompt:${authority.attemptId}`,
    sequence,
    eventName: `prompt.${outcome.toLowerCase()}`,
    occurredAt,
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
    stage: "prompt_execution",
    providerOperation: operation,
    retry: {
      attemptNumber: authority.attemptOrdinal,
      maximumAttempts: Math.max(authority.attemptOrdinal, 2),
      parentAttemptId: null,
    },
    queueWaitMs: null,
    durationMs: null,
    cost:
      cost === null
        ? {
            reservedMicroUsd: authority.reservedCostMicroUsd,
            reportedMicroUsd: null,
            settledMicroUsd: null,
          }
        : {
            reservedMicroUsd: authority.reservedCostMicroUsd,
            reportedMicroUsd: cost,
            settledMicroUsd: cost,
          },
    outcome,
    error,
  };
}

export class DurablePromptExecutionService {
  public constructor(
    private readonly store: PromptExecutionStore,
    private readonly writer: DurablePromptWriterPort,
    private readonly telemetry: TelemetryPort,
    private readonly clock: PromptExecutionClock,
  ) {}

  private async record(event: TelemetryEvent): Promise<void> {
    try {
      await this.telemetry.record(event);
    } catch {
      // Telemetry is deliberately non-authoritative and cannot change durable execution.
    }
  }

  public async execute(
    scope: PromptExecutionScope,
    input: PromptExecutionCommand,
  ): Promise<{ readonly accepted: AcceptedPromptExecution; readonly replayed: boolean }> {
    const command = exactCommand(input);
    const authority = await this.store.resolve(scope, command);
    if (authority === null)
      return fail("REPOSITORY_FAILURE", "Prompt execution authority was not found.");
    let started = false;
    try {
      assertAuthority(scope, command, authority);
      if (authority.accepted !== null) {
        assertStoredAcceptance(authority, authority.accepted);
        return Object.freeze({ accepted: authority.accepted, replayed: true });
      }
      await this.record(
        telemetryEvent(
          authority,
          this.writer.operation,
          1,
          this.clock.now(),
          "STARTED",
          null,
          null,
        ),
      );
      started = true;
      const batch = buildBatch(authority);
      const result = await this.writer.write(batch);
      const writerOutput = validatePromptWriterOutput(batch, result.output);
      const reportedCostMicroUsd = validateAttempts(batch, result.attempts);
      if (reportedCostMicroUsd > authority.reservedCostMicroUsd)
        return fail("COST_MISMATCH", "Prompt writer exceeded its durable cost reservation.");
      const compiledPrompts = Object.freeze(
        writerOutput.scenes.map((writerOutputRow, index) => {
          const expectedScene = batch.scenes[index];
          if (expectedScene === undefined)
            return fail("OUTPUT_INVALID", "Prompt output scene ordering is incomplete.");
          const compiled = compileImagePrompt({
            writerOutput: writerOutputRow,
            expectedScene,
            style: authority.style,
            extraPromptKeywords: authority.extraPromptKeywords,
            applyExtraPromptKeywords: authority.applyExtraPromptKeywords,
          });
          verifyCompiledImagePrompt(compiled);
          return compiled;
        }),
      );
      const inputHash = promptExecutionInputHash(authority);
      const requestHash = result.attempts[0]!.requestHash;
      const responseHash = hashCanonical(writerOutput);
      const compiledOutputHash = hashCanonical(compiledPrompts);
      const acceptedAt = this.clock.now();
      const acceptanceBase = {
        schemaVersion: DURABLE_PROMPT_EXECUTION_VERSION,
        workspaceId: authority.workspaceId,
        projectId: authority.projectId,
        revisionId: authority.revisionId,
        timelineId: authority.timelineId,
        timelineHash: authority.timelineHash,
        imageStyleVersionId: authority.imageStyleVersionId,
        styleProfileHash: authority.styleProfileHash,
        taskId: authority.taskId,
        attemptId: authority.attemptId,
        attemptOrdinal: authority.attemptOrdinal,
        outboxId: authority.outboxId,
        inputHash,
        requestHash,
        responseHash,
        compiledOutputHash,
        writerAttempts: result.attempts,
        writerOutput,
        compiledPrompts,
        reportedCostMicroUsd,
        acceptedAt,
      };
      const acceptance: AcceptedPromptExecution = Object.freeze({
        ...acceptanceBase,
        acceptanceFingerprintHash: hashUtf8(canonicalizeJson(acceptanceBase)),
      });
      const stored = await this.store.accept(scope, { authority, acceptance });
      assertStoredAcceptance(
        Object.freeze({
          ...authority,
          taskState: "SUCCEEDED",
          attemptState: "SUCCEEDED",
          accepted: stored.accepted,
        }),
        stored.accepted,
      );
      if (stored.accepted.acceptanceFingerprintHash !== acceptance.acceptanceFingerprintHash)
        return fail("HASH_MISMATCH", "Prompt acceptance store returned conflicting durable bytes.");
      await this.record(
        telemetryEvent(
          authority,
          this.writer.operation,
          2,
          this.clock.now(),
          "SUCCEEDED",
          reportedCostMicroUsd,
          null,
        ),
      );
      return Object.freeze(stored);
    } catch (error) {
      const failure =
        error instanceof PromptExecutionError
          ? error
          : new PromptExecutionError("OUTPUT_INVALID", "Prompt writer execution failed closed.");
      if (started) {
        const cancelled = failure.code === "CANCELLED";
        await this.record(
          telemetryEvent(
            authority,
            this.writer.operation,
            2,
            this.clock.now(),
            cancelled ? "CANCELLED" : "FAILED",
            null,
            cancelled
              ? null
              : {
                  code: failure.code,
                  classification: failure.code === "REPOSITORY_FAILURE" ? "INTERNAL" : "VALIDATION",
                  retryable: failure.code === "REPOSITORY_FAILURE",
                },
          ),
        );
      }
      throw failure;
    }
  }
}
