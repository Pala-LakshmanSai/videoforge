import { validateAndHashHostedContractDocument as validateAndHashContractDocument } from "./precompiled-contract-validation";
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

// Postgres also stores deterministic md5-derived UUIDs without RFC version bits.
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
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

export async function readHostedV209TimingDocument<
  Name extends "transcriptTiming" | "timelinePlan",
>(
  bucket: HostedR2BucketBinding,
  contractName: Name,
  projection: unknown,
  expectedSha256: unknown,
  revisionPrefix: string,
) {
  const asset = record(record(projection).asset);
  const objectKey = text(asset.object_key);
  const expectedHash = text(expectedSha256, SHA256);
  const expectedSize = Number(asset.byte_size);
  if (
    !objectKey.startsWith(revisionPrefix) ||
    asset.hash !== expectedHash ||
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1
  )
    throw new Error("HOSTED_V209_RENDER_TIMING_BINDING_INVALID");
  const object = await bucket.get(objectKey);
  if (!object || object.size !== expectedSize)
    throw new Error("HOSTED_V209_RENDER_TIMING_OBJECT_INVALID");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== expectedSize || (await sha256(bytes)) !== expectedHash)
    throw new Error("HOSTED_V209_RENDER_TIMING_OBJECT_INVALID");
  const document = await validateAndHashContractDocument(
    contractName,
    JSON.parse(new TextDecoder().decode(bytes)),
  );
  if (document.sha256 !== expectedHash) throw new Error("HOSTED_V209_RENDER_TIMING_OBJECT_INVALID");
  return document;
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

async function materializeFalWideSourceSnapshot(input: {
  database: TransactionalSqlExecutor;
  bucket: HostedR2BucketBinding;
  accountId: string;
  workspaceId: string;
  projectId: string;
  revisionId: string;
  avatarProfileVersionId: string;
  avatarProfileHash: string;
  sourceAssetId: string;
  sourceSha256: string;
}): Promise<unknown> {
  const sourceValue = await input.database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", input.accountId]);
    const result = await transaction.query<{ source: unknown }>(
      `SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,
          'objectKey',asset.object_key,'contentType',asset.content_type,
          'contentLength',asset.byte_size) AS source
         FROM public.avatar_profile_versions version
         JOIN public.assets asset ON asset.account_id=version.account_id
           AND asset.workspace_id=version.workspace_id AND asset.id=version.runtime_source_asset_id
        WHERE version.account_id=$1::uuid AND version.workspace_id=$2::uuid
          AND version.id=$3::uuid AND version.profile_hash=$4 AND version.state='READY'
          AND asset.id=$5::uuid AND asset.binary_sha256=$6
          AND asset.state IN ('VERIFIED','ACCEPTED')
          AND asset.kind IN ('AVATAR_ORIGINAL','AVATAR_RUNTIME')
          AND asset.content_type IN ('image/png','image/jpeg')`,
      [input.accountId, input.workspaceId, input.avatarProfileVersionId,
        input.avatarProfileHash, input.sourceAssetId, input.sourceSha256],
    );
    return result.rows[0]?.source;
  });
  if (sourceValue === undefined) throw new Error("HOSTED_V209_RENDER_SOURCE_MISSING");
  const source = record(sourceValue);
  const originalKey = text(source.objectKey);
  const length = Number(source.contentLength);
  const contentType = text(source.contentType);
  if (source.assetId !== input.sourceAssetId || source.sha256 !== input.sourceSha256 ||
      !Number.isSafeInteger(length) || length < 1 ||
      !["image/png", "image/jpeg"].includes(contentType))
    throw new Error("HOSTED_V209_RENDER_SOURCE_DRIFT");
  const original = await input.bucket.get(originalKey);
  if (!original || original.size !== length || original.httpMetadata?.contentType !== contentType)
    throw new Error("HOSTED_V209_RENDER_SOURCE_DRIFT");
  const bytes = await original.arrayBuffer();
  if (bytes.byteLength !== length || (await sha256(bytes)) !== input.sourceSha256)
    throw new Error("HOSTED_V209_RENDER_SOURCE_DRIFT");

  const snapshotKey = `tenant/${input.accountId}/workspace/${input.workspaceId}` +
    `/project/${input.projectId}/revision/${input.revisionId}` +
    `/lane/input/job/avatar-source/artifact/${input.sourceAssetId}`;
  const prior = await input.bucket.head(snapshotKey);
  if (prior && (prior.size !== length || prior.httpMetadata?.contentType !== contentType))
    throw new Error("HOSTED_V209_RENDER_SOURCE_SNAPSHOT_DRIFT");
  if (!prior)
    await input.bucket.put(snapshotKey, bytes, {
      httpMetadata: { contentType }, customMetadata: { sha256: input.sourceSha256 },
    });
  const readback = await input.bucket.get(snapshotKey);
  if (!readback || readback.size !== length ||
      readback.httpMetadata?.contentType !== contentType ||
      (await sha256(await readback.arrayBuffer())) !== input.sourceSha256)
    throw new Error("HOSTED_V209_RENDER_SOURCE_SNAPSHOT_DRIFT");

  const receiptSha = await sha256(new TextEncoder().encode(canonicalJson({
    kind: "fal-wide-source-snapshot/v1", revisionId: input.revisionId,
    assetId: input.sourceAssetId, objectKey: snapshotKey, checksum: input.sourceSha256,
  })).buffer as ArrayBuffer);
  return input.database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", ["videoforge.account_id", input.accountId]);
    await transaction.query(
      `INSERT INTO public.artifact_reservations
         (id,account_id,workspace_id,project_id,project_revision_id,asset_id,lane,
          job_id,artifact_id,object_key,method,content_type,content_length,checksum_sha256,
          expires_at,max_uses,used_count,state,retention_class,deletion_owner_account_id)
       VALUES (md5('fal-wide-source-reservation:'||$4::text)::uuid,$1::uuid,$2::uuid,$3::uuid,
          $4::uuid,$5::uuid,'INPUT','avatar-source',$5::text,$6,'PUT',$7,$8,$9,
          now()+interval '15 minutes',1,1,'COMMITTED','PROJECT',$1::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [input.accountId,input.workspaceId,input.projectId,input.revisionId,input.sourceAssetId,
        snapshotKey,contentType,length,input.sourceSha256],
    );
    await transaction.query(
      `INSERT INTO public.artifact_receipts
         (id,account_id,workspace_id,reservation_id,callback_id,object_key,
          content_type,content_length,checksum_sha256,probe,receipt_sha256,committed_at)
       SELECT md5('fal-wide-source-receipt:'||$3::text)::uuid,$1::uuid,$2::uuid,
          md5('fal-wide-source-reservation:'||$3::text)::uuid,'fal-wide-source:'||$3::text,
          $4,$5,$6,$7,'{}'::jsonb,$8,now()
        WHERE NOT EXISTS (SELECT 1 FROM public.artifact_receipts
          WHERE id=md5('fal-wide-source-receipt:'||$3::text)::uuid)
       ON CONFLICT (id) DO NOTHING`,
      [input.accountId,input.workspaceId,input.revisionId,snapshotKey,contentType,length,
        input.sourceSha256,receiptSha],
    );
    const result = await transaction.query<{ source: unknown }>(
      `SELECT jsonb_build_object('assetId',asset.id,'sha256',asset.binary_sha256,
          'objectKey',receipt.object_key,'contentType',receipt.content_type,
          'contentLength',receipt.content_length,'receiptId',receipt.id) AS source
         FROM public.artifact_reservations reservation
         JOIN public.artifact_receipts receipt ON receipt.account_id=reservation.account_id
           AND receipt.workspace_id=reservation.workspace_id
           AND receipt.reservation_id=reservation.id AND receipt.deleted_at IS NULL
         JOIN public.assets asset ON asset.account_id=reservation.account_id
           AND asset.workspace_id=reservation.workspace_id AND asset.id=reservation.asset_id
        WHERE reservation.id=md5('fal-wide-source-reservation:'||$4::text)::uuid
          AND receipt.id=md5('fal-wide-source-receipt:'||$4::text)::uuid
          AND reservation.account_id=$1::uuid AND reservation.workspace_id=$2::uuid
          AND reservation.project_id=$3::uuid AND reservation.project_revision_id=$4::uuid
          AND reservation.asset_id=$5::uuid AND reservation.object_key=$6
          AND reservation.method='PUT' AND reservation.state='COMMITTED'
          AND receipt.object_key=$6 AND receipt.content_type=$7
          AND receipt.content_length=$8 AND receipt.checksum_sha256=$9
          AND receipt.receipt_sha256=$10 AND asset.binary_sha256=$9`,
      [input.accountId,input.workspaceId,input.projectId,input.revisionId,input.sourceAssetId,
        snapshotKey,contentType,length,input.sourceSha256,receiptSha],
    );
    if (result.rows[0]?.source === undefined)
      throw new Error("HOSTED_V209_RENDER_SOURCE_SNAPSHOT_DRIFT");
    return result.rows[0].source;
  });
}

function artifact(
  source: unknown,
  scope: { accountId: string; workspaceId: string; projectId: string; revisionId: string },
  extra: Pick<
    HostedCommittedArtifact,
    "lane" | "kind" | "taskKey" | "acceptedAttemptId" | "barrierAcceptance"
  > &
    Partial<Pick<HostedCommittedArtifact, "generationTaskId">>,
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
    ...(extra.generationTaskId ? { generationTaskId: extra.generationTaskId } : {}),
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
      const revisionPrefix = `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${revisionDocument.value.project_id}/revision/${revisionDocument.value.project_revision_id}/`;
      const [transcript, timeline] = await Promise.all([
        readHostedV209TimingDocument(
          input.bucket,
          "transcriptTiming",
          timing.transcript,
          timing.transcriptSha256,
          revisionPrefix,
        ),
        readHostedV209TimingDocument(
          input.bucket,
          "timelinePlan",
          timing.timeline,
          timing.timelineSha256,
          revisionPrefix,
        ),
      ]);
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
      const rawAcceptedVisuals = ready.acceptedVisuals;
      if (!Array.isArray(rawAcceptedVisuals)) throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      const acceptedVisuals = rawAcceptedVisuals.map((value) => {
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
          generationTaskId: row.taskId === undefined ? undefined : text(row.taskId, UUID),
          barrierAcceptance: "ACCEPTED_CANONICAL",
        });
      });
      if (new Set(acceptedVisuals.map((value) => value.taskKey)).size !== acceptedVisuals.length) {
        throw new Error("HOSTED_V209_RENDER_INPUT_INVALID");
      }
      const acceptedBindings = Object.fromEntries(
        acceptedVisuals.map((value, index) => [
          value.taskKey!,
          {
            taskKey: value.taskKey!,
            assetId: value.assetId,
            sha256: value.checksumSha256 as AcceptedAssetBinding["sha256"],
            kind: value.kind as "IMAGE" | "AVATAR_CLIP",
            ...(value.kind === "AVATAR_CLIP"
              ? {
                  ...(record(rawAcceptedVisuals[index]).rendererSourceProfile ===
                  "fal-flashhead-512x512p25-v1"
                    ? {
                        avatarTrimStartMs: record(rawAcceptedVisuals[index])
                          .avatarTrimStartMs as number,
                        avatarSelectedStartMs: record(rawAcceptedVisuals[index])
                          .avatarSelectedStartMs as number,
                      }
                    : {}),
                  rendererSourceProfile:
                    record(rawAcceptedVisuals[index]).rendererSourceProfile ===
                    "fal-flashhead-512x512p25-v1"
                      ? "fal-flashhead-512x512p25-wide-v2"
                      : "soulx-pro-vf924u-approved-v1",
                }
              : {}),
          } satisfies AcceptedAssetBinding,
        ]),
      );
      const planned = await planVNextResolvedRenderManifest({
        contractDocumentAuthority: { validateAndHash: validateAndHashContractDocument },
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
      const needsFalWideSource = Object.values(acceptedBindings).some(
        (binding) => binding.rendererSourceProfile === "fal-flashhead-512x512p25-wide-v2",
      );
      const falWideSource = needsFalWideSource
        ? await materializeFalWideSourceSnapshot({
            database: input.runtimeDatabase,
            bucket: input.bucket,
            accountId: scope.accountId,
            workspaceId: scope.workspaceId,
            projectId,
            revisionId,
            avatarProfileVersionId: revisionDocument.value.avatar_binding.avatar_profile_version_id,
            avatarProfileHash: revisionDocument.value.avatar_binding.avatar_profile_hash,
            sourceAssetId: revisionDocument.value.avatar_binding.runtime_source_asset_id,
            sourceSha256: revisionDocument.value.avatar_binding.runtime_source_sha256,
          })
        : undefined;
      if (needsFalWideSource && falWideSource === undefined)
        throw new Error("HOSTED_V209_RENDER_SOURCE_MISSING");
      const avatarSource =
        (falWideSource ?? ready.avatarSource) === undefined
          ? undefined
          : artifact(falWideSource ?? ready.avatarSource, artifactScope, {
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
