import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type ProjectRevisionConfigDocument,
  type TimelinePlanDocument,
  type TranscriptTimingDocument,
  type ValidatedContractDocument,
} from "@videoforge/contracts";
import { scheduleTimeline } from "@videoforge/pipeline/scheduler";
import { SUPPORTED_SCHEDULER_CONFIG } from "@videoforge/pipeline/scheduler-config";

import { sha256Bytes } from "./crypto";
import { hostedGpuReadiness, type HostedGpuReadiness } from "./gpu-readiness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

export interface HostedGenerationSnapshot {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly asrAttemptId: string;
  readonly asrState: "SUCCEEDED";
  readonly asrOutputObjectKey: string;
  readonly asrOutputContentType: "application/json";
  readonly asrOutputContentLength: number;
  readonly asrOutputSha256: string;
  readonly expectedWhisperModelSha256: string;
  readonly revisionConfig: ProjectRevisionConfigDocument;
  readonly revisionConfigSha256: string;
}

export interface HostedGenerationTaskPlan {
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

function stableId(namespace: string, stableKey: string): string {
  let hash = 0x811c9dc5;
  for (const character of `${namespace}:${stableKey}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `seg_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function plannedTasks(timeline: TimelinePlanDocument): readonly HostedGenerationTaskPlan[] {
  const tasks = new Map<string, HostedGenerationTaskPlan>();
  const add = (
    taskKey: string,
    lane: "IMAGE" | "AVATAR",
    timelineSegmentId: string,
    dependsOn: readonly string[],
  ) => {
    if (tasks.has(taskKey)) reject("HOSTED_GENERATION_TASK_KEY_COLLISION");
    tasks.set(taskKey, {
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
  return [...tasks.values()].sort((left, right) => left.taskKey.localeCompare(right.taskKey));
}

export async function coordinateHostedGeneration(input: {
  readonly snapshot: HostedGenerationSnapshot;
  readonly asrOutputBytes: ArrayBuffer;
  readonly persistence: HostedGenerationPersistence;
  readonly readGpuReadiness?: () => HostedGpuReadiness;
}): Promise<HostedGenerationCoordinatorResult> {
  const { snapshot } = input;
  if (
    ![
      snapshot.accountId,
      snapshot.workspaceId,
      snapshot.userId,
      snapshot.projectId,
      snapshot.projectRevisionId,
      snapshot.asrAttemptId,
    ].every((value) => UUID.test(value)) ||
    snapshot.asrState !== "SUCCEEDED" ||
    snapshot.asrOutputContentType !== "application/json" ||
    !Number.isSafeInteger(snapshot.asrOutputContentLength) ||
    snapshot.asrOutputContentLength !== input.asrOutputBytes.byteLength ||
    !SHA256.test(snapshot.asrOutputSha256) ||
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
  if ((await sha256Bytes(input.asrOutputBytes)) !== snapshot.asrOutputSha256) {
    reject("HOSTED_GENERATION_ASR_OUTPUT_CHECKSUM_MISMATCH");
  }
  let rawResult: unknown;
  try {
    rawResult = JSON.parse(new TextDecoder().decode(input.asrOutputBytes));
  } catch {
    reject("HOSTED_GENERATION_ASR_OUTPUT_INVALID");
  }
  const [revision, asrResult] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", snapshot.revisionConfig),
    validateAndHashContractDocument("asrJobResult", rawResult),
  ]).catch(() => reject("HOSTED_GENERATION_DOCUMENT_INVALID"));
  if (
    asrResult.value.status !== "SUCCEEDED" ||
    asrResult.value.transcript === null ||
    asrResult.value.attempt_id !== snapshot.asrAttemptId ||
    asrResult.value.source_voiceover_sha256 !== revision.value.voiceover_sha256 ||
    asrResult.value.model_sha256 !== snapshot.expectedWhisperModelSha256
  ) {
    reject("HOSTED_GENERATION_ASR_RESULT_MISMATCH");
  }
  const transcript = await validateAndHashContractDocument(
    "transcriptTiming",
    asrResult.value.transcript,
  ).catch(() => reject("HOSTED_GENERATION_DOCUMENT_INVALID"));
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
  const timelineResult = await scheduleTimeline({
    revision,
    transcript,
    determinism: {
      clock: { nowIso: () => reject("HOSTED_GENERATION_SCHEDULER_CLOCK_FORBIDDEN") },
      ids: { idFor: stableId },
    },
  });
  if (!timelineResult.ok) reject("HOSTED_GENERATION_SCHEDULING_FAILED");
  const timeline = timelineResult.value;
  const tasks = plannedTasks(timeline.value);
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
