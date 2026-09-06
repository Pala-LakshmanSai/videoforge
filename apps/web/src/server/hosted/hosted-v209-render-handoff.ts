import { validateAndHashContractDocument } from "@videoforge/contracts";
import { planVNextResolvedRenderManifest, type AcceptedAssetBinding } from "@videoforge/pipeline";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";

import type { HostedR2BucketBinding } from "./configuration";
import { canonicalJson, exactHostedRenderSubmission, type HostedCpuSubmission } from "./submission";
import { HostedRenderPlanAppendDatabase } from "./hosted-serverless-callback";
import {
  materializeHostedRenderPlan,
  type HostedCommittedArtifact,
  type HostedRenderPlanMaterializationInput,
} from "./render-plan-materialization";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
  return value as RecordValue;
}

function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value)))
    throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
  return value;
}

async function sha256(bytes: ArrayBuffer): Promise<`sha256:${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function headSha256(value: ArrayBuffer | undefined): `sha256:${string}` | null {
  if (!value || value.byteLength !== 32) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

export async function ensureHostedV209ExactManifestObject(
  bucket: HostedR2BucketBinding,
  objectKey: string,
  bytes: ArrayBuffer,
  expectedSha256: `sha256:${string}`,
): Promise<void> {
  const prior = await bucket.head(objectKey);
  if (prior !== null) {
    const priorSha256 = headSha256(prior.checksums?.sha256);
    if (
      prior.size !== bytes.byteLength ||
      prior.httpMetadata?.contentType !== "application/json" ||
      (priorSha256 !== null && priorSha256 !== expectedSha256)
    ) {
      throw new Error("HOSTED_V209_RENDER_MANIFEST_DRIFT");
    }
  } else {
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { sha256: expectedSha256 },
    });
  }
  const [head, object] = await Promise.all([bucket.head(objectKey), bucket.get(objectKey)]);
  if (
    !head ||
    !object ||
    head.size !== bytes.byteLength ||
    object.size !== bytes.byteLength ||
    head.httpMetadata?.contentType !== "application/json" ||
    object.httpMetadata?.contentType !== "application/json"
  ) {
    throw new Error("HOSTED_V209_RENDER_MANIFEST_READBACK_INVALID");
  }
  const readback = await object.arrayBuffer();
  if (readback.byteLength !== bytes.byteLength || (await sha256(readback)) !== expectedSha256) {
    throw new Error("HOSTED_V209_RENDER_MANIFEST_READBACK_INVALID");
  }
}

function artifact(
  source: unknown,
  scope: { accountId: string; workspaceId: string; projectId: string; revisionId: string },
  extra: Pick<
    HostedCommittedArtifact,
    "lane" | "kind" | "taskKey" | "acceptedAttemptId" | "barrierAcceptance"
  >,
): HostedCommittedArtifact {
  const row = record(source);
  const contentLength = Number(row.contentLength);
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) {
    throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
  }
  if (
    (row.sourceScopeKind !== undefined && row.sourceScopeKind !== "SYSTEM") ||
    (row.sourceScopeKind === "SYSTEM" && row.systemSourceReferenceVerified !== true)
  ) {
    throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
  }
  return Object.freeze({
    accountId: scope.accountId,
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    projectRevisionId: scope.revisionId,
    lane: extra.lane,
    taskKey: extra.taskKey,
    assetId: text(row.assetId),
    receiptId: text(row.receiptId, UUID),
    objectKey: text(row.objectKey),
    contentType: text(row.contentType),
    contentLength,
    checksumSha256: text(row.sha256, SHA256),
    reservationState: "COMMITTED",
    receiptDeletedAt: null,
    acceptedAttemptId: extra.acceptedAttemptId,
    barrierAcceptance: extra.barrierAcceptance,
    kind: extra.kind,
    ...(row.sourceScopeKind === "SYSTEM"
      ? {
          systemSourceReference: Object.freeze({
            verified: true,
            avatarProfileId: text(row.systemAvatarProfileId, UUID),
            avatarProfileVersionId: text(row.systemAvatarProfileVersionId, UUID),
            runtimeSourceAssetId: text(row.systemRuntimeSourceAssetId, UUID),
            runtimeProfileAssetLinkId: text(row.systemRuntimeProfileAssetLinkId, UUID),
          }),
        }
      : {}),
  });
}

export function createHostedV209RenderHandoff(input: {
  readonly database: TransactionalSqlExecutor;
  readonly runtimeDatabase: TransactionalSqlExecutor;
  readonly bucket: HostedR2BucketBinding;
  readonly schedule: (submission: HostedCpuSubmission) => Promise<{ readonly state: string }>;
}) {
  return Object.freeze({
    async ensure(scope: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
    }) {
      const readyValue = await input.database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          scope.accountId,
        ]);
        const result = await transaction.query<{ ready: unknown }>(
          "SELECT public.videoforge_read_hosted_v209_ready_render_inputs($1::uuid,$2::uuid,$3::uuid) AS ready",
          [scope.accountId, scope.workspaceId, scope.generationRequestId],
        );
        return result.rows[0]?.ready ?? null;
      });
      if (readyValue === null) throw new Error("HOSTED_V209_RENDER_NOT_READY");
      const ready = record(readyValue);
      if (
        ready.schemaVersion !== "videoforge.hosted-v209-ready-render-inputs/v1" ||
        ready.accountId !== scope.accountId ||
        ready.workspaceId !== scope.workspaceId ||
        ready.generationRequestId !== scope.generationRequestId
      )
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      const revision = record(ready.revision);
      const revisionSnapshot = record(revision.snapshot);
      const revisionDocument = await validateAndHashContractDocument(
        "projectRevisionConfig",
        revision.document as never,
      );
      const timing = record(ready.timing);
      const transcript = await validateAndHashContractDocument(
        "transcriptTiming",
        timing.transcript as never,
      );
      const timeline = await validateAndHashContractDocument(
        "timelinePlan",
        timing.timeline as never,
      );
      if (
        revisionSnapshot.status !== "LOCKED" ||
        revisionSnapshot.id !== revisionDocument.value.project_revision_id ||
        revisionSnapshot.revision_config_hash !== revisionDocument.sha256 ||
        timing.transcriptSha256 !== transcript.sha256 ||
        timing.timelineSha256 !== timeline.sha256
      ) {
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      }
      const projectId = revisionDocument.value.project_id;
      const revisionId = revisionDocument.value.project_revision_id;
      const artifactScope = {
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        projectId,
        revisionId,
      };
      const voiceover = artifact(ready.voiceover, artifactScope, {
        lane: "INPUT",
        kind: "VOICEOVER",
        taskKey: null,
        acceptedAttemptId: null,
        barrierAcceptance: "COMMITTED_INPUT",
      });
      if (!Array.isArray(ready.acceptedVisuals))
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      const acceptedVisuals = ready.acceptedVisuals.map((value) => {
        const row = record(value);
        const lane =
          row.lane === "mage_image"
            ? "MAGE_IMAGE"
            : row.lane === "soulx_avatar"
              ? "SOULX_AVATAR"
              : null;
        if (!lane) throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
        return artifact(row, artifactScope, {
          lane,
          kind: lane === "MAGE_IMAGE" ? "IMAGE" : "AVATAR_CLIP",
          taskKey: text(row.taskKey),
          acceptedAttemptId: text(row.acceptedAttemptId, UUID),
          barrierAcceptance: "ACCEPTED_CANONICAL",
        });
      });
      if (new Set(acceptedVisuals.map((value) => value.taskKey)).size !== acceptedVisuals.length) {
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      }
      const acceptedBindings = Object.fromEntries(
        acceptedVisuals.map((value) => [
          value.taskKey!,
          {
            taskKey: value.taskKey!,
            assetId: value.assetId,
            sha256: value.checksumSha256 as AcceptedAssetBinding["sha256"],
            kind: value.kind as "IMAGE" | "AVATAR_CLIP",
            ...(value.kind === "AVATAR_CLIP"
              ? { rendererSourceProfile: "soulx-pro-vf924u-approved-v1" }
              : {}),
          } satisfies AcceptedAssetBinding,
        ]),
      );
      const planned = await planVNextResolvedRenderManifest({
        revision: revisionDocument,
        timeline,
        voiceover: {
          taskKey: "voiceover",
          assetId: voiceover.assetId,
          sha256: voiceover.checksumSha256 as AcceptedAssetBinding["sha256"],
          kind: "VOICEOVER",
        },
        acceptedAssets: { byTaskKey: acceptedBindings },
        renderProfileVersion: "ffmpeg-render-v3",
      });
      if (!planned.ok) throw new Error("HOSTED_V209_RENDER_PLAN_INVALID");
      const reservation = record(ready.manifestReservation);
      const reservationAssetId = text(reservation.assetId, UUID);
      text(reservation.reservationId, UUID);
      const objectKey = text(reservation.objectKey);
      const expectedObjectKey =
        `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${projectId}` +
        `/revision/${revisionId}/lane/render/job/${scope.generationRequestId}` +
        `/artifact/${reservationAssetId}`;
      if (objectKey !== expectedObjectKey) {
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      }
      const bytes = new TextEncoder().encode(canonicalJson(planned.value.value));
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      await ensureHostedV209ExactManifestObject(
        input.bucket,
        objectKey,
        buffer,
        planned.value.sha256,
      );
      const committedValue = await input.database.transaction(async (transaction) => {
        await transaction.query("SELECT set_config($1,$2,true)", [
          "videoforge.account_id",
          scope.accountId,
        ]);
        const result = await transaction.query<{ committed: unknown }>(
          `SELECT public.videoforge_commit_hosted_v209_resolved_render_manifest(
             $1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5,$6,$7::bigint) AS committed`,
          [
            scope.accountId,
            scope.workspaceId,
            scope.generationRequestId,
            canonicalJson(planned.value.value),
            planned.value.sha256,
            objectKey,
            bytes.byteLength,
          ],
        );
        return result.rows[0]?.committed;
      });
      const committed = record(committedValue);
      if (committed.schemaVersion !== "videoforge.hosted-v209-resolved-render-manifest/v1")
        throw new Error("HOSTED_V209_RENDER_COMMIT_INVALID");
      const manifestArtifact = artifact(record(committed.artifact), artifactScope, {
        lane: "RENDER",
        kind: "RESOLVED_RENDER_MANIFEST",
        taskKey: null,
        acceptedAttemptId: null,
        barrierAcceptance: "COMMITTED_MANIFEST",
      });
      if (
        manifestArtifact.objectKey !== objectKey ||
        manifestArtifact.checksumSha256 !== planned.value.sha256 ||
        manifestArtifact.contentType !== "application/json" ||
        manifestArtifact.contentLength !== bytes.byteLength
      ) {
        throw new Error("HOSTED_V209_RENDER_COMMIT_INVALID");
      }
      const avatarSource =
        ready.avatarSource === undefined
          ? undefined
          : artifact(ready.avatarSource, artifactScope, {
              lane: "INPUT",
              kind: "IMAGE",
              taskKey: null,
              acceptedAttemptId: null,
              barrierAcceptance: "COMMITTED_INPUT",
            });
      const materializationInput: HostedRenderPlanMaterializationInput = {
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        revision: {
          status: "LOCKED",
          projectId,
          projectRevisionId: revisionId,
          revisionConfigSha256: revisionDocument.sha256,
          avatarProfileVersionId: revisionDocument.value.avatar_binding.avatar_profile_version_id,
          avatarProfileHash: revisionDocument.value.avatar_binding.avatar_profile_hash,
          avatarRuntimeSourceSha256: revisionDocument.value.avatar_binding.runtime_source_sha256,
          imageStyleVersionId: revisionDocument.value.image_style_version_id,
          styleProfileHash: revisionDocument.value.style_profile_hash,
        },
        revisionDocument: revisionDocument.value,
        timing: {
          transcript: transcript.value,
          transcriptSha256: transcript.sha256,
          timeline: timeline.value,
          timelineSha256: timeline.sha256,
          timelineTranscriptSha256: text(timing.timelineTranscriptSha256, SHA256),
        },
        voiceover,
        ...(avatarSource ? { avatarSource } : {}),
        acceptedVisuals,
        resolvedManifest: { document: planned.value.value, artifact: manifestArtifact },
        tools: record(ready.tools) as HostedRenderPlanMaterializationInput["tools"],
      };
      const renderPlan = await materializeHostedRenderPlan(
        new HostedRenderPlanAppendDatabase(input.runtimeDatabase),
        materializationInput,
      );
      const submission = exactHostedRenderSubmission(renderPlan.payload, projectId, revisionId);
      if (!submission) throw new Error("HOSTED_V209_RENDER_SUBMISSION_INVALID");
      const scheduled = await input.schedule(submission);
      if (!["OUTBOXED", "RUNNING", "SUCCEEDED"].includes(scheduled.state))
        throw new Error("HOSTED_V209_RENDER_SCHEDULE_REJECTED");
      return Object.freeze({
        state: "RENDER_SCHEDULED" as const,
        payloadSha256: renderPlan.payloadSha256,
      });
    },
  });
}
