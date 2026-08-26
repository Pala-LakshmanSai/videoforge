import {
  validateAndHashContractDocument,
  type ProjectRevisionConfigDocument,
  type ResolvedRenderManifestDocument,
  type TimelinePlanDocument,
  type TranscriptTimingDocument,
  type ValidatedContractDocument,
} from "@videoforge/contracts";

import { sha256 } from "./crypto";
import { canonicalJson, exactHostedRenderSubmission } from "./submission";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const OBJECT_KEY =
  /^tenant\/([^/]+)\/workspace\/([^/]+)\/project\/([^/]+)\/revision\/([^/]+)\/lane\/(input|mage-image|soulx-avatar|render)\/job\/([^/]+)\/artifact\/([^/]+)$/u;
const SOULX_SOURCE_PROFILE = "soulx-pro-vf924u-approved-v1";
const SOULX_SOURCE_SHA256 =
  "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83";
const SOULX_CANDIDATE_SHA256 =
  "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442";
const SOULX_APPROVAL_SHA256 =
  "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45";

type Lane = "INPUT" | "MAGE_IMAGE" | "SOULX_AVATAR" | "RENDER";
type MediaKind = "VOICEOVER" | "IMAGE" | "AVATAR_CLIP" | "RESOLVED_RENDER_MANIFEST";

export interface HostedRenderPlanSql {
  query<Row extends Record<string, unknown>>(
    sql: string,
    parameters?: readonly (boolean | number | string | null)[],
  ): Promise<{ readonly rows: readonly Row[]; readonly affectedRows: number }>;
}

export interface HostedRenderPlanDatabase {
  transaction<Value>(work: (transaction: HostedRenderPlanSql) => Promise<Value>): Promise<Value>;
}

export interface HostedCommittedArtifact {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly lane: Lane;
  readonly taskKey: string | null;
  readonly assetId: string;
  readonly receiptId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
  readonly reservationState: "COMMITTED";
  readonly receiptDeletedAt: null;
  readonly acceptedAttemptId: string | null;
  readonly barrierAcceptance: "ACCEPTED_CANONICAL" | "COMMITTED_INPUT" | "COMMITTED_MANIFEST";
  readonly kind: MediaKind;
}

export interface HostedLockedRevisionSnapshot {
  readonly status: "LOCKED";
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly revisionConfigSha256: string;
  readonly avatarProfileVersionId: string;
  readonly avatarProfileHash: string;
  readonly avatarRuntimeSourceSha256: string;
  readonly imageStyleVersionId: string;
  readonly styleProfileHash: string;
}

export interface HostedTimingSnapshot {
  readonly transcript: TranscriptTimingDocument;
  readonly transcriptSha256: string;
  readonly timeline: TimelinePlanDocument;
  readonly timelineSha256: string;
  /** Immutable timeline_plans.transcript_document_hash. */
  readonly timelineTranscriptSha256: string;
}

export interface HostedResolvedManifestSnapshot {
  readonly document: ResolvedRenderManifestDocument;
  readonly artifact: HostedCommittedArtifact;
}

export interface HostedRenderPlanMaterializationInput {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly revision: HostedLockedRevisionSnapshot;
  readonly revisionDocument: ProjectRevisionConfigDocument;
  readonly timing: HostedTimingSnapshot;
  readonly voiceover: HostedCommittedArtifact;
  readonly avatarSource?: HostedCommittedArtifact;
  readonly acceptedVisuals: readonly HostedCommittedArtifact[];
  readonly resolvedManifest: HostedResolvedManifestSnapshot;
  readonly tools: {
    readonly ffmpegVersion: string;
    readonly ffprobeVersion: string;
  };
}

export class HostedRenderPlanMaterializationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedRenderPlanMaterializationError";
  }
}

export interface HostedRenderPlanMaterializationResult {
  readonly payload: Record<string, unknown>;
  readonly payloadSha256: string;
  readonly replayed: boolean;
}

function reject(code: string): never {
  throw new HostedRenderPlanMaterializationError(code);
}

function extension(contentType: string): string {
  const value: Readonly<Record<string, string>> = {
    "application/json": "json",
    "audio/flac": "flac",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "image/jpeg": "jpg",
    "image/png": "png",
    "video/mp4": "mp4",
  };
  return value[contentType] ?? reject("HOSTED_RENDER_ARTIFACT_CONTENT_TYPE_UNSUPPORTED");
}

function objectUri(artifact: HostedCommittedArtifact): string {
  return `vf-local://objects/sha256/${artifact.checksumSha256.slice(7, 9)}/${artifact.checksumSha256.slice(7)}.${extension(artifact.contentType)}`;
}

function exactScope(
  artifact: HostedCommittedArtifact,
  input: HostedRenderPlanMaterializationInput,
): void {
  if (
    artifact.accountId !== input.accountId ||
    artifact.workspaceId !== input.workspaceId ||
    artifact.projectId !== input.revision.projectId ||
    artifact.projectRevisionId !== input.revision.projectRevisionId
  ) {
    reject("HOSTED_RENDER_ARTIFACT_FOREIGN");
  }
  const match = OBJECT_KEY.exec(artifact.objectKey);
  const expectedLane = artifact.lane.toLowerCase().replace("_", "-");
  if (
    !match ||
    match[1] !== input.accountId ||
    match[2] !== input.workspaceId ||
    match[3] !== input.revision.projectId ||
    match[4] !== input.revision.projectRevisionId ||
    match[5] !== expectedLane ||
    match[7] !== artifact.assetId ||
    (artifact.acceptedAttemptId !== null && match[6] !== artifact.acceptedAttemptId) ||
    artifact.reservationState !== "COMMITTED" ||
    artifact.receiptDeletedAt !== null ||
    !UUID.test(artifact.receiptId) ||
    !SHA256.test(artifact.checksumSha256) ||
    !Number.isSafeInteger(artifact.contentLength) ||
    artifact.contentLength < 1
  ) {
    reject("HOSTED_RENDER_ARTIFACT_DRIFTED");
  }
}

function requiredTasks(
  timeline: TimelinePlanDocument,
): ReadonlyMap<string, "IMAGE" | "AVATAR_CLIP"> {
  const tasks = new Map<string, "IMAGE" | "AVATAR_CLIP">();
  const add = (taskKey: string, kind: "IMAGE" | "AVATAR_CLIP") => {
    const prior = tasks.get(taskKey);
    if (prior !== undefined && prior !== kind) reject("HOSTED_RENDER_TIMELINE_TASK_COLLISION");
    tasks.set(taskKey, kind);
  };
  for (const segment of timeline.segments) {
    if (segment.timeline_composition === "IMAGE_FULL") {
      add(segment.required_slots.image.task_key, "IMAGE");
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      add(segment.required_slots.avatar.task_key, "AVATAR_CLIP");
    } else {
      add(segment.required_slots.avatar.task_key, "AVATAR_CLIP");
      add(segment.required_slots.right_image.task_key, "IMAGE");
    }
  }
  return tasks;
}

function validateManifestSegments(
  timeline: TimelinePlanDocument,
  manifest: ResolvedRenderManifestDocument,
  accepted: ReadonlyMap<string, HostedCommittedArtifact>,
  avatarSource: HostedCommittedArtifact | undefined,
): void {
  if (manifest.segments.length !== timeline.segments.length)
    reject("HOSTED_RENDER_MANIFEST_PARTIAL");
  let nextFrame = 0;
  for (const [index, timelineSegment] of timeline.segments.entries()) {
    const segment = manifest.segments[index];
    if (
      !segment ||
      segment.segment_id !== timelineSegment.segment_id ||
      segment.start_frame !== timelineSegment.start_frame ||
      segment.end_frame_exclusive !== timelineSegment.end_frame_exclusive ||
      segment.timeline_composition !== timelineSegment.timeline_composition ||
      segment.start_frame !== nextFrame
    ) {
      reject("HOSTED_RENDER_MANIFEST_TIMELINE_DRIFT");
    }
    nextFrame = segment.end_frame_exclusive;
    if (segment.timeline_composition === "IMAGE_FULL") {
      if (timelineSegment.timeline_composition !== "IMAGE_FULL") {
        reject("HOSTED_RENDER_MANIFEST_TIMELINE_DRIFT");
      }
      const artifact = accepted.get(timelineSegment.required_slots.image.task_key);
      if (
        !artifact ||
        segment.accepted_assets.image.asset_id !== artifact.assetId ||
        segment.accepted_assets.image.sha256 !== artifact.checksumSha256 ||
        segment.render.zoom_profile !== "image-full-zoom-v3"
      ) {
        reject("HOSTED_RENDER_MANIFEST_ARTIFACT_DRIFT");
      }
    } else if (segment.timeline_composition === "AVATAR_FULL") {
      if (timelineSegment.timeline_composition !== "AVATAR_FULL") {
        reject("HOSTED_RENDER_MANIFEST_TIMELINE_DRIFT");
      }
      const artifact = accepted.get(timelineSegment.required_slots.avatar.task_key);
      if (
        !artifact ||
        segment.accepted_assets.avatar.asset_id !== artifact.assetId ||
        segment.accepted_assets.avatar.sha256 !== artifact.checksumSha256 ||
        (segment.render.avatar_source_profile === SOULX_SOURCE_PROFILE &&
          (segment.accepted_assets.source_background?.asset_id !== avatarSource?.assetId ||
            segment.accepted_assets.source_background?.sha256 !== SOULX_SOURCE_SHA256))
      ) {
        reject("HOSTED_RENDER_MANIFEST_ARTIFACT_DRIFT");
      }
    } else {
      if (timelineSegment.timeline_composition !== "AVATAR_SPLIT_IMAGE") {
        reject("HOSTED_RENDER_MANIFEST_TIMELINE_DRIFT");
      }
      const avatar = accepted.get(timelineSegment.required_slots.avatar.task_key);
      const image = accepted.get(timelineSegment.required_slots.right_image.task_key);
      if (
        !avatar ||
        !image ||
        segment.accepted_assets.avatar.asset_id !== avatar.assetId ||
        segment.accepted_assets.avatar.sha256 !== avatar.checksumSha256 ||
        segment.accepted_assets.right_image.asset_id !== image.assetId ||
        segment.accepted_assets.right_image.sha256 !== image.checksumSha256 ||
        segment.render.right_image_zoom_profile !== "split-right-zoom-v3"
      ) {
        reject("HOSTED_RENDER_MANIFEST_ARTIFACT_DRIFT");
      }
    }
  }
  if (nextFrame !== timeline.total_frames || manifest.total_frames !== timeline.total_frames) {
    reject("HOSTED_RENDER_MANIFEST_TIMELINE_DRIFT");
  }
}

function validateSoulxCropApproval(
  input: HostedRenderPlanMaterializationInput,
  manifest: ResolvedRenderManifestDocument,
): void {
  type AvatarSegment = Extract<
    ResolvedRenderManifestDocument["segments"][number],
    { readonly timeline_composition: "AVATAR_FULL" | "AVATAR_SPLIT_IMAGE" }
  >;
  const avatarSegments = manifest.segments.filter(
    (segment): segment is AvatarSegment => segment.timeline_composition !== "IMAGE_FULL",
  );
  const soulxSegments = avatarSegments.filter(
    (segment) => segment.render.avatar_source_profile === SOULX_SOURCE_PROFILE,
  );
  const hasAvatarTimeline = avatarSegments.length > 0;
  const hasSoulxArtifact = input.acceptedVisuals.some(
    (artifact) => artifact.lane === "SOULX_AVATAR" || artifact.kind === "AVATAR_CLIP",
  );
  if (!hasAvatarTimeline && !hasSoulxArtifact) {
    if (manifest.soulx_crop_profile_approval !== undefined || input.avatarSource !== undefined)
      reject("SOULX_CROP_PROFILE_UNQUALIFIED");
    return;
  }
  if (
    soulxSegments.length !== avatarSegments.length ||
    !hasSoulxArtifact ||
    input.revision.avatarRuntimeSourceSha256 !== SOULX_SOURCE_SHA256
  ) {
    reject("SOULX_CROP_PROFILE_UNQUALIFIED");
  }
  const approval = manifest.soulx_crop_profile_approval;
  if (
    approval?.profile_group_id !== "soulx-pro-vf924u-full-split-v1" ||
    approval.candidate_sha256 !== SOULX_CANDIDATE_SHA256 ||
    approval.approval_sha256 !== SOULX_APPROVAL_SHA256 ||
    approval.avatar_source_sha256 !== SOULX_SOURCE_SHA256
  ) {
    reject("SOULX_CROP_PROFILE_UNQUALIFIED");
  }
  const hasSoulxFull = soulxSegments.some(
    (segment) => segment.timeline_composition === "AVATAR_FULL",
  );
  const source = input.avatarSource;
  if (
    (hasSoulxFull &&
      (!source ||
        source.lane !== "INPUT" ||
        source.kind !== "IMAGE" ||
        source.taskKey !== null ||
        source.acceptedAttemptId !== null ||
        source.barrierAcceptance !== "COMMITTED_INPUT" ||
        source.assetId !== input.revisionDocument.avatar_binding.runtime_source_asset_id ||
        source.checksumSha256 !== SOULX_SOURCE_SHA256 ||
        !["image/jpeg", "image/png"].includes(source.contentType))) ||
    (!hasSoulxFull && source !== undefined)
  ) {
    reject("SOULX_CROP_PROFILE_UNQUALIFIED");
  }
  for (const segment of soulxSegments) {
    const render = segment.render;
    if (
      render.crop_profile_evidence_sha256 !== SOULX_CANDIDATE_SHA256 ||
      render.crop_profile_acceptance_sha256 !== SOULX_APPROVAL_SHA256 ||
      (segment.timeline_composition === "AVATAR_FULL"
        ? render.crop_profile_id !== "soulx-pro-ranga-full-source-composite-v1" ||
          render.source_background_transform !== "scale=1920:1080:flags=lanczos,fps=30" ||
          render.native_foreground_transform !==
            "scale=1080:1080:flags=lanczos,fps=30,format=rgba" ||
          render.native_foreground_overlay?.x !== 420 ||
          render.native_foreground_overlay.y !== 0 ||
          render.horizontal_alpha_feather_pixels_each_edge !== 32
        : render.crop_profile_id !== "soulx-pro-ranga-split-composite-v1" ||
          render.context_transform !==
            "scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos,crop=960:1080,zoompan=z=min(zoom+0.000133333,1.04):d=300:s=960x1080:fps=30" ||
          render.avatar_crop !== "448:504:32:4")
    ) {
      reject("SOULX_CROP_PROFILE_UNQUALIFIED");
    }
  }
}

function validateRevision(
  input: HostedRenderPlanMaterializationInput,
  revision: ValidatedContractDocument<"projectRevisionConfig">,
): void {
  const document = revision.value;
  if (
    input.revision.status !== "LOCKED" ||
    document.project_id !== input.revision.projectId ||
    document.project_revision_id !== input.revision.projectRevisionId ||
    revision.sha256 !== input.revision.revisionConfigSha256 ||
    document.avatar_binding.avatar_profile_version_id !== input.revision.avatarProfileVersionId ||
    document.avatar_binding.avatar_profile_hash !== input.revision.avatarProfileHash ||
    document.avatar_binding.runtime_source_sha256 !== input.revision.avatarRuntimeSourceSha256 ||
    document.image_style_version_id !== input.revision.imageStyleVersionId ||
    document.style_profile_hash !== input.revision.styleProfileHash
  ) {
    reject("HOSTED_RENDER_REVISION_DRIFT");
  }
}

export async function materializeHostedRenderPlan(
  database: HostedRenderPlanDatabase,
  input: HostedRenderPlanMaterializationInput,
): Promise<HostedRenderPlanMaterializationResult> {
  if (
    !UUID.test(input.accountId) ||
    !UUID.test(input.workspaceId) ||
    !UUID.test(input.revision.projectId) ||
    !UUID.test(input.revision.projectRevisionId)
  ) {
    reject("HOSTED_RENDER_SCOPE_INVALID");
  }
  const [revision, transcript, timeline, manifest] = await Promise.all([
    validateAndHashContractDocument("projectRevisionConfig", input.revisionDocument),
    validateAndHashContractDocument("transcriptTiming", input.timing.transcript),
    validateAndHashContractDocument("timelinePlan", input.timing.timeline),
    validateAndHashContractDocument("resolvedRenderManifest", input.resolvedManifest.document),
  ]).catch(() => reject("HOSTED_RENDER_DOCUMENT_INVALID"));
  validateRevision(input, revision);
  if (
    transcript.sha256 !== input.timing.transcriptSha256 ||
    transcript.value.project_revision_id !== input.revision.projectRevisionId ||
    transcript.value.source.asset_id !== input.revisionDocument.voiceover_asset_id ||
    transcript.value.source.sha256 !== input.revisionDocument.voiceover_sha256 ||
    timeline.sha256 !== input.timing.timelineSha256 ||
    input.timing.timelineTranscriptSha256 !== transcript.sha256 ||
    timeline.value.project_revision_id !== input.revision.projectRevisionId ||
    timeline.value.revision_config_hash !== revision.sha256 ||
    timeline.value.scheduler_version !== revision.value.scheduler_version ||
    timeline.value.seed !== revision.value.scheduler_seed ||
    manifest.value.project_revision_id !== input.revision.projectRevisionId ||
    manifest.value.revision_config_hash !== revision.sha256 ||
    manifest.value.timeline_plan_hash !== timeline.sha256 ||
    manifest.value.render_profile_version !== "ffmpeg-render-v3"
  ) {
    reject("HOSTED_RENDER_TIMING_OR_LINEAGE_DRIFT");
  }

  exactScope(input.voiceover, input);
  if (
    input.voiceover.kind !== "VOICEOVER" ||
    input.voiceover.lane !== "INPUT" ||
    input.voiceover.barrierAcceptance !== "COMMITTED_INPUT" ||
    input.voiceover.acceptedAttemptId !== null ||
    !["audio/flac", "audio/mpeg", "audio/mp4", "audio/wav"].includes(input.voiceover.contentType) ||
    input.voiceover.assetId !== input.revisionDocument.voiceover_asset_id ||
    input.voiceover.checksumSha256 !== input.revisionDocument.voiceover_sha256 ||
    manifest.value.voiceover.asset_id !== input.voiceover.assetId ||
    manifest.value.voiceover.sha256 !== input.voiceover.checksumSha256
  ) {
    reject("HOSTED_RENDER_VOICEOVER_DRIFT");
  }

  const required = requiredTasks(timeline.value);
  validateSoulxCropApproval(input, manifest.value);
  const accepted = new Map<string, HostedCommittedArtifact>();
  if (input.avatarSource !== undefined) {
    exactScope(input.avatarSource, input);
  }
  for (const artifact of input.acceptedVisuals) {
    exactScope(artifact, input);
    if (
      artifact.taskKey === null ||
      artifact.barrierAcceptance !== "ACCEPTED_CANONICAL" ||
      artifact.acceptedAttemptId === null ||
      !UUID.test(artifact.acceptedAttemptId) ||
      accepted.has(artifact.taskKey) ||
      required.get(artifact.taskKey) !== artifact.kind ||
      (artifact.kind === "IMAGE" &&
        (artifact.lane !== "MAGE_IMAGE" ||
          !["image/jpeg", "image/png"].includes(artifact.contentType))) ||
      (artifact.kind === "AVATAR_CLIP" &&
        (artifact.lane !== "SOULX_AVATAR" || artifact.contentType !== "video/mp4"))
    ) {
      reject("HOSTED_RENDER_ARTIFACT_BARRIER_DRIFT");
    }
    accepted.set(artifact.taskKey, artifact);
  }
  if (accepted.size !== required.size || [...required.keys()].some((key) => !accepted.has(key))) {
    reject("HOSTED_RENDER_ARTIFACT_BARRIER_PARTIAL");
  }
  validateManifestSegments(timeline.value, manifest.value, accepted, input.avatarSource);

  exactScope(input.resolvedManifest.artifact, input);
  if (
    input.resolvedManifest.artifact.kind !== "RESOLVED_RENDER_MANIFEST" ||
    input.resolvedManifest.artifact.lane !== "RENDER" ||
    input.resolvedManifest.artifact.barrierAcceptance !== "COMMITTED_MANIFEST" ||
    input.resolvedManifest.artifact.acceptedAttemptId !== null ||
    input.resolvedManifest.artifact.contentType !== "application/json" ||
    input.resolvedManifest.artifact.checksumSha256 !== manifest.sha256 ||
    input.resolvedManifest.artifact.assetId.length < 1
  ) {
    reject("HOSTED_RENDER_MANIFEST_ARTIFACT_DRIFT");
  }

  const uniqueMedia = new Map<string, HostedCommittedArtifact>();
  for (const artifact of [
    input.voiceover,
    ...(input.avatarSource === undefined ? [] : [input.avatarSource]),
    ...input.acceptedVisuals,
  ]) {
    const uri = objectUri(artifact);
    const existing = uniqueMedia.get(uri);
    if (existing && existing.receiptId !== artifact.receiptId) {
      reject("HOSTED_RENDER_ARTIFACT_URI_COLLISION");
    }
    uniqueMedia.set(uri, artifact);
  }
  const media = [...uniqueMedia.entries()].sort(([left], [right]) => left.localeCompare(right));
  const manifestUri = objectUri(input.resolvedManifest.artifact);
  const payload = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: `render-plan-${input.revision.projectRevisionId}`,
    project_id: input.revision.projectId,
    project_revision_id: input.revision.projectRevisionId,
    kind: "RENDER",
    input_document: {
      schema_version: "render-job-input/v1",
      project_revision_id: input.revision.projectRevisionId,
      attempt_id: input.revision.projectRevisionId,
      resolved_render_manifest: {
        asset_id: input.resolvedManifest.artifact.assetId,
        sha256: manifest.sha256,
        artifact_uri: manifestUri,
      },
      assets: media.map(([uri, artifact]) => ({
        asset_id: artifact.assetId,
        sha256: artifact.checksumSha256,
        artifact_uri: uri,
        kind: artifact.kind,
      })),
      output: {
        result_uri: `vf-local-run://${input.revision.projectRevisionId}/${input.revision.projectRevisionId}/videoforge-output.mp4`,
        filename: "videoforge-output.mp4",
      },
      tools: {
        ffmpeg_version: input.tools.ffmpegVersion,
        ffprobe_version: input.tools.ffprobeVersion,
      },
      cancel_token: `render-plan-${input.revision.projectRevisionId}`,
    },
    objects: [
      {
        artifact_receipt_id: input.resolvedManifest.artifact.receiptId,
        uri: manifestUri,
      },
      ...media.map(([uri, artifact]) => ({
        artifact_receipt_id: artifact.receiptId,
        uri,
      })),
    ],
  };
  if (
    !exactHostedRenderSubmission(
      payload,
      input.revision.projectId,
      input.revision.projectRevisionId,
    )
  ) {
    reject("HOSTED_RENDER_SUBMISSION_INVALID");
  }
  const payloadSha256 = await sha256(canonicalJson(payload));
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1, $2, true)", [
      "videoforge.account_id",
      input.accountId,
    ]);
    const inserted = await transaction.query(
      `INSERT INTO hosted_render_plans (
         account_id, workspace_id, project_id, project_revision_id,
         schema_version, payload, payload_sha256
       ) VALUES ($1,$2,$3,$4,'videoforge-hosted-cpu-submission/v1',$5::jsonb,$6)
       ON CONFLICT (account_id, workspace_id, project_id, project_revision_id) DO NOTHING`,
      [
        input.accountId,
        input.workspaceId,
        input.revision.projectId,
        input.revision.projectRevisionId,
        canonicalJson(payload),
        payloadSha256,
      ],
    );
    if (inserted.affectedRows === 1) return { payload, payloadSha256, replayed: false };
    const existing = await transaction.query<{
      payload: unknown;
      payload_sha256: string;
    }>(
      `SELECT payload, payload_sha256 FROM hosted_render_plans
        WHERE account_id = $1 AND workspace_id = $2 AND project_id = $3
          AND project_revision_id = $4`,
      [
        input.accountId,
        input.workspaceId,
        input.revision.projectId,
        input.revision.projectRevisionId,
      ],
    );
    const prior = existing.rows[0];
    if (
      !prior ||
      prior.payload_sha256 !== payloadSha256 ||
      canonicalJson(prior.payload) !== canonicalJson(payload)
    ) {
      reject("HOSTED_RENDER_PLAN_IDEMPOTENCY_CONFLICT");
    }
    return { payload, payloadSha256, replayed: true };
  });
}
