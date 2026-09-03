import {
  hashPrevalidatedContractDocument,
  semanticContractIssues,
  sha256CanonicalJson,
  type ContractDocument,
  type ContractName,
  type ProjectRevisionConfigDocument,
  type TimelinePlanDocument,
  type ValidatedContractDocument,
} from "@videoforge/contracts";
import {
  prepareDurableDeterministicTimeline,
  prepareDurableLocalTranscription,
  trustedTenantActorScope,
  trustedTenantScope,
  type PreparedDeterministicTimeline,
  type PreparedLocalTranscription,
} from "@videoforge/control-plane";
import { SUPPORTED_SCHEDULER_CONFIG } from "@videoforge/pipeline/scheduler-config";

import { sha256Bytes } from "./crypto";
import { hostedGpuReadiness, type HostedGpuReadiness } from "./gpu-readiness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DATABASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface HostedGenerationSnapshot {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly asrAttemptId: string;
  readonly asrState: "SUCCEEDED";
  readonly asrFinishedAt: string;
  readonly asrInputObjectKey: string;
  readonly asrInputContentLength: number;
  readonly asrInputSha256: string;
  readonly asrOutputObjectKey: string;
  readonly asrOutputContentType: "application/json";
  readonly asrOutputContentLength: number;
  readonly asrOutputSha256: string;
  readonly expectedWhisperModelSha256: string;
  readonly revisionConfig: ProjectRevisionConfigDocument | string;
  readonly revisionConfigSha256: string;
}

export interface HostedGenerationTaskPlan {
  readonly taskId: string;
  readonly taskKey: string;
  readonly lane: "IMAGE" | "AVATAR";
  readonly state: "BLOCKED";
  readonly timelineSegmentId: string;
  readonly dependsOn: readonly string[];
}

export interface HostedGenerationPersistence {
  persistProviderInertPlan(input: {
    readonly snapshot: HostedGenerationSnapshot;
    readonly transcript: ValidatedContractDocument<"transcriptTiming">;
    readonly timeline: ValidatedContractDocument<"timelinePlan">;
    readonly preparedTranscript: PreparedLocalTranscription;
    readonly preparedTimeline: PreparedDeterministicTimeline;
    readonly schedulerConfigSha256: string;
    readonly generationPlan: Record<string, unknown>;
    readonly generationPlanSha256: string;
    readonly tasks: readonly HostedGenerationTaskPlan[];
    readonly readiness: HostedGpuReadiness;
  }): Promise<{ readonly replayed: boolean }>;
}

export interface HostedGenerationCoordinatorResult {
  readonly schema_version: "videoforge-hosted-generation-coordination/v1";
  readonly state: "WAITING_FOR_GPU_QUALIFICATION";
  readonly project_id: string;
  readonly project_revision_id: string;
  readonly asr_attempt_id: string;
  readonly transcript_sha256: string;
  readonly timeline_plan_sha256: string;
  readonly generation_plan_sha256: string;
  readonly gpu_readiness: HostedGpuReadiness;
  readonly missing_lane_gates: readonly {
    readonly lane: "MAGE_IMAGE" | "SOULX_AVATAR";
    readonly gates: readonly string[];
  }[];
  readonly serverless_attempt_count: 0;
  readonly outbox_count: 0;
  readonly authority_count: 0;
  readonly transport_call_count: 0;
  readonly provider_call_count: 0;
  readonly spend_usd: 0;
  readonly idempotent_replay: boolean;
}

export class HostedGenerationCoordinationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedGenerationCoordinationError";
  }
}

function reject(code: string): never {
  throw new HostedGenerationCoordinationError(code);
}

type PrecompiledValidator = ((value: unknown) => boolean) & { errors?: unknown };

class PrecompiledContractValidationError extends Error {
  constructor(readonly phase: "SCHEMA" | "CANONICALIZATION") {
    super(phase);
    this.name = "PrecompiledContractValidationError";
  }
}

let precompiledValidatorsPromise: Promise<Record<string, PrecompiledValidator>> | undefined;

async function validateAndHashPrecompiledContractDocument<Name extends ContractName>(
  contractName: Name,
  value: unknown,
): Promise<ValidatedContractDocument<Name>> {
  precompiledValidatorsPromise ??= import(
    "@videoforge/contracts/hosted-generation-contract-validators"
  ).then((module) => module as unknown as Record<string, PrecompiledValidator>);
  const validators = await precompiledValidatorsPromise;
  const validator = validators[contractName];
  if (!validator || !validator(value)) throw new PrecompiledContractValidationError("SCHEMA");
  const typedValue = value as ContractDocument<Name>;
  if (semanticContractIssues(contractName, typedValue).length > 0) {
    throw new PrecompiledContractValidationError("SCHEMA");
  }
  try {
    return await hashPrevalidatedContractDocument(contractName, typedValue);
  } catch {
    throw new PrecompiledContractValidationError("CANONICALIZATION");
  }
}

const precompiledContractDocumentAuthority = Object.freeze({
  validateAndHash: validateAndHashPrecompiledContractDocument,
});

function storedRevisionConfig(value: ProjectRevisionConfigDocument | string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    reject("HOSTED_GENERATION_PROJECT_REVISION_JSON_INVALID");
  }
}

function exactHostedAsrJobTemplate(
  value: unknown,
  snapshot: HostedGenerationSnapshot,
): { readonly inputDocument: Record<string, unknown> } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("HOSTED_GENERATION_ASR_JOB_TEMPLATE_INVALID");
  }
  const row = value as Record<string, unknown>;
  const result = row.result as Record<string, unknown> | undefined;
  const tooling = row.tooling as Record<string, unknown> | undefined;
  const outputs = row.outputs;
  const primary = Array.isArray(outputs)
    ? (outputs[0] as Record<string, unknown> | undefined)
    : null;
  const inputDocument = row.input_document;
  const inputRecord = inputDocument as Record<string, unknown> | null;
  const inputOutput = inputRecord?.output as Record<string, unknown> | undefined;
  if (
    Object.keys(row).sort().join(",") !==
      "attempt_id,input_document,kind,outputs,result,schema_version,tooling" ||
    row.schema_version !== "videoforge-personal-worker-job-template/v1" ||
    row.attempt_id !== snapshot.asrAttemptId ||
    row.kind !== "ASR" ||
    typeof inputDocument !== "object" ||
    inputDocument === null ||
    Array.isArray(inputDocument) ||
    inputRecord?.schema_version !== "asr-job-input/v1" ||
    inputRecord.project_revision_id !== snapshot.projectRevisionId ||
    inputRecord.attempt_id !== snapshot.asrAttemptId ||
    inputRecord.cancel_token !== snapshot.asrAttemptId ||
    typeof inputOutput !== "object" ||
    inputOutput === null ||
    Array.isArray(inputOutput) ||
    Object.keys(inputOutput).join(",") !== "result_uri" ||
    inputOutput.result_uri !==
      `vf-local-run://${snapshot.projectRevisionId}/${snapshot.asrAttemptId}/asr-result.json` ||
    !Array.isArray(outputs) ||
    outputs.length !== 1 ||
    !primary ||
    Object.keys(primary).sort().join(",") !== "content_type,max_bytes,object_key,source" ||
    primary.source !== "PRIMARY_RESULT_OUTPUT" ||
    primary.content_type !== "application/json" ||
    typeof primary.object_key !== "string" ||
    !primary.object_key.startsWith(
      `tenant/${snapshot.accountId}/workspace/${snapshot.workspaceId}/project/${snapshot.projectId}` +
        `/revision/${snapshot.projectRevisionId}/lane/input/job/${snapshot.asrAttemptId}/artifact/`,
    ) ||
    !Number.isSafeInteger(primary.max_bytes) ||
    Number(primary.max_bytes) < 1 ||
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(",") !== "max_bytes,object_key" ||
    result.object_key !== snapshot.asrOutputObjectKey ||
    !Number.isSafeInteger(result.max_bytes) ||
    Number(result.max_bytes) < snapshot.asrOutputContentLength ||
    typeof tooling !== "object" ||
    tooling === null ||
    Array.isArray(tooling) ||
    Object.keys(tooling).sort().join(",") !==
      "ffmpeg_version,ffprobe_version,whisper_model_sha256,whisper_version" ||
    tooling.whisper_model_sha256 !== snapshot.expectedWhisperModelSha256 ||
    tooling.whisper_version !== "1.8.4" ||
    tooling.ffmpeg_version !== "8.1.2" ||
    tooling.ffprobe_version !== "8.1.2"
  ) {
    reject("HOSTED_GENERATION_ASR_JOB_TEMPLATE_INVALID");
  }
  return { inputDocument: inputDocument as Record<string, unknown> };
}

async function hostedTaskUuid(revisionId: string, taskKey: string): Promise<string> {
  const digest = (
    await sha256Bytes(
      new TextEncoder().encode(
        `videoforge:hosted-generation-task:v1\u0000${revisionId}\u0000${taskKey}`,
      ),
    )
  ).slice("sha256:".length);
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = bytes.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function plannedTasks(
  revisionId: string,
  timeline: TimelinePlanDocument,
): Promise<readonly HostedGenerationTaskPlan[]> {
  const tasks = new Map<string, HostedGenerationTaskPlan>();
  const add = (
    taskKey: string,
    lane: "IMAGE" | "AVATAR",
    timelineSegmentId: string,
    dependsOn: readonly string[],
  ) => {
    if (tasks.has(taskKey)) reject("HOSTED_GENERATION_TASK_KEY_COLLISION");
    tasks.set(taskKey, {
      taskId: "",
      taskKey,
      lane,
      state: "BLOCKED",
      timelineSegmentId,
      dependsOn,
    });
  };
  for (const segment of timeline.segments) {
    if (segment.timeline_composition === "IMAGE_FULL") {
      add(segment.required_slots.image.task_key, "IMAGE", segment.segment_id, []);
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      add(segment.required_slots.avatar.task_key, "AVATAR", segment.segment_id, [
        segment.required_slots.avatar.span_audio_task_key,
      ]);
    } else {
      add(segment.required_slots.avatar.task_key, "AVATAR", segment.segment_id, [
        segment.required_slots.avatar.span_audio_task_key,
      ]);
      add(segment.required_slots.right_image.task_key, "IMAGE", segment.segment_id, []);
    }
  }
  return Promise.all(
    [...tasks.values()]
      .sort((left, right) => left.taskKey.localeCompare(right.taskKey))
      .map(async (task) => ({
        ...task,
        taskId: await hostedTaskUuid(revisionId, task.taskKey),
      })),
  );
}

export async function coordinateHostedGeneration(input: {
  readonly snapshot: HostedGenerationSnapshot;
  readonly asrInputBytes: ArrayBuffer;
  readonly asrOutputBytes: ArrayBuffer;
  readonly persistence: HostedGenerationPersistence;
  readonly readGpuReadiness?: () => HostedGpuReadiness;
}): Promise<HostedGenerationCoordinatorResult> {
  const { snapshot } = input;
  if (
    ![snapshot.accountId, snapshot.workspaceId, snapshot.userId].every((value) =>
      DATABASE_UUID.test(value),
    ) ||
    ![snapshot.projectId, snapshot.projectRevisionId, snapshot.asrAttemptId].every((value) =>
      UUID.test(value),
    ) ||
    snapshot.asrState !== "SUCCEEDED" ||
    Number.isNaN(Date.parse(snapshot.asrFinishedAt)) ||
    !Number.isSafeInteger(snapshot.asrInputContentLength) ||
    snapshot.asrInputContentLength !== input.asrInputBytes.byteLength ||
    snapshot.asrOutputContentType !== "application/json" ||
    !Number.isSafeInteger(snapshot.asrOutputContentLength) ||
    snapshot.asrOutputContentLength !== input.asrOutputBytes.byteLength ||
    !SHA256.test(snapshot.asrOutputSha256) ||
    !SHA256.test(snapshot.asrInputSha256) ||
    !SHA256.test(snapshot.revisionConfigSha256) ||
    !SHA256.test(snapshot.expectedWhisperModelSha256)
  ) {
    reject("HOSTED_GENERATION_LINEAGE_INVALID");
  }
  const expectedPrefix =
    `tenant/${snapshot.accountId}/workspace/${snapshot.workspaceId}/project/${snapshot.projectId}` +
    `/revision/${snapshot.projectRevisionId}/lane/input/job/${snapshot.asrAttemptId}/artifact/`;
  if (!snapshot.asrOutputObjectKey.startsWith(expectedPrefix)) {
    reject("HOSTED_GENERATION_ASR_OUTPUT_FOREIGN");
  }
  if (!snapshot.asrInputObjectKey.startsWith(expectedPrefix)) {
    reject("HOSTED_GENERATION_ASR_INPUT_FOREIGN");
  }
  if ((await sha256Bytes(input.asrInputBytes)) !== snapshot.asrInputSha256) {
    reject("HOSTED_GENERATION_ASR_INPUT_CHECKSUM_MISMATCH");
  }
  if ((await sha256Bytes(input.asrOutputBytes)) !== snapshot.asrOutputSha256) {
    reject("HOSTED_GENERATION_ASR_OUTPUT_CHECKSUM_MISMATCH");
  }
  let rawResult: unknown;
  let rawJobTemplate: unknown;
  try {
    rawJobTemplate = JSON.parse(new TextDecoder().decode(input.asrInputBytes));
    rawResult = JSON.parse(new TextDecoder().decode(input.asrOutputBytes));
  } catch {
    reject("HOSTED_GENERATION_ASR_OUTPUT_INVALID");
  }
  const storedRevision = storedRevisionConfig(snapshot.revisionConfig);
  let revision: Awaited<
    ReturnType<typeof validateAndHashPrecompiledContractDocument<"projectRevisionConfig">>
  >;
  try {
    revision = await validateAndHashPrecompiledContractDocument(
      "projectRevisionConfig",
      storedRevision,
    );
  } catch (error) {
    if (error instanceof PrecompiledContractValidationError && error.phase === "SCHEMA") {
      reject("HOSTED_GENERATION_PROJECT_REVISION_SCHEMA_INVALID");
    }
    reject("HOSTED_GENERATION_PROJECT_REVISION_CANONICALIZATION_FAILED");
  }
  const asrResult = await validateAndHashPrecompiledContractDocument(
    "asrJobResult",
    rawResult,
  ).catch(() => reject("HOSTED_GENERATION_ASR_RESULT_DOCUMENT_INVALID"));
  const asrTemplate = exactHostedAsrJobTemplate(rawJobTemplate, snapshot);
  if (
    asrResult.value.status !== "SUCCEEDED" ||
    asrResult.value.transcript === null ||
    asrResult.value.attempt_id !== snapshot.asrAttemptId ||
    asrResult.value.source_voiceover_sha256 !== revision.value.voiceover_sha256 ||
    asrResult.value.model_sha256 !== snapshot.expectedWhisperModelSha256
  ) {
    reject("HOSTED_GENERATION_ASR_RESULT_MISMATCH");
  }
  const transcript = await validateAndHashPrecompiledContractDocument(
    "transcriptTiming",
    asrResult.value.transcript,
  ).catch(() => reject("HOSTED_GENERATION_TRANSCRIPT_DOCUMENT_INVALID"));
  const scope = trustedTenantActorScope(
    trustedTenantScope(snapshot.accountId, snapshot.workspaceId),
    snapshot.userId,
  );
  const preparedTranscript = await prepareDurableLocalTranscription(
    scope,
    {
      projectId: snapshot.projectId,
      projectRevisionId: snapshot.projectRevisionId,
      // The pure preparer requires these fields to validate the hosted ASR envelope. They are never
      // persisted as generic generation-task/attempt lineage by the hosted bridge.
      taskId: snapshot.asrAttemptId,
      attemptId: snapshot.asrAttemptId,
      expectedHeadVersion: 0,
      lineageSequence: 1,
      supersedesTranscriptId: null,
      optionalScriptHash: null,
      asrInput: asrTemplate.inputDocument,
      asrResult: rawResult,
      finishedAt: snapshot.asrFinishedAt,
    },
    precompiledContractDocumentAuthority,
  ).catch(() => reject("HOSTED_GENERATION_ASR_LINEAGE_MISMATCH"));
  if (
    revision.sha256 !== snapshot.revisionConfigSha256 ||
    revision.value.project_id !== snapshot.projectId ||
    revision.value.project_revision_id !== snapshot.projectRevisionId ||
    transcript.value.project_revision_id !== snapshot.projectRevisionId ||
    transcript.value.source.asset_id !== revision.value.voiceover_asset_id ||
    transcript.value.source.sha256 !== revision.value.voiceover_sha256 ||
    transcript.value.engine.name !== "whisper.cpp" ||
    transcript.value.engine.version !== "1.8.4" ||
    transcript.value.engine.model_name !== "base.en" ||
    transcript.value.engine.model_sha256 !== snapshot.expectedWhisperModelSha256 ||
    transcript.value.engine.language !== "en" ||
    transcript.value.engine.version !== asrResult.value.diagnostics.tool_version ||
    transcript.value.source.duration_ms !== asrResult.value.diagnostics.source_duration_ms
  ) {
    reject("HOSTED_GENERATION_ASR_LINEAGE_MISMATCH");
  }
  const preparedTimeline = await prepareDurableDeterministicTimeline(
    scope,
    {
      projectId: snapshot.projectId,
      projectRevisionId: snapshot.projectRevisionId,
      transcriptId: preparedTranscript.transcriptId,
      expectedHeadVersion: 1,
      planSequence: 1,
      supersedesTimelinePlanId: null,
      revision: revision.value,
      transcript: transcript.value,
      createdAt: snapshot.asrFinishedAt,
    },
    precompiledContractDocumentAuthority,
  ).catch(() => reject("HOSTED_GENERATION_SCHEDULING_FAILED"));
  const timeline = await validateAndHashPrecompiledContractDocument(
    "timelinePlan",
    preparedTimeline.timelinePersistence.canonicalDocument.payload,
  ).catch(() => reject("HOSTED_GENERATION_SCHEDULING_FAILED"));
  if (preparedTimeline.timelineDocumentHash !== timeline.sha256)
    reject("HOSTED_GENERATION_TIMELINE_DERIVATION_MISMATCH");
  const tasks = await plannedTasks(snapshot.projectRevisionId, timeline.value);
  const schedulerConfigSha256 = await sha256CanonicalJson(SUPPORTED_SCHEDULER_CONFIG);
  const generationPlan = {
    schema_version: "videoforge-hosted-generation-plan/v1",
    project_id: snapshot.projectId,
    project_revision_id: snapshot.projectRevisionId,
    asr_attempt_id: snapshot.asrAttemptId,
    revision_config_sha256: revision.sha256,
    transcript_sha256: transcript.sha256,
    timeline_plan_sha256: timeline.sha256,
    scheduler_config_sha256: schedulerConfigSha256,
    tasks: tasks.map((task) => ({
      task_id: task.taskId,
      task_key: task.taskKey,
      lane: task.lane,
      state: task.state,
      timeline_segment_id: task.timelineSegmentId,
      depends_on: task.dependsOn,
    })),
    predispatch: "WAITING_FOR_GPU_QUALIFICATION",
  };
  const generationPlanSha256 = await sha256CanonicalJson(generationPlan);

  // This factual read is deliberately before the only persistence port. The port is constrained
  // to provider-inert rows and cannot create attempts, outbox work, authority, or transport calls.
  const readiness = (input.readGpuReadiness ?? hostedGpuReadiness)();
  if (
    readiness.gpu_transport !== "DISABLED_UNQUALIFIED" ||
    readiness.provider_calls_authorized !== false ||
    readiness.dispatch_available !== false
  ) {
    reject("HOSTED_GENERATION_GPU_READINESS_UNTRUSTED");
  }
  const persisted = await input.persistence.persistProviderInertPlan({
    snapshot,
    transcript,
    timeline,
    preparedTranscript,
    preparedTimeline,
    schedulerConfigSha256,
    generationPlan,
    generationPlanSha256,
    tasks,
    readiness,
  });
  return {
    schema_version: "videoforge-hosted-generation-coordination/v1",
    state: "WAITING_FOR_GPU_QUALIFICATION",
    project_id: snapshot.projectId,
    project_revision_id: snapshot.projectRevisionId,
    asr_attempt_id: snapshot.asrAttemptId,
    transcript_sha256: transcript.sha256,
    timeline_plan_sha256: timeline.sha256,
    generation_plan_sha256: generationPlanSha256,
    gpu_readiness: readiness,
    missing_lane_gates: readiness.lanes.map((lane) => ({
      lane: lane.lane,
      gates: lane.missing_gates,
    })),
    serverless_attempt_count: 0,
    outbox_count: 0,
    authority_count: 0,
    transport_call_count: 0,
    provider_call_count: 0,
    spend_usd: 0,
    idempotent_replay: persisted.replayed,
  };
}
