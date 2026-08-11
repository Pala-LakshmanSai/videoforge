import { canonicalizeJson, sha256CanonicalJson } from "@videoforge/contracts";
import {
  RUNWARE_GEMINI_STYLE_MODEL,
  buildStyleAnalyzerRequest,
  validateAndAssembleStyleProfile,
  type StyleAnalyzerPort,
  type StyleAnalyzerRequest,
} from "@videoforge/pipeline";

import type { AttemptRecord } from "../repositories/execution.js";
import type {
  ImageStyleAnalysisReferenceBinding,
  ImageStyleAnalysisAttempt,
} from "../repositories/presets.js";
import type {
  CanonicalDocument,
  JsonObject,
  Sha256,
  WorkspaceActorScope,
} from "../repositories/types.js";
import type { ControlPlaneRepositories } from "../repositories/unit-of-work.js";

export const DURABLE_STYLE_ANALYSIS_INPUT_VERSION =
  "videoforge.image-style-analysis-input/v1" as const;
export const DURABLE_STYLE_REFERENCE_SET_VERSION =
  "videoforge.image-style-reference-set/v1" as const;
export const DURABLE_STYLE_ANALYZER_VERSION = "style-analyzer-v1" as const;
export const DURABLE_STYLE_ANALYZER_PROVIDER = "RUNWARE" as const;
export const DURABLE_STYLE_ANALYZER_MODEL = RUNWARE_GEMINI_STYLE_MODEL;

export type StyleAnalysisCompositionErrorCode =
  | "ANALYZER_FAILED"
  | "DURABLE_STATE_INVALID"
  | "INPUT_INVALID"
  | "OUTPUT_INVALID"
  | "REPOSITORY_FAILURE";

export class StyleAnalysisCompositionError extends Error {
  public constructor(
    public readonly code: StyleAnalysisCompositionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StyleAnalysisCompositionError";
  }
}

export interface PrepareImageStyleAnalysisCommand {
  readonly styleId: string;
  readonly versionId: string;
  readonly analysisAttemptId: string;
  readonly taskId: string;
  readonly executionAttemptId: string;
  readonly provider: typeof DURABLE_STYLE_ANALYZER_PROVIDER;
  readonly model: typeof DURABLE_STYLE_ANALYZER_MODEL;
  readonly modelRevision: string;
}

export interface ExecuteImageStyleAnalysisCommand {
  readonly styleId: string;
  readonly versionId: string;
  readonly analysisAttemptId: string;
}

export interface DurableStyleReferenceFact extends ImageStyleAnalysisReferenceBinding {
  readonly referenceId: string;
  readonly normalizedAssetId: string;
}

export interface PreparedImageStyleAnalysis {
  readonly schemaVersion: typeof DURABLE_STYLE_ANALYSIS_INPUT_VERSION;
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly analysisAttemptId: string;
  readonly taskId: string;
  readonly executionAttemptId: string;
  readonly provider: typeof DURABLE_STYLE_ANALYZER_PROVIDER;
  readonly model: typeof DURABLE_STYLE_ANALYZER_MODEL;
  readonly modelRevision: string;
  readonly analyzerVersion: typeof DURABLE_STYLE_ANALYZER_VERSION;
  readonly references: readonly DurableStyleReferenceFact[];
  readonly styleAnalyzerRequest: StyleAnalyzerRequest;
  readonly referenceSetHash: Sha256;
  readonly inputFingerprintHash: Sha256;
  readonly analyzerModelSnapshot: string;
}

export interface ImageStyleAnalysisCompletionCandidate {
  readonly kind: "IMAGE_STYLE_ANALYSIS_COMPLETION_CANDIDATE";
  readonly workspaceId: string;
  readonly styleId: string;
  readonly versionId: string;
  readonly analysisAttemptId: string;
  readonly taskId: string;
  readonly executionAttemptId: string;
  readonly analyzerRequestHash: Sha256;
  readonly referenceSetHash: Sha256;
  readonly analyzerOutputHash: Sha256;
  readonly analyzerModelSnapshot: string;
  readonly disclosureAttestedByUserId: string;
  readonly profileDocument: CanonicalDocument;
}

const PREPARE_KEYS = [
  "analysisAttemptId",
  "executionAttemptId",
  "model",
  "modelRevision",
  "provider",
  "styleId",
  "taskId",
  "versionId",
] as const;
const EXECUTE_KEYS = ["analysisAttemptId", "styleId", "versionId"] as const;

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function snapshot<Value>(value: Value, expectedKeys: readonly string[]): Value {
  let candidate: unknown;
  try {
    candidate = JSON.parse(canonicalizeJson(value));
  } catch {
    throw new StyleAnalysisCompositionError("INPUT_INVALID", "Analysis input must be plain JSON.");
  }
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    throw new StyleAnalysisCompositionError("INPUT_INVALID", "Analysis input must be an object.");
  }
  if (!exactKeys(candidate, expectedKeys)) {
    throw new StyleAnalysisCompositionError(
      "INPUT_INVALID",
      "Analysis input has missing or unknown fields.",
    );
  }
  return candidate as Value;
}

function boundedText(value: unknown, label: string, maximum = 240): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim()
  ) {
    throw new StyleAnalysisCompositionError("INPUT_INVALID", `${label} is invalid.`);
  }
  return value;
}

function prepareCommand(value: PrepareImageStyleAnalysisCommand): PrepareImageStyleAnalysisCommand {
  const command = snapshot(value, PREPARE_KEYS);
  for (const [label, identifier] of [
    ["styleId", command.styleId],
    ["versionId", command.versionId],
    ["analysisAttemptId", command.analysisAttemptId],
    ["taskId", command.taskId],
    ["executionAttemptId", command.executionAttemptId],
  ] as const) {
    boundedText(identifier, label, 160);
  }
  if (command.provider !== DURABLE_STYLE_ANALYZER_PROVIDER) {
    throw new StyleAnalysisCompositionError("INPUT_INVALID", "Analyzer provider is not pinned.");
  }
  if (command.model !== DURABLE_STYLE_ANALYZER_MODEL) {
    throw new StyleAnalysisCompositionError("INPUT_INVALID", "Analyzer model is not pinned.");
  }
  boundedText(command.modelRevision, "modelRevision", 240);
  return Object.freeze(command);
}

function executeCommand(value: ExecuteImageStyleAnalysisCommand): ExecuteImageStyleAnalysisCommand {
  const command = snapshot(value, EXECUTE_KEYS);
  boundedText(command.styleId, "styleId", 160);
  boundedText(command.versionId, "versionId", 160);
  boundedText(command.analysisAttemptId, "analysisAttemptId", 160);
  return Object.freeze(command);
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function repositoryFailure(message: string): never {
  throw new StyleAnalysisCompositionError("REPOSITORY_FAILURE", message);
}

function stateFailure(message: string): never {
  throw new StyleAnalysisCompositionError("DURABLE_STATE_INVALID", message);
}

function analyzerModelSnapshot(command: PrepareImageStyleAnalysisCommand): string {
  return canonicalizeJson({
    model: command.model,
    model_revision: command.modelRevision,
    provider: command.provider,
  });
}

async function composePrepared(
  workspaceId: string,
  command: PrepareImageStyleAnalysisCommand,
  references: readonly ImageStyleAnalysisReferenceBinding[],
): Promise<PreparedImageStyleAnalysis> {
  const durableReferences = deepFreeze(
    references.map((reference) => ({
      referenceId: reference.referenceId,
      normalizedAssetId: reference.normalizedAssetId,
      alias: reference.alias,
      derivativeSha256: reference.derivativeSha256,
      mimeType: reference.mimeType,
      width: reference.width,
      height: reference.height,
      bytes: reference.bytes,
    })),
  );
  const styleAnalyzerRequest = buildStyleAnalyzerRequest(
    durableReferences.map(({ alias, derivativeSha256, mimeType, width, height, bytes }) => ({
      alias,
      derivativeSha256,
      mimeType,
      width,
      height,
      bytes,
    })),
  );
  const referenceSet = deepFreeze({
    schema_version: DURABLE_STYLE_REFERENCE_SET_VERSION,
    references: durableReferences,
  });
  const referenceSetHash = (await sha256CanonicalJson(referenceSet)) as Sha256;
  const inputEnvelope = deepFreeze({
    schema_version: DURABLE_STYLE_ANALYSIS_INPUT_VERSION,
    workspace_id: workspaceId,
    style_id: command.styleId,
    version_id: command.versionId,
    analysis_attempt_id: command.analysisAttemptId,
    task_id: command.taskId,
    execution_attempt_id: command.executionAttemptId,
    provider: command.provider,
    model: command.model,
    model_revision: command.modelRevision,
    analyzer_version: DURABLE_STYLE_ANALYZER_VERSION,
    reference_set_sha256: referenceSetHash,
    reference_set: referenceSet,
  });
  return deepFreeze({
    schemaVersion: DURABLE_STYLE_ANALYSIS_INPUT_VERSION,
    workspaceId,
    styleId: command.styleId,
    versionId: command.versionId,
    analysisAttemptId: command.analysisAttemptId,
    taskId: command.taskId,
    executionAttemptId: command.executionAttemptId,
    provider: command.provider,
    model: command.model,
    modelRevision: command.modelRevision,
    analyzerVersion: DURABLE_STYLE_ANALYZER_VERSION,
    references: durableReferences,
    styleAnalyzerRequest,
    referenceSetHash,
    inputFingerprintHash: (await sha256CanonicalJson(inputEnvelope)) as Sha256,
    analyzerModelSnapshot: analyzerModelSnapshot(command),
  });
}

function claimedAttempt(
  attempts: readonly AttemptRecord[],
  attempt: ImageStyleAnalysisAttempt,
  inputFingerprintHash: Sha256,
): AttemptRecord {
  const general = attempts.find((candidate) => candidate.attemptId === attempt.executionAttemptId);
  if (
    general === undefined ||
    general.taskId !== attempt.taskId ||
    general.ordinal !== attempt.ordinal ||
    general.idempotencyKey !== attempt.idempotencyKey ||
    general.inputHash !== inputFingerprintHash ||
    general.state !== "CLAIMED" ||
    general.claimState !== "CLAIMED" ||
    general.resultDisposition !== "PENDING" ||
    general.finishedAt !== null
  ) {
    return stateFailure("The linked general attempt does not hold the exact unfinished claim.");
  }
  return general;
}

function profilePayload(value: unknown): JsonObject {
  return JSON.parse(canonicalizeJson(value)) as JsonObject;
}

export class DurableImageStyleAnalysisComposition {
  public constructor(
    private readonly repositories: ControlPlaneRepositories,
    private readonly analyzer: StyleAnalyzerPort,
  ) {}

  public async prepare(
    scope: WorkspaceActorScope,
    input: PrepareImageStyleAnalysisCommand,
  ): Promise<PreparedImageStyleAnalysis> {
    const command = prepareCommand(input);
    const versionResult = await this.repositories.imageStyles.resolveVersion(scope, command);
    if (!versionResult.ok) return repositoryFailure("Image Style version preparation failed.");
    const version = versionResult.value;
    if (
      (version.state !== "DRAFT" && version.state !== "FAILED") ||
      version.disclosureAttestedByUserId === null
    ) {
      return stateFailure("Image Style analysis preparation requires a disclosed draft or retry.");
    }
    const references = await this.repositories.imageStyles.resolveAnalysisReferenceSet(
      scope,
      command,
    );
    if (!references.ok) return repositoryFailure("Image Style reference preparation failed.");
    return composePrepared(scope.workspaceId, command, references.value);
  }

  public async execute(
    scope: WorkspaceActorScope,
    input: ExecuteImageStyleAnalysisCommand,
  ): Promise<ImageStyleAnalysisCompletionCandidate> {
    const command = executeCommand(input);
    const versionResult = await this.repositories.imageStyles.resolveVersion(scope, command);
    if (!versionResult.ok) return repositoryFailure("Image Style version execution lookup failed.");
    const version = versionResult.value;
    if (
      version.state !== "ANALYZING" ||
      version.disclosureAttestedByUserId === null ||
      version.analyzerRequestHash === null ||
      version.analyzerModelSnapshot === null
    ) {
      return stateFailure("Image Style version is not an exact analyzing authority.");
    }

    const specializedResult = await this.repositories.imageStyles.resolveAnalysisAttempt(
      scope,
      command,
    );
    if (!specializedResult.ok) {
      return repositoryFailure("Image Style analysis attempt lookup failed.");
    }
    const specialized = specializedResult.value;
    if (
      specialized.state !== "CREATED" ||
      specialized.responseHash !== null ||
      specialized.usagePayload !== null ||
      specialized.reportedCostMicroUsd !== null
    ) {
      return stateFailure("Image Style analysis attempt is not an uncompleted created attempt.");
    }

    const references = await this.repositories.imageStyles.resolveAnalysisReferenceSet(
      scope,
      command,
    );
    if (!references.ok) return repositoryFailure("Image Style analysis references cannot resolve.");
    const prepared = await composePrepared(
      scope.workspaceId,
      {
        styleId: command.styleId,
        versionId: command.versionId,
        analysisAttemptId: command.analysisAttemptId,
        taskId: specialized.taskId,
        executionAttemptId: specialized.executionAttemptId,
        provider: specialized.provider as typeof DURABLE_STYLE_ANALYZER_PROVIDER,
        model: specialized.model as typeof DURABLE_STYLE_ANALYZER_MODEL,
        modelRevision: specialized.modelRevision,
      },
      references.value,
    );
    if (
      specialized.provider !== DURABLE_STYLE_ANALYZER_PROVIDER ||
      specialized.model !== DURABLE_STYLE_ANALYZER_MODEL ||
      specialized.requestHash !== prepared.inputFingerprintHash ||
      version.analyzerRequestHash !== prepared.inputFingerprintHash ||
      version.analyzerModelSnapshot !== prepared.analyzerModelSnapshot
    ) {
      return stateFailure("Stored Image Style analysis identity or input fingerprint drifted.");
    }

    const taskResult = await this.repositories.execution.resolveTask(scope, {
      taskId: specialized.taskId,
    });
    if (!taskResult.ok) return repositoryFailure("Image Style analysis task lookup failed.");
    const task = taskResult.value;
    if (
      task.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
      task.owner.ownerId !== command.versionId ||
      task.owner.imageStyleVersionId !== command.versionId ||
      task.state !== "RUNNING" ||
      task.acceptedAttemptId !== null
    ) {
      return stateFailure("Image Style analysis task is not the exact running version owner.");
    }
    const attemptsResult = await this.repositories.execution.listAttempts(scope, {
      taskId: specialized.taskId,
    });
    if (!attemptsResult.ok)
      return repositoryFailure("Image Style general attempts cannot resolve.");
    claimedAttempt(attemptsResult.value, specialized, prepared.inputFingerprintHash);

    let output: unknown;
    try {
      output = await this.analyzer.analyze(prepared.styleAnalyzerRequest);
    } catch {
      throw new StyleAnalysisCompositionError(
        "ANALYZER_FAILED",
        "Injected Image Style analyzer failed without a trusted completion.",
      );
    }

    let trusted;
    try {
      trusted = await validateAndAssembleStyleProfile(prepared.styleAnalyzerRequest, output);
    } catch {
      throw new StyleAnalysisCompositionError(
        "OUTPUT_INVALID",
        "Injected Image Style analyzer returned an invalid trusted profile candidate.",
      );
    }
    const analyzerOutputHash = (await sha256CanonicalJson(trusted.analyzerOutput)) as Sha256;
    return deepFreeze({
      kind: "IMAGE_STYLE_ANALYSIS_COMPLETION_CANDIDATE" as const,
      workspaceId: scope.workspaceId,
      styleId: command.styleId,
      versionId: command.versionId,
      analysisAttemptId: specialized.analysisAttemptId,
      taskId: specialized.taskId,
      executionAttemptId: specialized.executionAttemptId,
      analyzerRequestHash: prepared.inputFingerprintHash,
      referenceSetHash: prepared.referenceSetHash,
      analyzerOutputHash,
      analyzerModelSnapshot: prepared.analyzerModelSnapshot,
      disclosureAttestedByUserId: version.disclosureAttestedByUserId,
      profileDocument: {
        contractName: "image-style-profile",
        contractVersion: "v1",
        payload: profilePayload(trusted.profile),
        canonicalDocumentSha256: trusted.styleProfileHash as Sha256,
      },
    });
  }
}
