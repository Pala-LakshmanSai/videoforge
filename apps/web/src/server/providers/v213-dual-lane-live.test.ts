import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  type ProvenanceReceiptBody,
} from "@videoforge/control-plane";
import { describe, expect, it } from "vitest";

import {
  V213_GPU,
  V213_GPU_VRAM_BYTES,
  V213_MAX_RATE_USD_PER_GPU_HOUR,
  V213_QUALIFICATION_CASE_DESCRIPTORS,
  V213_REGION,
  createV213Max1Deployments,
  issueV213StageAuthority,
  readV213DualLaneAdmission,
  runV213DualLaneLive,
  runV213MageQualification,
  runV213SoulXQualification,
  type V213AdmissionRead,
  type V213DualLaneInput,
  type V213DualLaneTransport,
  type V213InventoryRead,
  type V213JobRead,
  type V213LaneDeployment,
  type V213QualificationCaseDescriptor,
  type V213SealedLane,
} from "./v213-dual-lane-live";
import { v213SoulxWarmupAttestationSha256 } from "./v213-provenance-receipt";

const stageKeys = generateKeyPairSync("ed25519");
const receiptSigner = new ProvenanceReceiptSigner("v213-receipt-key", Buffer.alloc(32, 7));
const publicPem = (key: typeof stageKeys.publicKey) =>
  key.export({ type: "spki", format: "pem" }).toString();
const canonicalHash = (value: unknown) =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;
const signCanonical = (value: unknown, key = stageKeys.privateKey) =>
  sign(null, Buffer.from(canonicalizeJson(value as JsonValue), "utf8"), key).toString("base64");

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const hash = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Buffer.from(digest).toString("hex")}`;
};

const lane = async (name: "mage" | "soulx", character: string): Promise<V213SealedLane> => {
  return {
    lane: name,
    publicImage: `ghcr.io/pala-lakshmansai/videoforge-${name}@${sha(character)}`,
    sourceCommit: character.repeat(40),
    deploymentSha256: sha(character === "a" ? "c" : "d"),
    volumeIdSha256: await hash(`volume-${name}`),
    volumeManifestSha256: sha(character === "a" ? "e" : "f"),
  };
};

const qualificationRequest = (
  deployment: V213LaneDeployment,
  descriptor: V213QualificationCaseDescriptor,
): JsonValue => ({
  envelope: {
    schema: "serverless-worker-job-envelope/v3",
    dispatch_token: `dispatch-${descriptor.id}-${"x".repeat(32)}`,
    tenant: { account_id: "account-a", workspace_id: "workspace-a" },
    work: {
      project_revision_id: "revision-a",
      generation_request_id: `generation-${descriptor.id}`,
      task_id: `task-${descriptor.id}`,
      attempt_id: `attempt-${descriptor.id}`,
      lane: descriptor.lane === "mage" ? "mage_image" : "soulx_avatar",
      items_manifest_sha256: sha("8"),
      item_count: 1,
    },
    runtime: {
      endpoint_profile_id: `v213-${descriptor.lane}-qualification`,
      deployment_id: deployment.deploymentSha256,
      container_digest: deployment.image.slice(deployment.image.indexOf("sha256:")),
      model_manifest_sha256: deployment.volumeManifestSha256,
      volume_id_sha256: deployment.volumeIdSha256,
      volume_mount: "/runpod-volume",
      volume_write_policy: "APPLICATION_READ_ONLY",
      scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
      gpu_allowlist: [V213_GPU],
      region: V213_REGION,
    },
    artifacts: {
      input_manifest_sha256: sha("9"),
      output_prefix: `tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/${descriptor.lane === "mage" ? "mage-image" : "soulx-avatar"}/job/attempt-${descriptor.id}`,
      transfer_port_reservation_ids: [`reservation-${descriptor.id}`],
    },
    limits: {
      expires_at: "2026-08-26T01:00:00.000Z",
      max_items: 1,
      max_input_bytes: 1_000_000,
      max_output_bytes: 10_000_000,
      execution_timeout_seconds: 2_400,
      init_timeout_seconds: 800,
    },
    policy: {
      model_download_permitted: false,
      volume_mutation_permitted: false,
      pod_lifecycle_permitted: false,
      queue_purge_permitted: false,
    },
    authority_sha256: sha("a"),
    signature: {
      algorithm: "HMAC-SHA256",
      key_id: receiptSigner.keyId,
      value: "0".repeat(64),
    },
  },
  batch: { case_id: descriptor.id, seconds: descriptor.seconds },
  ports: {
    input: { reservation_id: `input-${descriptor.id}` },
    output: { reservation_id: `output-${descriptor.id}` },
  },
});

const makeInput = async (): Promise<V213DualLaneInput> => ({
  accountIdSha256: sha("9"),
  mage: await lane("mage", "a"),
  soulx: await lane("soulx", "b"),
  billingBaselineUsd: 100,
  totalCapUsd: 17.5,
  mageQualificationCapUsd: 4.5,
  soulxQualificationCapUsd: 1,
  stageAuthorityPublicKeyPem: publicPem(stageKeys.publicKey),
  receiptSigner,
  minimumStableReadSpacingMs: 250,
  maxStatusReads: 2,
  pollIntervalMs: 100,
  qualificationEnvelopeSchemaSha256: sha("4"),
  envelopeSigningKeyId: receiptSigner.keyId,
  qualificationGeneratorSha256: sha("5"),
  qualificationCaseDescriptors: V213_QUALIFICATION_CASE_DESCRIPTORS,
  qualificationSourceRefs: {
    caseSource: { path: "case.ts", sha256: sha("1") as `sha256:${string}` },
    generators: {
      mage: { path: "mage.mjs", sha256: sha("2") as `sha256:${string}` },
      soulx: { path: "soulx.mjs", sha256: sha("3") as `sha256:${string}` },
    },
    validators: {
      mage: { path: "mage.py", sha256: sha("4") as `sha256:${string}` },
      soulx: { path: "soulx.py", sha256: sha("5") as `sha256:${string}` },
    },
  },
  qualificationProtectedInputDescriptors: Object.fromEntries(
    ["avatarSource", "soulx2s", "soulx4s", "soulx6s", "soulx10s"].map((key) => [
      key,
      {
        path: `.videoforge/private/${key}`,
        sha256: sha("6"),
        sizeBytes: 100,
        contentType: key === "avatarSource" ? "image/png" : "audio/wav",
      },
    ]),
  ) as V213DualLaneInput["qualificationProtectedInputDescriptors"],
  qualificationR2: { accountId: "a".repeat(32), bucketName: "fixture-private" },
});

type FakeOptions = {
  ackUnknown?: boolean;
  unrecoverableAck?: boolean;
  badReceipt?: boolean;
  cancelUnknown?: boolean;
  unstableDrain?: boolean;
  failSoulx?: boolean;
  forgedReceipt?: boolean;
  wrongRequestHash?: boolean;
  staleTimestamps?: boolean;
  lostCreateAck?: boolean;
  crashBeforeStageCommit?: boolean;
  replayReceiptNonce?: boolean;
  rateAboveCap?: boolean;
};

const makeFake = (
  input: V213DualLaneInput,
  options: FakeOptions = {},
): V213DualLaneTransport & { events: string[] } => {
  const events: string[] = [];
  const deployments: V213LaneDeployment[] = [];
  const jobs = new Map<string, { endpoint: string; requestKey: string; envelope: JsonValue }>();
  const resourceKeys = new Map<string, V213LaneDeployment>();
  const stageStates = new Map<string, "CLAIMED" | "DONE">();
  const operations = new Map<string, any>();
  let sequence = 0;
  let authoritySequence = 0;
  let inventorySequence = 0;
  let stageCommitCrashInjected = false;
  let billing = input.billingBaselineUsd;

  const volumes = [input.mage, input.soulx].map((item) => ({
    idSha256: item.volumeIdSha256,
    sizeGb: 50,
    region: V213_REGION,
    manifestSha256: item.volumeManifestSha256,
  }));
  const admission = (): V213AdmissionRead => ({
    checkedAt: "2026-08-26T00:30:00.000Z",
    accountIdSha256: input.accountIdSha256,
    gpu: V213_GPU,
    region: V213_REGION,
    availability: "LOW",
    flexRateUsdPerGpuHour: options.rateAboveCap
      ? V213_MAX_RATE_USD_PER_GPU_HOUR + 0.000_001
      : V213_MAX_RATE_USD_PER_GPU_HOUR,
    cumulativeBillingUsd: billing,
    runningPods: 0,
    activeWorkers: 0,
    endpoints: 0,
    privateTemplates: 0,
    volumes,
  });
  const deploy = async (
    sealed: V213SealedLane,
    purpose: "qualification" | "production",
    resourceKey: string,
  ): Promise<V213LaneDeployment> => {
    sequence += 1;
    const endpointId = `endpoint-${sequence}`;
    const templateId = `template-${sequence}`;
    const value: V213LaneDeployment = {
      lane: sealed.lane,
      purpose,
      endpointId,
      endpointIdSha256: await hash(endpointId),
      templateId,
      templateIdSha256: await hash(templateId),
      image: sealed.publicImage,
      sourceCommit: sealed.sourceCommit,
      deploymentSha256: sealed.deploymentSha256,
      volumeIdSha256: sealed.volumeIdSha256,
      volumeManifestSha256: sealed.volumeManifestSha256,
      volumeSizeGb: 50,
      volumeMount: "/runpod-volume",
      region: V213_REGION,
      gpu: V213_GPU,
      gpuCount: 1,
      workersMin: 0,
      workersMax: 1,
      handlerConcurrency: 1,
      scalerType: "REQUEST_COUNT",
      scalerValue: 1,
      initTimeoutSeconds: 800,
    };
    deployments.push(value);
    resourceKeys.set(resourceKey, value);
    events.push(`create:${sealed.lane}:${purpose}`);
    return value;
  };
  const receipt = (
    deployment: V213LaneDeployment,
    caseId: string,
    jobId: string,
    payload: JsonValue,
  ) => {
    const duration = caseId.startsWith("mage") ? 0 : Number(caseId.match(/(\d+)s/u)?.[1] ?? 2);
    const payloadRecord = payload as Record<string, JsonValue>;
    const envelope = payloadRecord.envelope as Record<string, JsonValue>;
    const { envelope: _envelope, ...requestBody } = payloadRecord;
    void _envelope;
    const work = envelope.work as Record<string, JsonValue>;
    const runtime = envelope.runtime as Record<string, JsonValue>;
    const body: ProvenanceReceiptBody = {
      schema_version: "serverless-provenance-receipt/v1",
      receipt_id: `receipt-${caseId}`,
      attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
      dispatch_token: String(envelope.dispatch_token),
      envelope_sha256: canonicalHash(envelope) as `sha256:${string}`,
      request_sha256: (options.wrongRequestHash
        ? sha("8")
        : canonicalHash(requestBody)) as `sha256:${string}`,
      attempt_id: String(work.attempt_id),
      provider_job_id: jobId,
      worker_id: `worker-${caseId}`,
      tenant: { account_id: "account-a", workspace_id: "workspace-a" },
      lane: deployment.lane === "mage" ? "mage_image" : "soulx_avatar",
      deployment: {
        deployment_id: String(runtime.deployment_id),
        endpoint_id_sha256: deployment.endpointIdSha256 as `sha256:${string}`,
        container_digest: deployment.image.slice(
          deployment.image.indexOf("sha256:"),
        ) as `sha256:${string}`,
        intended_region: "EU-RO-1",
        intended_volume_id_sha256: deployment.volumeIdSha256 as `sha256:${string}`,
        model_manifest_sha256: deployment.volumeManifestSha256 as `sha256:${string}`,
      },
      runtime_probe: {
        gpu_name: V213_GPU,
        gpu_count: 1,
        total_vram_bytes: V213_GPU_VRAM_BYTES,
        peak_vram_bytes: 12 * 1024 ** 3,
        gpu_uuid_sha256: null,
        driver_version: "550.90.07",
        cuda_version: "12.4",
        probe_source: "WORKER_RUNTIME_SELF_REPORT",
      },
      volume_verification: {
        manifest_sha256_before: deployment.volumeManifestSha256 as `sha256:${string}`,
        manifest_sha256_after: (options.badReceipt
          ? sha("0")
          : deployment.volumeManifestSha256) as `sha256:${string}`,
        mutation_detected: false,
        cross_mount_detected: false,
      },
      model_ready_evidence: {
        state: "MODEL_READY",
        warmup_completed: true,
        warmup_output_sha256:
          deployment.lane === "soulx"
            ? v213SoulxWarmupAttestationSha256(
                deployment.image.slice(deployment.image.indexOf("sha256:")) as `sha256:${string}`,
              )
            : (sha("7") as `sha256:${string}`),
      },
      timings: {
        allocation_ms: 1,
        container_ready_ms: caseId.includes("cold") ? 300_000 : 10,
        volume_verified_ms: 1,
        model_load_ms: 1,
        warmup_ms: 1,
        first_inference_ms: 1,
        upload_ms: 1,
        total_ms: 1_000,
      },
      items: [
        {
          item_id: caseId,
          state: "SUCCEEDED",
          output_object_key: `tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/${deployment.lane === "mage" ? "mage-image" : "soulx-avatar"}/job/${String(work.attempt_id)}/artifact/${caseId}`,
          output_sha256: sha("2") as `sha256:${string}`,
          output_bytes: 100,
          probe:
            deployment.lane === "mage"
              ? { format: "png", width: 1280, height: 720 }
              : {
                  format: "mp4",
                  width: 512,
                  height: 512,
                  fps_num: 25,
                  fps_den: 1,
                  duration_ms: duration * 1_000,
                },
        },
      ],
      scratch_cleanup: {
        terminal_reason: "SUCCESS",
        removed: true,
        scratch_on_model_volume: false,
      },
      receipt_nonce: options.replayReceiptNonce
        ? 1
        : Math.max(
            1,
            [...caseId].reduce((sum, character) => sum + character.charCodeAt(0), 0),
          ),
      issued_at: "2026-08-26T00:30:00.000Z",
    };
    const bodyBytes = Buffer.from(canonicalizeJson(body as unknown as JsonValue), "utf8");
    const signed = (
      options.forgedReceipt
        ? new ProvenanceReceiptSigner(receiptSigner.keyId, Buffer.alloc(32, 8))
        : receiptSigner
    ).signOverBytes(body, bodyBytes);
    return {
      receipt: signed,
      receiptBodyBase64: bodyBytes.toString("base64"),
    };
  };

  return {
    events,
    durable: {
      issueStageAuthority: async ({ stage, inputSha256, predecessorHandoffSha256 }) => {
        authoritySequence += 1;
        const signed = {
          schemaVersion: "videoforge.v213-stage-authority/v1" as const,
          authorityId: `authority-${authoritySequence}`,
          stage,
          inputSha256,
          predecessorHandoffSha256,
          nonce: `nonce-${stage}-${"z".repeat(40)}`,
          issuedAt: "2026-08-26T00:00:00.000Z",
          expiresAt: "2026-08-26T01:00:00.000Z",
          singleUse: true as const,
        };
        return { ...signed, signatureBase64: signCanonical(signed, stageKeys.privateKey) };
      },
      claimStageAuthority: async (authority) => {
        const state = stageStates.get(authority.authorityId);
        const decision =
          state === "DONE" ? "REPLAY_REJECTED" : state === "CLAIMED" ? "RESUME" : "EXECUTE";
        if (state === undefined) stageStates.set(authority.authorityId, "CLAIMED");
        return {
          decision,
          authorityId: authority.authorityId,
          nonceSha256: await hash(authority.nonce),
          consumedAt: "2026-08-26T00:30:00.000Z",
        } as const;
      },
      completeStageAuthority: async (authorityId) => {
        if (options.crashBeforeStageCommit && !stageCommitCrashInjected) {
          stageCommitCrashInjected = true;
          throw new Error("SIMULATED_PROCESS_CRASH_BEFORE_STAGE_COMMIT");
        }
        stageStates.set(authorityId, "DONE");
      },
      claimOperation: async (operation) => {
        const existing = operations.get(operation.operationId);
        if (existing) {
          return {
            action: existing.state === "TERMINAL" ? "DONE" : "RECONCILE",
            record: existing,
          } as const;
        }
        const record = { ...operation, state: "IN_FLIGHT" as const };
        operations.set(operation.operationId, record);
        return { action: "EXECUTE" as const, record };
      },
      transitionOperation: async ({ operationId, from, to, providerId, evidence }) => {
        const current = operations.get(operationId);
        if (!current || current.state !== from) throw new Error("FAKE_DURABLE_CAS_FAILED");
        const next = {
          ...current,
          state: to,
          ...(providerId ? { providerId } : {}),
          ...(evidence ? { evidence } : {}),
        };
        operations.set(operationId, next);
        return next;
      },
    },
    freshAdmission: async () => admission(),
    createLane: async ({ sealed, purpose, resourceKey }) => {
      const deployment = await deploy(sealed, purpose, resourceKey);
      return options.lostCreateAck
        ? ({ kind: "ACK_UNKNOWN" } as const)
        : ({ kind: "ACK", deployment } as const);
    },
    materializeQualificationCase: async ({ descriptor, deployment, stageAuthorityId }) => {
      const materializedRequest = qualificationRequest(deployment, descriptor);
      const caseDescriptorSha256 = canonicalHash(descriptor);
      return {
        schemaVersion: "videoforge.v213-qualification-case-materialization/v1",
        caseDescriptorSha256,
        materializationEvidenceSha256: canonicalHash({
          caseDescriptorSha256,
          deploymentSha256: canonicalHash(deployment),
          requestSha256: canonicalHash(materializedRequest),
          stageAuthorityId,
        }),
        request: materializedRequest,
      };
    },
    findLaneByResourceKey: async (resourceKey) => resourceKeys.get(resourceKey) ?? null,
    readLane: async (deployment) => ({ ...deployment }),
    dispatch: async ({ deployment, requestKey, envelope }) => {
      events.push(`dispatch:${deployment.lane}:${requestKey}`);
      const jobId = `job-${requestKey}`;
      jobs.set(jobId, { endpoint: deployment.endpointId, requestKey, envelope });
      if (options.ackUnknown) return { kind: "ACK_UNKNOWN" };
      return { kind: "ACK", jobId };
    },
    findJobByRequestKey: async ({ endpointId, requestKey }) => {
      events.push(`reconcile:${requestKey}`);
      if (options.unrecoverableAck) return null;
      const found = [...jobs].find(
        ([, job]) => job.endpoint === endpointId && job.requestKey === requestKey,
      );
      return found ? { jobId: found[0] } : null;
    },
    status: async (endpointId, jobId): Promise<V213JobRead> => {
      const job = jobs.get(jobId)!;
      const deployment = deployments.find((item) => item.endpointId === endpointId)!;
      const caseId = job.requestKey.replace(/^v213-/u, "");
      if (caseId === "soulx-invalid-output") {
        return { jobId, status: "FAILED", failureCode: "SOULX_OUTPUT_CONTRACT_INVALID" };
      }
      if (caseId === "soulx-timeout") return { jobId, status: "TIMED_OUT" };
      if (options.failSoulx && deployment.lane === "soulx") return { jobId, status: "FAILED" };
      billing += deployment.lane === "mage" ? 0.01 : 0.005;
      return {
        jobId,
        status: "COMPLETED",
        receiptDelivery: receipt(deployment, caseId, jobId, job.envelope),
        outputReadbackVerified: true,
      };
    },
    cancel: async (_endpointId, jobId) => ({
      jobId,
      status: options.cancelUnknown ? "IN_PROGRESS" : "CANCELLED",
    }),
    deleteLane: async (deployment) => {
      events.push(`delete:${deployment.lane}:${deployment.purpose}`);
      deployments.splice(deployments.indexOf(deployment), 1);
      for (const [key, value] of resourceKeys) if (value === deployment) resourceKeys.delete(key);
    },
    inventory: async (): Promise<V213InventoryRead> => ({
      checkedAt: options.staleTimestamps
        ? "2026-08-26T00:30:00.000Z"
        : new Date(
            Date.parse("2026-08-26T00:30:00.000Z") + inventorySequence++ * 250,
          ).toISOString(),
      runningPods: 0,
      activeWorkers:
        options.unstableDrain && deployments.some((item) => item.purpose === "production") ? 1 : 0,
      queuedJobs: 0,
      endpointIdSha256s: deployments.map((item) => item.endpointIdSha256),
      templateIdSha256s: deployments.map((item) => item.templateIdSha256),
      volumes,
    }),
    billingAmount: async () => billing,
    sleep: async () => undefined,
    now: () => new Date("2026-08-26T00:30:00.000Z"),
  };
};

describe("V2-13 dual lane live adapter", () => {
  it("accepts the exact approved rate and rejects any higher rate before mutation", async () => {
    expect(V213_MAX_RATE_USD_PER_GPU_HOUR).toBe(1.116);
    const input = await makeInput();
    const exactRateTransport = makeFake(input);
    await expect(readV213DualLaneAdmission(exactRateTransport, input)).resolves.toMatchObject({
      admission: { flexRateUsdPerGpuHour: V213_MAX_RATE_USD_PER_GPU_HOUR },
    });
    expect(exactRateTransport.events).toEqual([]);

    const aboveRateTransport = makeFake(input, { rateAboveCap: true });
    await expect(readV213DualLaneAdmission(aboveRateTransport, input)).rejects.toMatchObject({
      code: "V213_FRESH_ADMISSION_REJECTED",
    });
    expect(aboveRateTransport.events).toEqual([]);
  });

  it("qualifies Mage first, exercises SoulX, creates production max1 last and proves drain", async () => {
    const input = await makeInput();
    const transport = makeFake(input);
    const result = await runV213DualLaneLive(transport, input);

    expect(result.qualified).toBe(true);
    expect(result.qualificationReceipts).toHaveLength(5);
    expect(result.production.mage.workersMax).toBe(1);
    expect(result.production.soulx.workersMin).toBe(0);
    expect(transport.events.indexOf("create:mage:qualification")).toBeLessThan(
      transport.events.indexOf("create:soulx:qualification"),
    );
    expect(transport.events.indexOf("create:soulx:qualification")).toBeLessThan(
      transport.events.indexOf("create:mage:production"),
    );
  });

  it("exports hash-chained stages for durable outer reservations", async () => {
    const input = await makeInput();
    const transport = makeFake(input);
    const admission = await readV213DualLaneAdmission(transport, input);
    expect(transport.events).toEqual([]);
    const mageAuthority = await issueV213StageAuthority(
      transport,
      input,
      "mage",
      admission.handoffSha256,
    );
    const mage = await runV213MageQualification(transport, input, admission, mageAuthority);
    expect(mage.priorHandoffSha256).toBe(admission.handoffSha256);
    expect(mage.zeroWorkersAfter).toBe(true);
    expect(mage.threeStableZeroWorkerReads).toBe(true);
    expect(transport.events).not.toContain("create:soulx:qualification");
    const soulxAuthority = await issueV213StageAuthority(
      transport,
      input,
      "soulx",
      mage.handoffSha256,
    );
    const soulx = await runV213SoulXQualification(transport, input, mage, soulxAuthority);
    expect(soulx.priorHandoffSha256).toBe(mage.handoffSha256);
    expect(soulx.zeroWorkersAfter).toBe(true);
    expect(soulx.threeStableZeroWorkerReads).toBe(true);
    expect(transport.events).not.toContain("create:mage:production");
    const productionAuthority = await issueV213StageAuthority(
      transport,
      input,
      "production",
      soulx.handoffSha256,
    );
    await expect(
      createV213Max1Deployments(transport, input, mage, soulx, productionAuthority),
    ).resolves.toMatchObject({ qualified: true });
  });

  it("rejects a tampered predecessor before the next stage mutates", async () => {
    const input = await makeInput();
    const transport = makeFake(input);
    const admission = await readV213DualLaneAdmission(transport, input);
    const tampered = { ...admission, inputSha256: sha("0") };
    const authority = await issueV213StageAuthority(
      transport,
      input,
      "mage",
      admission.handoffSha256,
    );
    await expect(
      runV213MageQualification(transport, input, tampered, authority),
    ).rejects.toMatchObject({ code: "V213_HANDOFF_HASH_MISMATCH" });
    expect(transport.events).toEqual([]);
  });

  it("reconciles one ACK_UNKNOWN without redispatch", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { ackUnknown: true });
    await expect(runV213DualLaneLive(transport, input)).resolves.toMatchObject({ qualified: true });
    expect(transport.events.filter((event) => event.startsWith("dispatch:"))).toHaveLength(8);
    expect(transport.events.filter((event) => event.startsWith("reconcile:"))).toHaveLength(8);
  });

  it("reconciles every lost create acknowledgement by deterministic resource key", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { lostCreateAck: true });
    await expect(runV213DualLaneLive(transport, input)).resolves.toMatchObject({ qualified: true });
    expect(transport.events.filter((event) => event.startsWith("create:"))).toHaveLength(4);
  });

  it("cryptographically rejects a forged worker receipt", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { forgedReceipt: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_QUALIFICATION_RECEIPT_SIGNATURE_INVALID",
    });
  });

  it("rejects a signed receipt bound to the wrong canonical request", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { wrongRequestHash: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_QUALIFICATION_RECEIPT_INVALID",
    });
  });

  it("rejects replay of a valid signed receipt nonce across requests", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { replayReceiptNonce: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_QUALIFICATION_RECEIPT_INVALID",
    });
  });

  it("rejects replay of a consumed signed stage nonce without another mutation", async () => {
    const input = await makeInput();
    const transport = makeFake(input);
    const admission = await readV213DualLaneAdmission(transport, input);
    const authority = await issueV213StageAuthority(
      transport,
      input,
      "mage",
      admission.handoffSha256,
    );
    await runV213MageQualification(transport, input, admission, authority);
    const dispatches = transport.events.filter((event) => event.startsWith("dispatch:")).length;
    await expect(
      runV213MageQualification(transport, input, admission, authority),
    ).rejects.toMatchObject({ code: "V213_STAGE_AUTHORITY_REPLAYED" });
    expect(transport.events.filter((event) => event.startsWith("dispatch:"))).toHaveLength(
      dispatches,
    );
  });

  it("resumes a crash before stage commit from durable operations without redispatch", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { crashBeforeStageCommit: true });
    const admission = await readV213DualLaneAdmission(transport, input);
    const authority = await issueV213StageAuthority(
      transport,
      input,
      "mage",
      admission.handoffSha256,
    );
    await expect(runV213MageQualification(transport, input, admission, authority)).rejects.toThrow(
      "SIMULATED_PROCESS_CRASH_BEFORE_STAGE_COMMIT",
    );
    const dispatches = transport.events.filter((event) => event.startsWith("dispatch:")).length;
    await expect(
      runV213MageQualification(transport, input, admission, authority),
    ).resolves.toMatchObject({ zeroWorkersAfter: true });
    expect(transport.events.filter((event) => event.startsWith("dispatch:"))).toHaveLength(
      dispatches,
    );
  });

  it("rejects forged stage authority before any provider mutation", async () => {
    const input = await makeInput();
    const transport = makeFake(input);
    const admission = await readV213DualLaneAdmission(transport, input);
    const authority = await issueV213StageAuthority(
      transport,
      input,
      "mage",
      admission.handoffSha256,
    );
    const forged = { ...authority, signatureBase64: signCanonical(authority) };
    await expect(
      runV213MageQualification(transport, input, admission, forged),
    ).rejects.toMatchObject({ code: "V213_STAGE_AUTHORITY_SIGNATURE_INVALID" });
    expect(transport.events).toEqual([]);
  });

  it("requires strictly increasing spaced timestamps for stable zero reads", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { staleTimestamps: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_ATTRIBUTABLE_CLEANUP_UNCONFIRMED",
    });
  });

  it("fails closed on unreconciled ACK_UNKNOWN and cleans attributable resources", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { ackUnknown: true, unrecoverableAck: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_DISPATCH_ACK_UNKNOWN",
    });
    expect(transport.events.filter((event) => event.startsWith("dispatch:"))).toHaveLength(1);
    expect(transport.events).toContain("delete:mage:qualification");
  });

  it("rejects volume drift in a signed receipt and never starts SoulX", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { badReceipt: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_QUALIFICATION_RECEIPT_INVALID",
    });
    expect(transport.events).not.toContain("create:soulx:qualification");
    expect(transport.events).toContain("delete:mage:qualification");
  });

  it("fails closed when cancellation is not terminal", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { cancelUnknown: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_CANCEL_UNCONFIRMED",
    });
    expect(transport.events).toContain("delete:soulx:qualification");
  });

  it("removes both intended production lanes if the stable drain proof fails", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { unstableDrain: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_ZERO_WORKER_DRAIN_UNCONFIRMED",
    });
    expect(transport.events.slice(-2)).toEqual([
      "delete:soulx:production",
      "delete:mage:production",
    ]);
  });

  it("stops the lane sequence on a terminal job failure", async () => {
    const input = await makeInput();
    const transport = makeFake(input, { failSoulx: true });
    await expect(runV213DualLaneLive(transport, input)).rejects.toMatchObject({
      code: "V213_JOB_FAILED",
    });
    expect(transport.events).not.toContain("create:mage:production");
  });
});
