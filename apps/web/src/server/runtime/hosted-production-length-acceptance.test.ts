import type { ResolvedRenderManifestDocument } from "@videoforge/contracts";
import type { TechnicalProbeDocument } from "@videoforge/contracts/generated/contract-types.js";
import manifestFixture from "@videoforge/contracts/generated/fixtures/resolved_render_manifest.valid.json";
import { canonicalSha256, digestUtf8, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  acceptHostedProductionLength,
  admitHostedProductionLength,
  hostedProductionLengthRequestSha256,
  HostedProductionLengthError,
  validateHostedProductionLengthCreatedRecord,
  type HostedProductionLengthAdmission,
  type HostedProductionLengthAdmissionDocument,
  type HostedProductionLengthKey,
  type HostedProductionLengthRecord,
  type HostedProductionLengthRepository,
  type HostedProductionOutputVerification,
  type HostedProductionOutputVerifier,
  type HostedProductionQualificationVerification,
  type HostedProductionQualificationVerifier,
} from "./hosted-production-length-acceptance.js";

type Mutable<T> = { -readonly [Key in keyof T]: Mutable<T[Key]> };
const sha = (label: string): Sha256 => canonicalSha256({ label });
const NOW = "2026-08-25T12:00:00.000Z";

function plan(): ResolvedRenderManifestDocument {
  const value = structuredClone(manifestFixture) as Mutable<ResolvedRenderManifestDocument>;
  value.total_frames = 54_000;
  value.segments[0]!.end_frame_exclusive = 13_500;
  value.segments[1]!.start_frame = 13_500;
  value.segments[1]!.end_frame_exclusive = 36_000;
  value.segments[2]!.start_frame = 36_000;
  value.segments[2]!.end_frame_exclusive = 54_000;
  return value;
}

class Repository implements HostedProductionLengthRepository {
  record: HostedProductionLengthRecord | null = null;
  mintCount = 0;

  async createOrReplay(document: HostedProductionLengthAdmissionDocument) {
    if (this.record) return { record: this.record, replayed: true };
    this.mintCount += 1;
    const submissionToken = "production-length:00000000-0000-4000-8000-000000000001";
    this.record = {
      document,
      documentSha256: canonicalSha256(document),
      submissionToken,
      submissionTokenSha256: digestUtf8(submissionToken),
      attemptId: "production-length-attempt-1",
      state: "READY",
      submissionCount: 0,
      acceptanceSha256: null,
    };
    return { record: this.record, replayed: false };
  }

  async claimOnce(key: HostedProductionLengthKey, requestSha256: Sha256) {
    if (
      !this.record ||
      this.record.document.key.renderPlanSha256 !== key.renderPlanSha256 ||
      this.record.document.requestSha256 !== requestSha256 ||
      this.record.state !== "READY"
    )
      return null;
    this.record = { ...this.record, state: "SUBMITTED", submissionCount: 1 };
    return this.record;
  }

  async read() {
    return this.record;
  }

  async accept(_key: HostedProductionLengthKey, requestSha256: Sha256, acceptanceSha256: Sha256) {
    if (!this.record || this.record.document.requestSha256 !== requestSha256) return null;
    if (this.record.state === "ACCEPTED")
      return this.record.acceptanceSha256 === acceptanceSha256 ? this.record : null;
    if (this.record.state !== "SUBMITTED") return null;
    this.record = { ...this.record, state: "ACCEPTED", acceptanceSha256 };
    return this.record;
  }
}

function unqualifiedVerifier(
  candidatePlan: ResolvedRenderManifestDocument,
  transform?: (
    value: HostedProductionQualificationVerification,
  ) => HostedProductionQualificationVerification,
): HostedProductionQualificationVerifier {
  const mageArtifacts = candidatePlan.segments.flatMap((segment) => {
    const asset =
      segment.timeline_composition === "IMAGE_FULL"
        ? segment.accepted_assets.image
        : segment.timeline_composition === "AVATAR_SPLIT_IMAGE"
          ? segment.accepted_assets.right_image
          : null;
    return asset
      ? [
          {
            assetId: asset.asset_id,
            sha256: asset.sha256 as Sha256,
            objectKey: `tenant/account-a/workspace/workspace-a/project/project-a/revision/${candidatePlan.project_revision_id}/lane/mage-image/job/mage-attempt-1/artifact/${asset.asset_id}`,
            contentType: "image/png" as const,
          },
        ]
      : [];
  });
  return {
    verify: vi.fn(async (raw): Promise<HostedProductionQualificationVerification> => {
      const value: HostedProductionQualificationVerification = {
        verifierId: "videoforge-production-length-qualification-verifier-v1",
        accepted: true,
        canonicalEvidenceSha256: canonicalSha256(raw),
        verifierSignatureSha256: sha("qualification-signature"),
        verifiedAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-25T23:00:00.000Z",
        accountId: "account-a",
        workspaceId: "workspace-a",
        projectId: "project-a",
        projectRevisionId: candidatePlan.project_revision_id,
        renderPlanSha256: canonicalSha256(candidatePlan),
        mage: {
          state: "QUALIFIED",
          canonicalBarrierSha256: sha("mage-barrier"),
          attemptId: "mage-attempt-1",
          artifacts: mageArtifacts,
        },
        soulx: { state: "UNQUALIFIED" },
      };
      return transform?.(value) ?? value;
    }),
  };
}

async function groundwork(repository: Repository) {
  const renderPlanDocument = plan();
  const key: HostedProductionLengthKey = {
    accountId: "account-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    projectRevisionId: renderPlanDocument.project_revision_id,
    renderPlanSha256: canonicalSha256(renderPlanDocument),
  };
  const base = {
    groundworkOnly: true as const,
    liveAcceptanceClaimed: false as const,
    key,
    revisionConfigSha256: renderPlanDocument.revision_config_hash as Sha256,
    renderPlanDocument,
    qualificationEvidenceSha256: sha("future-qualified-evidence"),
    totalFrames: 54_000,
    expectedCutCount: 2,
    targetVariableCostMicroUsd: 1_000_000 as const,
    hardVariableCostCeilingMicroUsd: 2_000_000 as const,
    fixedRetainedVolumesMonthlyMicroUsd: 7_000_000 as const,
    fixedRetainedVolumesExcluded: true as const,
    maximumWallTimeMs: 7_200_000,
  };
  const document: HostedProductionLengthAdmissionDocument = {
    schemaVersion: "videoforge-hosted-production-length-admission/v1",
    ...base,
    requestSha256: hostedProductionLengthRequestSha256(base),
  };
  const { record } = await repository.createOrReplay(document);
  const admission: HostedProductionLengthAdmission = {
    groundworkOnly: true,
    liveAcceptanceClaimed: false,
    document,
    documentSha256: record.documentSha256,
    submissionToken: record.submissionToken,
    submissionTokenSha256: record.submissionTokenSha256,
    attemptId: record.attemptId,
    state: record.state,
    replayed: false,
  };
  await repository.claimOnce(key, document.requestSha256);
  return admission;
}

function probe(outputSha256: Sha256): TechnicalProbeDocument {
  return {
    schema_version: "technical-probe/v1",
    asset_id: "production-output",
    sha256: outputSha256,
    bytes: 50_000_000,
    container: "mp4",
    duration_ms: 1_800_000,
    total_frames: 54_000,
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

function outputVerifier(
  admission: HostedProductionLengthAdmission,
  transform?: (value: HostedProductionOutputVerification) => HostedProductionOutputVerification,
): HostedProductionOutputVerifier {
  return {
    verify: vi.fn(async (raw) => {
      const outputSha256 = sha("production-output");
      const renderAttemptId = "cpu-render-attempt-1";
      const value: HostedProductionOutputVerification = {
        verifierId: "videoforge-production-length-output-verifier-v1",
        accepted: true,
        canonicalEvidenceSha256: canonicalSha256(raw),
        verifierSignatureSha256: sha("output-signature"),
        verifiedAt: "2026-08-25T00:00:00.000Z",
        expiresAt: "2026-08-25T23:00:00.000Z",
        durableInventorySha256: sha("durable-inventory"),
        output: {
          state: "COMMITTED",
          renderAttemptId,
          assetId: "production-output",
          objectKey: `tenant/${admission.document.key.accountId}/workspace/${admission.document.key.workspaceId}/project/${admission.document.key.projectId}/revision/${admission.document.key.projectRevisionId}/lane/render/job/${renderAttemptId}/artifact/production-output.mp4`,
          sha256: outputSha256,
          bytes: 50_000_000,
          contentType: "video/mp4",
          commitReceiptSha256: sha("commit"),
        },
        readback: {
          state: "GET_REHASH_SUCCEEDED",
          sha256: outputSha256,
          bytes: 50_000_000,
          contentType: "video/mp4",
          receiptSha256: sha("readback"),
        },
        technicalProbe: probe(outputSha256),
        measurements: {
          receiptSha256: sha("measurement-receipt"),
          mage: {
            observedGpu: "NVIDIA GeForce RTX 4090",
            queueMs: 1_000,
            initMs: 2_000,
            executionMs: 100_000,
            totalMs: 103_000,
            peakVramBytes: 20_000_000_000,
            measurementSha256: sha("mage-measurement"),
          },
          soulx: {
            observedGpu: "NVIDIA GeForce RTX 4090",
            queueMs: 1_500,
            initMs: 2_500,
            executionMs: 200_000,
            totalMs: 204_000,
            peakVramBytes: 22_000_000_000,
            measurementSha256: sha("soulx-measurement"),
          },
          render: {
            executionMs: 300_000,
            totalMs: 300_000,
            measurementSha256: sha("render-measurement"),
          },
        },
        settlement: {
          state: "SETTLED",
          mageMicroUsd: 200_000,
          soulxMicroUsd: 400_000,
          renderMicroUsd: 100_000,
          otherVariableMicroUsd: 50_000,
          totalVariableMicroUsd: 750_000,
          possibleDuplicateMicroUsd: 0,
          fixedRetainedVolumesMonthlyMicroUsd: 7_000_000,
          fixedRetainedVolumesExcluded: true,
          settlementReceiptSha256: sha("settlement"),
        },
        review: {
          state: "ACCEPTED",
          reviewReceiptSha256: sha("review"),
          reviewedCutCount: 2,
          everyCutReviewed: true,
          noManualMediaEditOrSubstitution: true,
          hardCutsOnly: true,
          overlaysAbsent: true,
          requiredSlowImageZoom: true,
          visualQualityPassed: true,
          audioVideoQualityPassed: true,
        },
        terminal: {
          attemptId: renderAttemptId,
          submissionTokenSha256: admission.submissionTokenSha256,
          jobsTerminal: true,
          activeWorkers: 0,
          durableInventorySha256: sha("durable-inventory"),
          observedAt: "2026-08-25T13:00:00.000Z",
        },
      };
      return transform?.(value) ?? value;
    }),
  };
}

const code = async (action: () => unknown | Promise<unknown>) => {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(HostedProductionLengthError);
    return (error as HostedProductionLengthError).code;
  }
  throw new Error("expected error");
};

describe("hosted production-length acceptance groundwork", () => {
  it("blocks the current unqualified SoulX contract before minting", async () => {
    const repository = new Repository();
    const renderPlanDocument = plan();
    expect(
      await code(() =>
        admitHostedProductionLength({
          repository,
          verifier: unqualifiedVerifier(renderPlanDocument),
          candidate: {
            accountId: "account-a",
            workspaceId: "workspace-a",
            projectId: "project-a",
            projectRevisionId: renderPlanDocument.project_revision_id,
            revisionConfigSha256: renderPlanDocument.revision_config_hash as Sha256,
            renderPlanDocument,
            qualificationEvidence: { state: "current-unqualified" },
            maximumWallTimeMs: 7_200_000,
          },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_SOULX_UNQUALIFIED");
    expect(repository.mintCount).toBe(0);
  });

  it("rejects unsigned, rejected, expired, or foreign artifact qualification", async () => {
    const renderPlanDocument = plan();
    const candidate = {
      accountId: "account-a",
      workspaceId: "workspace-a",
      projectId: "project-a",
      projectRevisionId: renderPlanDocument.project_revision_id,
      revisionConfigSha256: renderPlanDocument.revision_config_hash as Sha256,
      renderPlanDocument,
      qualificationEvidence: { state: "qualification" },
      maximumWallTimeMs: 7_200_000,
    };
    const transforms = [
      (value: HostedProductionQualificationVerification) => ({
        ...value,
        accepted: false as true,
      }),
      (value: HostedProductionQualificationVerification) => ({
        ...value,
        verifierSignatureSha256: "invalid" as Sha256,
      }),
      (value: HostedProductionQualificationVerification) => ({
        ...value,
        expiresAt: value.verifiedAt,
      }),
      (value: HostedProductionQualificationVerification) => ({
        ...value,
        mage: {
          ...value.mage,
          artifacts: value.mage.artifacts.map((artifact, index) =>
            index === 0 ? { ...artifact, objectKey: "foreign/object" } : artifact,
          ),
        },
      }),
    ];
    for (const transform of transforms) {
      expect(
        await code(() =>
          admitHostedProductionLength({
            repository: new Repository(),
            verifier: unqualifiedVerifier(renderPlanDocument, transform),
            candidate,
            now: () => new Date(NOW),
          }),
        ),
      ).toBe("PRODUCTION_LENGTH_QUALIFICATION_INVALID");
    }
  });

  it("rejects exact createOrReplay key, document, request, token, and attempt drift", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    const record = repository.record!;
    const forgeries: HostedProductionLengthRecord[] = [
      {
        ...record,
        document: { ...record.document, key: { ...record.document.key, accountId: "foreign" } },
      },
      { ...record, documentSha256: sha("foreign-document") },
      { ...record, submissionTokenSha256: sha("foreign-token") },
      { ...record, attemptId: "" },
      { ...record, document: { ...record.document, requestSha256: sha("foreign-request") } },
    ];
    for (const forged of forgeries) {
      expect(() =>
        validateHostedProductionLengthCreatedRecord(admission.document, forged),
      ).toThrowError(
        expect.objectContaining<Partial<HostedProductionLengthError>>({
          code: "PRODUCTION_LENGTH_DURABLE_CONFLICT",
        }),
      );
    }
  });

  it.each([52_199, 55_801])(
    "rejects production duration outside 29-31 minutes: %s",
    async (frames) => {
      const renderPlanDocument = plan() as Mutable<ResolvedRenderManifestDocument>;
      renderPlanDocument.total_frames = frames;
      renderPlanDocument.segments[2]!.end_frame_exclusive = frames;
      expect(
        await code(() =>
          admitHostedProductionLength({
            repository: new Repository(),
            verifier: unqualifiedVerifier(renderPlanDocument),
            candidate: {
              accountId: "account-a",
              workspaceId: "workspace-a",
              projectId: "project-a",
              projectRevisionId: renderPlanDocument.project_revision_id,
              revisionConfigSha256: renderPlanDocument.revision_config_hash as Sha256,
              renderPlanDocument,
              qualificationEvidence: {},
              maximumWallTimeMs: 7_200_000,
            },
          }),
        ),
      ).toBe("PRODUCTION_LENGTH_PLAN_INVALID");
    },
  );

  it("accepts trusted durable production evidence under the $1 target", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    const accepted = await acceptHostedProductionLength({
      repository,
      verifier: outputVerifier(admission),
      admission,
      rawEvidence: { receipt: "production" },
      now: () => new Date(NOW),
    });
    expect(accepted).toMatchObject({
      outcome: "GROUNDWORK_ACCEPTED_EVIDENCE_ONLY",
      groundworkOnly: true,
      liveAcceptanceClaimed: false,
    });
  });

  it("rejects output/readback drift", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    expect(
      await code(() =>
        acceptHostedProductionLength({
          repository,
          verifier: outputVerifier(admission, (value) => ({
            ...value,
            readback: { ...value.readback, sha256: sha("drift") },
          })),
          admission,
          rawEvidence: { receipt: "production" },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_OUTPUT_INVALID");
  });

  it("binds the output path and terminal state to the DB render attempt, not admission authority", async () => {
    const cases: readonly Readonly<{
      transform: (value: HostedProductionOutputVerification) => HostedProductionOutputVerification;
      expected: "PRODUCTION_LENGTH_OUTPUT_INVALID" | "PRODUCTION_LENGTH_NOT_TERMINAL";
    }>[] = [
      {
        transform: (value) => ({
          ...value,
          output: { ...value.output, renderAttemptId: "foreign-render-attempt" },
        }),
        expected: "PRODUCTION_LENGTH_OUTPUT_INVALID",
      },
      {
        transform: (value) => ({
          ...value,
          terminal: { ...value.terminal, attemptId: "foreign-render-attempt" },
        }),
        expected: "PRODUCTION_LENGTH_NOT_TERMINAL",
      },
    ];
    for (const { transform, expected } of cases) {
      const repository = new Repository();
      const admission = await groundwork(repository);
      expect(
        await code(() =>
          acceptHostedProductionLength({
            repository,
            verifier: outputVerifier(admission, transform),
            admission,
            rawEvidence: { receipt: "production" },
            now: () => new Date(NOW),
          }),
        ),
      ).toBe(expected);
    }
  });

  it("rejects rejected, unsigned, or expired output verifier envelopes", async () => {
    const transforms = [
      (value: HostedProductionOutputVerification) => ({ ...value, accepted: false as true }),
      (value: HostedProductionOutputVerification) => ({
        ...value,
        verifierSignatureSha256: "invalid" as Sha256,
      }),
      (value: HostedProductionOutputVerification) => ({
        ...value,
        expiresAt: value.verifiedAt,
      }),
    ];
    for (const transform of transforms) {
      const repository = new Repository();
      const admission = await groundwork(repository);
      expect(
        await code(() =>
          acceptHostedProductionLength({
            repository,
            verifier: outputVerifier(admission, transform),
            admission,
            rawEvidence: { receipt: "production" },
            now: () => new Date(NOW),
          }),
        ),
      ).toBe("PRODUCTION_LENGTH_OUTPUT_INVALID");
    }
  });

  it.each([1_000_001, 2_000_001])(
    "rejects variable cost outside the $1 target/$2 ceiling: %s",
    async (total) => {
      const repository = new Repository();
      const admission = await groundwork(repository);
      expect(
        await code(() =>
          acceptHostedProductionLength({
            repository,
            verifier: outputVerifier(admission, (value) => ({
              ...value,
              settlement: {
                ...value.settlement,
                mageMicroUsd: total,
                soulxMicroUsd: 0,
                renderMicroUsd: 0,
                otherVariableMicroUsd: 0,
                totalVariableMicroUsd: total,
              },
            })),
            admission,
            rawEvidence: { receipt: "production" },
            now: () => new Date(NOW),
          }),
        ),
      ).toBe("PRODUCTION_LENGTH_COST_INVALID");
    },
  );

  it("requires the fixed $7 monthly volumes to be disclosed and excluded", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    expect(
      await code(() =>
        acceptHostedProductionLength({
          repository,
          verifier: outputVerifier(admission, (value) => ({
            ...value,
            settlement: { ...value.settlement, fixedRetainedVolumesExcluded: false },
          })),
          admission,
          rawEvidence: { receipt: "production" },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_COST_INVALID");
  });

  it("rejects invalid timing, GPU, or VRAM measurements", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    expect(
      await code(() =>
        acceptHostedProductionLength({
          repository,
          verifier: outputVerifier(admission, (value) => ({
            ...value,
            measurements: {
              ...value.measurements,
              soulx: { ...value.measurements.soulx, peakVramBytes: 0 },
            },
          })),
          admission,
          rawEvidence: { receipt: "production" },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_MEASUREMENT_INVALID");
  });

  it("rejects manual media edits or incomplete cut review", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    expect(
      await code(() =>
        acceptHostedProductionLength({
          repository,
          verifier: outputVerifier(admission, (value) => ({
            ...value,
            review: { ...value.review, noManualMediaEditOrSubstitution: false },
          })),
          admission,
          rawEvidence: { receipt: "production" },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_REVIEW_INVALID");
  });

  it("requires terminal jobs and zero workers", async () => {
    const repository = new Repository();
    const admission = await groundwork(repository);
    expect(
      await code(() =>
        acceptHostedProductionLength({
          repository,
          verifier: outputVerifier(admission, (value) => ({
            ...value,
            terminal: { ...value.terminal, activeWorkers: 1 as never },
          })),
          admission,
          rawEvidence: { receipt: "production" },
          now: () => new Date(NOW),
        }),
      ),
    ).toBe("PRODUCTION_LENGTH_NOT_TERMINAL");
  });
});
