import type { ResolvedRenderManifestDocument } from "@videoforge/contracts";
import type { TechnicalProbeDocument } from "@videoforge/contracts/generated/contract-types.js";
import manifestFixture from "@videoforge/contracts/generated/fixtures/resolved_render_manifest.valid.json";
import soulxApprovedFixture from "@videoforge/contracts/generated/fixtures/resolved_render_manifest.soulx-approved.valid.json";
import {
  FakeServerlessEndpoint,
  FakeServerlessTransport,
  canonicalSha256,
  digestUtf8,
  type EndpointDeploymentInput,
  type ServerlessLane,
  type Sha256,
} from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  acceptHostedShortPilot,
  admitHostedShortPilot,
  claimHostedShortPilotSubmission,
  createHostedShortPilotTransactionalRepository,
  hostedShortPilotAdmissionRequestSha256,
  HostedShortPilotError,
  type HostedShortPilotAcceptanceEvidence,
  type HostedShortPilotAdmission,
  type HostedShortPilotAdmissionDocument,
  type HostedShortPilotAdmissionInput,
  type HostedShortPilotBarrierVerification,
  type HostedShortPilotBarrierVerifier,
  type HostedShortPilotDurableKey,
  type HostedShortPilotDurableRecord,
  type HostedShortPilotRepository,
  type HostedShortPilotOutputVerification,
  type HostedShortPilotOutputVerifier,
  type HostedShortPilotTerminalVerification,
  type HostedShortPilotTransaction,
  type HostedShortPilotTransactionalStore,
} from "./hosted-short-pilot.js";
import type {
  HostedQualificationLineage,
  HostedQualificationVerification,
  HostedQualificationVerifier,
  HostedServerlessLaneBinding,
} from "./hosted-serverless-runtime.js";

type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
const sha = (label: string): Sha256 => canonicalSha256({ label });
const NOW = "2026-08-25T12:00:00.000Z";

function binding(lane: ServerlessLane): HostedServerlessLaneBinding {
  const lineage: HostedQualificationLineage = {
    endpointIdSha256: sha(`${lane}-endpoint`),
    endpointTemplateIdSha256: sha(`${lane}-template`),
    endpointConfigSha256: sha(`${lane}-config`),
    workerImageDigest: sha(`${lane}-image`),
    modelManifestSha256: sha(`${lane}-model`),
    volumeIdSha256: sha(`${lane}-volume`),
    volumeManifestSha256: sha(`${lane}-volume-manifest`),
    imageSourceCommit: "a".repeat(40),
    qualificationSourceSha256: sha(`${lane}-source`),
    dependencyLockSha256: sha(`${lane}-lock`),
    acceptanceContractSha256: sha(`${lane}-contract`),
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    max1GateConfigSha256: sha(`${lane}-max1-gate`),
    max1EndpointProfileSha256: sha(`${lane}-max1-profile`),
    max2GateConfigSha256: sha(`${lane}-max2-gate`),
    max2EndpointProfileSha256: sha(`${lane}-max2-profile`),
  };
  const deployment: EndpointDeploymentInput = {
    deploymentId: `deployment-${lane}`,
    lane,
    endpointProfileId: `template:${lineage.endpointTemplateIdSha256}`,
    endpointIdSha256: lineage.endpointIdSha256,
    endpointConfigSha256: lineage.endpointConfigSha256,
    workerImageDigest: lineage.workerImageDigest,
    modelManifestSha256: lineage.modelManifestSha256,
    volumeIdSha256: lineage.volumeIdSha256,
    volumeManifestSha256: lineage.volumeManifestSha256,
    idleTimeoutSeconds: 5,
    initTimeoutSeconds: 800,
    executionTimeoutSeconds: 2_400,
    requestTtlSeconds: 7_200,
    reconciliationDeadlineSeconds: 1_500,
    pollingIntervalSeconds: 5,
    maxReplacementAttempts: 1,
    timeoutEvidence: { source: "test", sealed_lineage: lineage },
    deploymentVersion: 1,
    createdAt: "2026-08-25T10:00:00.000Z",
  };
  return {
    deployment,
    transportEndpointIdSha256: lineage.endpointIdSha256,
    transport: new FakeServerlessTransport(
      new FakeServerlessEndpoint({
        endpointIdSha256: lineage.endpointIdSha256,
        callbackTokenSha256: sha(`${lane}-callback`),
      }),
    ),
    qualificationArtifact: { schema_version: "qualification/v1", lane },
  };
}

const bindings = { mage_image: binding("mage_image"), soulx_avatar: binding("soulx_avatar") };

function verification(bound: HostedServerlessLaneBinding): HostedQualificationVerification {
  return {
    verifierId: "videoforge-independent-qualification-v1",
    accepted: true,
    lane: bound.deployment.lane,
    checkpointId: bound.deployment.lane === "mage_image" ? "V2-07" : "V2-08",
    canonicalArtifactSha256: canonicalSha256(bound.qualificationArtifact),
    verifiedAt: "2026-08-25T11:00:00.000Z",
    expiresAt: "2026-08-25T13:00:00.000Z",
    lineage: bound.deployment.timeoutEvidence.sealed_lineage as HostedQualificationLineage,
  };
}

function verifier(
  transform?: (value: HostedQualificationVerification) => HostedQualificationVerification,
): HostedQualificationVerifier {
  return {
    verify: vi.fn(async (artifact) => {
      const lane = artifact.lane as ServerlessLane;
      const value = verification(bindings[lane]);
      return transform?.(value) ?? value;
    }),
  };
}

function renderPlan(): ResolvedRenderManifestDocument {
  const plan = structuredClone(manifestFixture) as Mutable<ResolvedRenderManifestDocument>;
  plan.total_frames = 7_200;
  plan.segments[0]!.end_frame_exclusive = 1_800;
  plan.segments[1]!.start_frame = 1_800;
  plan.segments[1]!.end_frame_exclusive = 4_800;
  plan.segments[2]!.start_frame = 4_800;
  plan.segments[2]!.end_frame_exclusive = 7_200;
  const avatarFull = plan.segments[0];
  if (avatarFull?.timeline_composition === "AVATAR_FULL") {
    avatarFull.render.avatar_source_profile =
      "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1";
    avatarFull.render.avatar_crop = "992:558:16:0";
  }
  const split = plan.segments[2];
  if (split?.timeline_composition === "AVATAR_SPLIT_IMAGE") {
    split.render.avatar_source_profile = "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1";
    split.render.avatar_crop = "496:558:280:0";
  }
  return plan;
}

function candidate(): HostedShortPilotAdmissionInput {
  return {
    accountId: "account-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    projectRevisionId: "revision_fixture_001",
    revisionConfigSha256: manifestFixture.revision_config_hash as Sha256,
    renderPlanDocument: renderPlan(),
    qualifications: bindings,
    ceiling: { maximumVariableCostMicroUsd: 2_000_000, maximumWallTimeMs: 900_000 },
    forecast: { variableCostMicroUsd: 800_000, wallTimeMs: 600_000 },
  };
}

function approvedCandidate(): HostedShortPilotAdmissionInput {
  const plan = structuredClone(soulxApprovedFixture) as Mutable<ResolvedRenderManifestDocument>;
  plan.total_frames = 7_200;
  plan.segments[0]!.end_frame_exclusive = 1_800;
  plan.segments[1]!.start_frame = 1_800;
  plan.segments[1]!.end_frame_exclusive = 7_200;
  return {
    ...candidate(),
    projectRevisionId: plan.project_revision_id,
    revisionConfigSha256: plan.revision_config_hash as Sha256,
    renderPlanDocument: plan,
  };
}

function barrierVerifier(
  candidateValue: HostedShortPilotAdmissionInput,
  transform?: (value: HostedShortPilotBarrierVerification) => HostedShortPilotBarrierVerification,
): HostedShortPilotBarrierVerifier {
  return {
    verify: vi.fn(async ({ lane }) => {
      const attemptId = `${lane}-accepted-attempt`;
      const expected = new Map<string, Sha256>();
      for (const segment of candidateValue.renderPlanDocument.segments) {
        if (segment.timeline_composition === "IMAGE_FULL" && lane === "mage_image") {
          expected.set(
            segment.accepted_assets.image.asset_id,
            segment.accepted_assets.image.sha256 as Sha256,
          );
        } else if (segment.timeline_composition === "AVATAR_FULL" && lane === "soulx_avatar") {
          expected.set(
            segment.accepted_assets.avatar.asset_id,
            segment.accepted_assets.avatar.sha256 as Sha256,
          );
        } else if (segment.timeline_composition === "AVATAR_SPLIT_IMAGE") {
          const asset =
            lane === "mage_image"
              ? segment.accepted_assets.right_image
              : segment.accepted_assets.avatar;
          expected.set(asset.asset_id, asset.sha256 as Sha256);
        }
      }
      const value: HostedShortPilotBarrierVerification = {
        verifierId: "videoforge-hosted-output-barrier-verifier-v1",
        accepted: true,
        lane,
        checkpointId: lane === "mage_image" ? "V2-07" : "V2-08",
        attemptId,
        canonicalBarrierAcceptanceSha256: sha(`${lane}-barrier`),
        durableInventorySha256: sha(`${lane}-inventory`),
        artifacts: [...expected].map(([assetId, artifactSha256]) => ({
          assetId,
          objectKey: `tenant/${candidateValue.accountId}/workspace/${candidateValue.workspaceId}/project/${candidateValue.projectId}/revision/${candidateValue.projectRevisionId}/lane/${lane.replace("_", "-")}/job/${attemptId}/artifact/${assetId}`,
          sha256: artifactSha256,
          contentType: lane === "mage_image" ? ("image/png" as const) : ("video/mp4" as const),
        })),
        soulxProfile:
          lane === "mage_image"
            ? null
            : candidateValue.renderPlanDocument.soulx_crop_profile_approval
              ? {
                  sourceProfile: "soulx-pro-vf924u-approved-v1",
                  fullCrop: null,
                  splitCrop: "448:504:32:4",
                  acceptanceContractSha256: (
                    bindings.soulx_avatar.deployment.timeoutEvidence
                      .sealed_lineage as HostedQualificationLineage
                  ).acceptanceContractSha256,
                  cropProfileEvidenceSha256:
                    candidateValue.renderPlanDocument.soulx_crop_profile_approval.candidate_sha256,
                  cropProfileApprovalSha256:
                    candidateValue.renderPlanDocument.soulx_crop_profile_approval.approval_sha256,
                }
              : {
                  sourceProfile: "echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1",
                  fullCrop: "992:558:16:0",
                  splitCrop: "496:558:280:0",
                  acceptanceContractSha256: (
                    bindings.soulx_avatar.deployment.timeoutEvidence
                      .sealed_lineage as HostedQualificationLineage
                  ).acceptanceContractSha256,
                  cropProfileEvidenceSha256: sha("soulx-crop-profile"),
                  cropProfileApprovalSha256: sha("legacy-no-approval"),
                },
      };
      return transform?.(value) ?? value;
    }),
  };
}

const keyString = (key: HostedShortPilotDurableKey) => Object.values(key).join("|");
const recordKey = (record: HostedShortPilotDurableRecord) =>
  keyString({
    accountId: record.accountId,
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    projectRevisionId: record.projectRevisionId,
    renderPlanSha256: record.renderPlanSha256,
  });
class AsyncTransactionalRepository implements HostedShortPilotRepository {
  readonly records = new Map<string, HostedShortPilotDurableRecord>();
  mintCount = 0;
  transactionCount = 0;
  private tail: Promise<void> = Promise.resolve();

  private async transaction<Value>(work: () => Value): Promise<Value> {
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    this.transactionCount += 1;
    await Promise.resolve();
    try {
      return work();
    } finally {
      release();
    }
  }

  async createOrReplay(
    key: HostedShortPilotDurableKey,
    admissionDocument: HostedShortPilotAdmissionDocument,
  ) {
    return this.transaction(() => {
      const id = keyString(key);
      const existing = this.records.get(id);
      if (existing) return { record: existing, replayed: true };
      const revisionRecord = [...this.records.values()].find(
        (record) =>
          record.accountId === key.accountId &&
          record.workspaceId === key.workspaceId &&
          record.projectId === key.projectId &&
          record.projectRevisionId === key.projectRevisionId,
      );
      if (revisionRecord) return { record: revisionRecord, replayed: true };
      this.mintCount += 1;
      const submissionToken = `short-pilot:00000000-0000-4000-8000-${String(this.mintCount).padStart(12, "0")}`;
      const record: HostedShortPilotDurableRecord = {
        ...key,
        requestSha256: admissionDocument.requestSha256,
        admissionDocument,
        admissionDocumentSha256: canonicalSha256(admissionDocument),
        submissionToken,
        submissionTokenSha256: digestUtf8(submissionToken),
        automaticAttemptId: `pilot-attempt-${this.mintCount}`,
        state: "READY",
        submissionCount: 0,
        acceptanceSha256: null,
      };
      this.records.set(id, record);
      return { record, replayed: false };
    });
  }

  async claimSubmission(key: HostedShortPilotDurableKey, requestSha256: Sha256) {
    return this.transaction(() => {
      const record = this.records.get(keyString(key));
      if (!record || record.requestSha256 !== requestSha256 || record.state !== "READY")
        return null;
      const submitted = { ...record, state: "SUBMITTED" as const, submissionCount: 1 as const };
      this.records.set(keyString(key), submitted);
      return submitted;
    });
  }

  async read(key: HostedShortPilotDurableKey) {
    return this.transaction(() => this.records.get(keyString(key)) ?? null);
  }

  async accept(key: HostedShortPilotDurableKey, requestSha256: Sha256, acceptanceSha256: Sha256) {
    return this.transaction(() => {
      const record = this.records.get(keyString(key));
      if (!record || record.requestSha256 !== requestSha256) return null;
      if (record.state === "ACCEPTED")
        return record.acceptanceSha256 === acceptanceSha256 ? record : null;
      if (record.state !== "SUBMITTED") return null;
      const accepted = { ...record, state: "ACCEPTED" as const, acceptanceSha256 };
      this.records.set(keyString(key), accepted);
      return accepted;
    });
  }
}

class SerializedDurableStore implements HostedShortPilotTransactionalStore {
  readonly rows = new Map<string, HostedShortPilotDurableRecord>();
  transactionCount = 0;
  private tail: Promise<void> = Promise.resolve();

  async transaction<Value>(
    work: (transaction: HostedShortPilotTransaction) => Promise<Value>,
  ): Promise<Value> {
    const prior = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prior;
    this.transactionCount += 1;
    const transaction: HostedShortPilotTransaction = {
      findRevision: async (key) =>
        [...this.rows.values()].find(
          (row) =>
            row.accountId === key.accountId &&
            row.workspaceId === key.workspaceId &&
            row.projectId === key.projectId &&
            row.projectRevisionId === key.projectRevisionId,
        ) ?? null,
      insert: async (record) => {
        if (this.rows.has(recordKey(record))) return false;
        this.rows.set(recordKey(record), record);
        return true;
      },
      compareAndSet: async (key, expectedState, replacement) => {
        const current = this.rows.get(keyString(key));
        if (!current || current.state !== expectedState) return false;
        this.rows.set(keyString(key), replacement);
        return true;
      },
    };
    try {
      return await work(transaction);
    } finally {
      release();
    }
  }
}

async function admission(
  repository = new AsyncTransactionalRepository(),
  candidateValue = candidate(),
) {
  const value = await admitHostedShortPilot({
    repository,
    verifier: verifier(),
    barrierVerifier: barrierVerifier(candidateValue),
    candidate: candidateValue,
    now: () => new Date(NOW),
  });
  return { value, repository };
}

async function groundworkBoundaryAdmission(repository: HostedShortPilotRepository) {
  const plan = renderPlan();
  const key: HostedShortPilotDurableKey = {
    accountId: "account-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    projectRevisionId: "revision_fixture_001",
    renderPlanSha256: canonicalSha256(plan),
  };
  const base = {
    key,
    revisionConfigSha256: manifestFixture.revision_config_hash as Sha256,
    qualificationSha256s: { mage_image: sha("mage-q"), soulx_avatar: sha("soulx-q") },
    barrierAcceptanceSha256s: {
      mage_image: sha("mage-barrier"),
      soulx_avatar: sha("soulx-barrier"),
    },
    renderPlanDocument: plan,
    totalFrames: 7_200,
    expectedCutCount: 2,
    maximumVariableCostMicroUsd: 2_000_000,
    maximumWallTimeMs: 900_000,
    forecastVariableCostMicroUsd: 800_000,
    forecastWallTimeMs: 600_000,
  } as const;
  const requestSha256 = hostedShortPilotAdmissionRequestSha256(base);
  const admissionDocument: HostedShortPilotAdmissionDocument = {
    schemaVersion: "videoforge-hosted-short-pilot-admission-document/v1",
    ...base,
    requestSha256,
  };
  const { record } = await repository.createOrReplay(key, admissionDocument);
  const admitted: HostedShortPilotAdmission = {
    schemaVersion: "videoforge-hosted-short-pilot-admission/v2",
    groundworkOnly: true,
    key,
    revisionConfigSha256: base.revisionConfigSha256,
    qualificationSha256s: base.qualificationSha256s,
    barrierAcceptanceSha256s: base.barrierAcceptanceSha256s,
    totalFrames: 7_200,
    expectedCutCount: 2,
    maximumVariableCostMicroUsd: 2_000_000,
    maximumWallTimeMs: 900_000,
    requestSha256,
    submissionToken: record.submissionToken,
    submissionTokenSha256: record.submissionTokenSha256,
    automaticAttemptId: record.automaticAttemptId,
    submissionState: record.state,
    submissionCount: record.submissionCount,
    replayed: false,
  };
  return admitted;
}

function probe(outputSha256 = sha("output")): TechnicalProbeDocument {
  return {
    schema_version: "technical-probe/v1",
    asset_id: "pilot-output",
    sha256: outputSha256,
    bytes: 10_000,
    container: "mp4",
    duration_ms: 240_000,
    total_frames: 7_200,
    video: {
      codec: "h264",
      pixel_format: "yuv420p",
      width: 1920,
      height: 1080,
      fps_num: 30,
      fps_den: 1,
      start_ms: 0,
    },
    audio: { codec: "aac", sample_rate_hz: 48_000, channels: 2, start_ms: 0 },
    stream_counts: { video: 1, audio: 1, subtitle: 0, data: 0 },
    av_drift_ms: 0,
    decode_ok: true,
    loudness: {
      profile: "voiceover-minus16lufs-v1",
      normalized: true,
      input_integrated_lufs: -18,
      input_true_peak_dbtp: -2,
      output_integrated_lufs: -16,
      output_true_peak_dbtp: -2,
    },
    tools: { ffmpeg_version: "7.1", ffprobe_version: "7.1", filtergraph_sha256: sha("filter") },
  };
}

function evidence(admitted: HostedShortPilotAdmission): HostedShortPilotAcceptanceEvidence {
  return {
    rawEvidence: {
      schema_version: "signed-terminal-inventory/v1",
      attempt_id: admitted.automaticAttemptId,
      inventory_receipt: "durable-inventory-receipt-1",
    },
  };
}

function outputVerifier(
  admitted: HostedShortPilotAdmission,
  transform?: (value: HostedShortPilotOutputVerification) => HostedShortPilotOutputVerification,
): HostedShortPilotOutputVerifier {
  return {
    verify: vi.fn(async (raw) => {
      if (
        raw.schema_version !== "signed-terminal-inventory/v1" ||
        raw.attempt_id !== admitted.automaticAttemptId
      )
        throw new Error("invalid terminal evidence");
      const canonicalEvidenceSha256 = canonicalSha256(raw);
      const verifierSignatureSha256 = sha("output-verifier-signature");
      const durableInventorySha256 = sha("terminal-durable-inventory");
      const terminal: HostedShortPilotTerminalVerification = {
        verifierId: "videoforge-hosted-terminal-inventory-verifier-v1",
        accepted: true,
        canonicalEvidenceSha256,
        verifierSignatureSha256,
        durableInventorySha256,
        accountId: admitted.key.accountId,
        workspaceId: admitted.key.workspaceId,
        projectId: admitted.key.projectId,
        projectRevisionId: admitted.key.projectRevisionId,
        attemptId: admitted.automaticAttemptId,
        submissionTokenSha256: admitted.submissionTokenSha256,
        state: "SUCCEEDED",
        terminalAt: "2026-08-25T12:10:00.000Z",
        activeWorkers: 0,
        observedAt: "2026-08-25T12:11:00.000Z",
      };
      const outputSha256 = sha("output");
      const value: HostedShortPilotOutputVerification = {
        verifierId: "videoforge-hosted-short-pilot-output-verifier-v1",
        accepted: true,
        canonicalEvidenceSha256,
        verifierSignatureSha256,
        durableInventorySha256,
        output: {
          state: "COMMITTED",
          assetId: "pilot-output",
          objectKey: `tenant/${admitted.key.accountId}/workspace/${admitted.key.workspaceId}/project/${admitted.key.projectId}/revision/${admitted.key.projectRevisionId}/lane/render/job/${admitted.automaticAttemptId}/artifact/pilot-output.mp4`,
          sha256: outputSha256,
          bytes: 10_000,
          contentType: "video/mp4",
          artifactCommitReceiptSha256: sha("commit"),
        },
        privateReadback: {
          state: "GET_REHASH_SUCCEEDED",
          sha256: outputSha256,
          bytes: 10_000,
          contentType: "video/mp4",
          readbackReceiptSha256: sha("readback"),
        },
        technicalProbe: probe(outputSha256),
        qualityReview: {
          state: "ACCEPTED",
          reviewArtifactSha256: sha("review"),
          reviewedCutCount: 2,
          everyCutReviewed: true,
          noManualMediaEditOrSubstitution: true,
          literalRelevance: "PASSED",
          imageRealism: "PASSED",
          avatarIdentityAndCrop: "PASSED",
          lipSync: "PASSED",
          audioVideoQuality: "PASSED",
          prohibitedGraphicsAbsent: "PASSED",
          hardCutsOnly: "PASSED",
          requiredImageZoom: "PASSED",
        },
        settlement: {
          state: "SETTLED",
          variableCostMicroUsd: 900_000,
          possibleDuplicateCostMicroUsd: 0,
          elapsedWallTimeMs: 700_000,
        },
        terminal,
      };
      return transform?.(value) ?? value;
    }),
  };
}

const code = async (action: () => unknown | Promise<unknown>) => {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HostedShortPilotError);
    return (error as HostedShortPilotError).code;
  }
  throw new Error("expected error");
};

describe("hosted short pilot durable groundwork", () => {
  it("admits only the exact approved SoulX full/split profile with bound qualification evidence", async () => {
    const repository = new AsyncTransactionalRepository();
    const { value } = await admission(repository, approvedCandidate());

    expect(value).toMatchObject({
      groundworkOnly: true,
      submissionState: "READY",
      submissionCount: 0,
      replayed: false,
      totalFrames: 7_200,
      expectedCutCount: 1,
    });
    expect(repository.mintCount).toBe(1);
  });

  it("rejects approved-profile barrier evidence when its exact user approval hash drifts", async () => {
    const repository = new AsyncTransactionalRepository();
    const candidateValue = approvedCandidate();
    expect(
      await code(() =>
        admitHostedShortPilot({
          repository,
          verifier: verifier(),
          barrierVerifier: barrierVerifier(candidateValue, (value) =>
            value.lane === "soulx_avatar" && value.soulxProfile
              ? {
                  ...value,
                  soulxProfile: {
                    ...value.soulxProfile,
                    cropProfileApprovalSha256: sha("foreign-approval"),
                  },
                }
              : value,
          ),
          candidate: candidateValue,
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("SHORT_PILOT_QUALIFICATION_REJECTED");
    expect(repository.mintCount).toBe(0);
  });

  it.each([
    ["echomimic-v3-flash-turbo-fp8-centered-1024x560p25-v1", "992:558:16:0", "496:558:280:0"],
    ["avatarforcing-centered-832x480p25-v1", "832:468:0:6", "416:468:208:6"],
    ["skyreels-centered-960x960p25-v2", "960:540:0:210", "480:540:240:210"],
  ] as const)(
    "blocks current legacy profile %s before durable admission",
    async (profile, fullCrop, splitCrop) => {
      const base = candidate();
      const plan = structuredClone(
        base.renderPlanDocument,
      ) as Mutable<ResolvedRenderManifestDocument>;
      const full = plan.segments[0];
      const split = plan.segments[2];
      if (full?.timeline_composition === "AVATAR_FULL") {
        full.render.avatar_source_profile = profile;
        full.render.avatar_crop = fullCrop;
      }
      if (split?.timeline_composition === "AVATAR_SPLIT_IMAGE") {
        split.render.avatar_source_profile = profile;
        split.render.avatar_crop = splitCrop;
      }
      const candidateValue = { ...base, renderPlanDocument: plan };
      const repository = new AsyncTransactionalRepository();
      expect(await code(() => admission(repository, candidateValue))).toBe(
        "SHORT_PILOT_QUALIFICATION_REJECTED",
      );
      expect(repository.mintCount).toBe(0);
    },
  );

  it("rejects a forged canonical qualification result", async () => {
    const repository = new AsyncTransactionalRepository();
    expect(
      await code(() =>
        admitHostedShortPilot({
          repository,
          verifier: verifier((value) => ({ ...value, canonicalArtifactSha256: sha("forged") })),
          barrierVerifier: barrierVerifier(candidate()),
          candidate: candidate(),
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("SHORT_PILOT_QUALIFICATION_REJECTED");
    expect(repository.mintCount).toBe(0);
  });

  it("serializes concurrent create, claim, and idempotent acceptance transactions", async () => {
    const store = new SerializedDurableStore();
    const mint = vi.fn(() => ({
      submissionToken: "short-pilot:00000000-0000-4000-8000-000000000001",
      automaticAttemptId: "pilot-attempt-transactional",
    }));
    const repository = createHostedShortPilotTransactionalRepository({ store, mint });
    const [first, second] = await Promise.all([
      groundworkBoundaryAdmission(repository),
      groundworkBoundaryAdmission(repository),
    ]);
    expect(second.submissionToken).toBe(first.submissionToken);
    expect(mint).toHaveBeenCalledTimes(1);
    const claims = await Promise.allSettled([
      claimHostedShortPilotSubmission(repository, first),
      claimHostedShortPilotSubmission(repository, second),
    ]);
    expect(claims.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(claims.filter((result) => result.status === "rejected")).toHaveLength(1);
    const accepted = await Promise.all([
      acceptHostedShortPilot(repository, outputVerifier(first), first, evidence(first)),
      acceptHostedShortPilot(repository, outputVerifier(first), first, evidence(first)),
    ]);
    expect(accepted[0].acceptanceSha256).toBe(accepted[1].acceptanceSha256);
    expect(await repository.accept(first.key, first.requestSha256, sha("divergent"))).toBeNull();
    expect(store.transactionCount).toBeGreaterThanOrEqual(8);
  });

  it("rejects canonical render-plan drift and overlay fields", async () => {
    const base = candidate();
    const plan = structuredClone(base.renderPlanDocument) as unknown as Record<string, unknown>;
    plan.overlay = {
      text: "forbidden",
    };
    const drifted = {
      ...base,
      renderPlanDocument: plan as unknown as ResolvedRenderManifestDocument,
    };
    expect(await code(() => admission(new AsyncTransactionalRepository(), drifted))).toBe(
      "SHORT_PILOT_RENDER_PLAN_INVALID",
    );
  });

  it("rejects a forged barrier artifact hash before any token is minted", async () => {
    const repository = new AsyncTransactionalRepository();
    const candidateValue = candidate();
    expect(
      await code(() =>
        admitHostedShortPilot({
          repository,
          verifier: verifier(),
          barrierVerifier: barrierVerifier(candidateValue, (value) =>
            value.lane === "mage_image"
              ? {
                  ...value,
                  artifacts: value.artifacts.map((artifact, index) =>
                    index === 0 ? { ...artifact, sha256: sha("forged-artifact") } : artifact,
                  ),
                }
              : value,
          ),
          candidate: candidateValue,
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("SHORT_PILOT_QUALIFICATION_REJECTED");
    expect(repository.mintCount).toBe(0);
  });

  it("rejects visual grammar drift in the actual render plan", async () => {
    const base = candidate();
    const plan = structuredClone(
      base.renderPlanDocument,
    ) as Mutable<ResolvedRenderManifestDocument>;
    const image = plan.segments[1];
    if (image) image.start_frame += 1;
    const drifted = { ...base, renderPlanDocument: plan };
    expect(await code(() => admission(new AsyncTransactionalRepository(), drifted))).toBe(
      "SHORT_PILOT_VISUAL_GRAMMAR_INVALID",
    );
  });

  it("queries durable submission count instead of caller evidence", async () => {
    const repository = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(repository);
    expect(
      await code(() =>
        acceptHostedShortPilot(repository, outputVerifier(value), value, evidence(value)),
      ),
    ).toBe("SHORT_PILOT_SUBMISSION_NOT_EXACTLY_ONCE");
  });

  it("rejects a repository row with any foreign durable identity", async () => {
    const trusted = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(trusted);
    await claimHostedShortPilotSubmission(trusted, value);
    const corrupted: HostedShortPilotRepository = {
      createOrReplay: (key, request) => trusted.createOrReplay(key, request),
      claimSubmission: (key, request) => trusted.claimSubmission(key, request),
      read: async (key) => {
        const row = await trusted.read(key);
        return row ? { ...row, accountId: "foreign-account" } : null;
      },
      accept: (key, request, acceptance) => trusted.accept(key, request, acceptance),
    };
    expect(
      await code(() =>
        acceptHostedShortPilot(corrupted, outputVerifier(value), value, evidence(value)),
      ),
    ).toBe("SHORT_PILOT_SUBMISSION_NOT_EXACTLY_ONCE");
  });

  it("rejects caller admission-summary drift against the durable canonical document", async () => {
    const repository = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(repository);
    await claimHostedShortPilotSubmission(repository, value);
    const drifted = { ...value, maximumWallTimeMs: value.maximumWallTimeMs + 1 };
    expect(
      await code(() =>
        acceptHostedShortPilot(repository, outputVerifier(value), drifted, evidence(value)),
      ),
    ).toBe("SHORT_PILOT_DURABLE_CONFLICT");
  });

  it("recomputes and rejects a rehashed durable admission-document forgery", async () => {
    const trusted = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(trusted);
    await claimHostedShortPilotSubmission(trusted, value);
    const forged: HostedShortPilotRepository = {
      createOrReplay: (key, document) => trusted.createOrReplay(key, document),
      claimSubmission: (key, request) => trusted.claimSubmission(key, request),
      read: async (key) => {
        const row = await trusted.read(key);
        if (!row) return null;
        const admissionDocument = {
          ...row.admissionDocument,
          maximumWallTimeMs: row.admissionDocument.maximumWallTimeMs + 1,
        };
        return {
          ...row,
          admissionDocument,
          admissionDocumentSha256: canonicalSha256(admissionDocument),
        };
      },
      accept: (key, request, acceptance) => trusted.accept(key, request, acceptance),
    };
    expect(
      await code(() =>
        acceptHostedShortPilot(forged, outputVerifier(value), value, evidence(value)),
      ),
    ).toBe("SHORT_PILOT_DURABLE_CONFLICT");
  });

  it("rejects a forged signed output-verifier envelope", async () => {
    const repository = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(repository);
    await claimHostedShortPilotSubmission(repository, value);
    expect(
      await code(() =>
        acceptHostedShortPilot(
          repository,
          outputVerifier(value, (trusted) => ({
            ...trusted,
            canonicalEvidenceSha256: sha("forged-evidence"),
          })),
          value,
          evidence(value),
        ),
      ),
    ).toBe("SHORT_PILOT_OUTPUT_NOT_DURABLE");
  });

  it("rejects missing terminal proof and nonzero workers", async () => {
    const repository = new AsyncTransactionalRepository();
    const value = await groundworkBoundaryAdmission(repository);
    await claimHostedShortPilotSubmission(repository, value);
    const result = evidence(value) as Mutable<HostedShortPilotAcceptanceEvidence>;
    expect(
      await code(() =>
        acceptHostedShortPilot(
          repository,
          outputVerifier(value, (trusted) => ({
            ...trusted,
            terminal: { ...trusted.terminal, activeWorkers: 1 as never },
          })),
          value,
          result,
        ),
      ),
    ).toBe("SHORT_PILOT_NOT_TERMINAL");
    result.rawEvidence = {};
    expect(
      await code(() => acceptHostedShortPilot(repository, outputVerifier(value), value, result)),
    ).toBe("SHORT_PILOT_OUTPUT_NOT_DURABLE");
  });
});
