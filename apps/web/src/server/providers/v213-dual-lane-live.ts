import { createHash, verify } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import {
  ReceiptVerificationError,
  type ProvenanceReceipt,
  type ProvenanceReceiptSigner,
  type ReceiptExpectation,
} from "@videoforge/control-plane";

import { verifyV213WorkerReceipt, type V213WorkerReceiptDelivery } from "./v213-provenance-receipt";

export const V213_REGION = "EU-RO-1" as const;
export const V213_GPU = "NVIDIA GeForce RTX 4090" as const;
export const V213_GPU_VRAM_BYTES = 24 * 1024 ** 3;
export const V213_GPU_VRAM_MIN_BYTES = 22 * 1024 ** 3;
export const V213_GPU_VRAM_MAX_BYTES = 25 * 1024 ** 3;
export const V213_MAX_RATE_USD_PER_GPU_HOUR = 1.116;
export const V213_TOTAL_CAP_USD = 17.5;
export const V213_MAGE_QUALIFICATION_CAP_USD = 4.5;
export const V213_SOULX_QUALIFICATION_CAP_USD = 1;
export const V213_VOLUME_SIZE_GB = 50;
export const V213_VOLUME_MOUNT = "/runpod-volume" as const;
export const V213_SOULX_COLD_READY_LIMIT_MS = 7 * 60 * 1_000;

export type V213Lane = "mage" | "soulx";
export type V213Availability = "LOW" | "MEDIUM" | "HIGH";
export type V213JobStatus =
  | "IN_QUEUE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

export class V213DualLaneError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "V213DualLaneError";
  }
}

export interface V213SealedLane {
  readonly lane: V213Lane;
  readonly publicImage: string;
  readonly sourceCommit: string;
  readonly deploymentSha256: string;
  readonly volumeId: string;
  readonly volumeIdSha256: string;
  readonly volumeManifestSha256: string;
  readonly receiptKeyId: string;
}

export interface V213AdmissionRead {
  readonly checkedAt: string;
  readonly accountIdSha256: string;
  readonly gpu: typeof V213_GPU;
  readonly region: typeof V213_REGION;
  readonly availability: V213Availability;
  readonly flexRateUsdPerGpuHour: number;
  readonly cumulativeBillingUsd: number;
  readonly runningPods: number;
  readonly activeWorkers: number;
  readonly endpoints: number;
  readonly privateTemplates: number;
  readonly volumes: readonly {
    readonly idSha256: string;
    readonly sizeGb: number;
    readonly region: typeof V213_REGION;
    readonly manifestSha256: string;
  }[];
}

export interface V213LaneDeployment {
  readonly lane: V213Lane;
  readonly purpose: "qualification" | "production";
  readonly endpointId: string;
  readonly endpointIdSha256: string;
  readonly templateId: string;
  readonly templateIdSha256: string;
  readonly image: string;
  readonly sourceCommit: string;
  readonly deploymentSha256: string;
  readonly volumeIdSha256: string;
  readonly volumeManifestSha256: string;
  readonly volumeSizeGb: 50;
  readonly volumeMount: typeof V213_VOLUME_MOUNT;
  readonly region: typeof V213_REGION;
  readonly gpu: typeof V213_GPU;
  readonly gpuCount: 1;
  readonly workersMin: 0;
  readonly workersMax: 1;
  readonly handlerConcurrency: 1;
  readonly scalerType: "REQUEST_COUNT";
  readonly scalerValue: 1;
  readonly initTimeoutSeconds: number;
}

export type V213Stage = "mage" | "soulx" | "production";
export type V213OperationKind = "create" | "readback" | "dispatch" | "status" | "cancel" | "delete";

export interface V213SignedStageAuthority {
  readonly schemaVersion: "videoforge.v213-stage-authority/v1";
  readonly authorityId: string;
  readonly stage: V213Stage;
  readonly inputSha256: string;
  readonly predecessorHandoffSha256: string;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly singleUse: true;
  readonly signatureBase64: string;
}

export interface V213DurableOperationRecord {
  readonly operationId: string;
  readonly stageAuthorityId: string;
  readonly kind: V213OperationKind;
  readonly requestSha256: string;
  readonly resourceKey: string;
  readonly state: "IN_FLIGHT" | "ACK_UNKNOWN" | "ACKED" | "TERMINAL";
  readonly providerId?: string;
  readonly evidence?: JsonValue;
}

export interface V213StageConsumptionRecord {
  readonly decision: "EXECUTE" | "RESUME" | "REPLAY_REJECTED";
  readonly authorityId: string;
  readonly nonceSha256: string;
  readonly consumedAt: string;
}

/** Implemented by the production database with atomic unique constraints and transitions. */
export interface V213DurableStageStore {
  readonly issueStageAuthority: (input: {
    readonly stage: V213Stage;
    readonly inputSha256: string;
    readonly predecessorHandoffSha256: string;
  }) => Promise<V213SignedStageAuthority>;
  readonly claimStageAuthority: (
    authority: V213SignedStageAuthority,
  ) => Promise<V213StageConsumptionRecord>;
  readonly completeStageAuthority: (
    authorityId: string,
    handoffSha256: string,
    handoff: JsonValue,
  ) => Promise<void>;
  /** First claim durably writes IN_FLIGHT before returning EXECUTE; restarts return RECONCILE. */
  readonly claimOperation: (
    input: Omit<V213DurableOperationRecord, "state" | "providerId">,
  ) => Promise<
    Readonly<{
      readonly action: "EXECUTE" | "RECONCILE" | "DONE";
      readonly record: V213DurableOperationRecord;
    }>
  >;
  readonly transitionOperation: (input: {
    readonly operationId: string;
    readonly from: V213DurableOperationRecord["state"];
    readonly to: V213DurableOperationRecord["state"];
    readonly providerId?: string;
    readonly evidence?: JsonValue;
  }) => Promise<V213DurableOperationRecord>;
}

export interface V213JobRead {
  readonly jobId: string;
  readonly status: V213JobStatus;
  readonly failureCode?: string;
  readonly receiptDelivery?: V213WorkerReceiptDelivery;
  readonly outputReadbackVerified?: true;
}

export type V213DispatchAck =
  | Readonly<{ readonly kind: "ACK"; readonly jobId: string }>
  | Readonly<{ readonly kind: "ACK_UNKNOWN" }>;

export interface V213InventoryRead {
  readonly checkedAt: string;
  readonly runningPods: number;
  readonly activeWorkers: number;
  readonly queuedJobs: number;
  readonly endpointIdSha256s: readonly string[];
  readonly templateIdSha256s: readonly string[];
  readonly volumes: V213AdmissionRead["volumes"];
}

/**
 * Concrete provider mechanics remain injected so tests and guarded activation can supply the same
 * low-level RunPod account, catalog, control and job clients without this module reading secrets.
 * Mutation calls are deliberately one-shot. Implementations must not retry create, dispatch,
 * cancel or delete behind this interface.
 */
export interface V213DualLaneTransport {
  readonly durable: V213DurableStageStore;
  readonly freshAdmission: () => Promise<V213AdmissionRead>;
  readonly createLane: (input: {
    readonly sealed: V213SealedLane;
    readonly purpose: "qualification" | "production";
    readonly resourceKey: string;
    readonly workersMin: 0;
    readonly workersMax: 1;
  }) => Promise<
    | Readonly<{ readonly kind: "ACK"; readonly deployment: V213LaneDeployment }>
    | Readonly<{
        readonly kind: "ACK_UNKNOWN";
        readonly partial?: Readonly<{
          readonly templateId: string;
          readonly templateIdSha256: string;
          readonly resourceKey: string;
        }>;
      }>
  >;
  readonly findLaneByResourceKey: (resourceKey: string) => Promise<V213LaneDeployment | null>;
  readonly readLane: (deployment: V213LaneDeployment) => Promise<V213LaneDeployment>;
  readonly dispatch: (input: {
    readonly deployment: V213LaneDeployment;
    readonly requestKey: string;
    readonly envelope: JsonValue;
  }) => Promise<V213DispatchAck>;
  /** One bounded lookup after ACK_UNKNOWN; it never dispatches. */
  readonly findJobByRequestKey: (input: {
    readonly endpointId: string;
    readonly requestKey: string;
  }) => Promise<Readonly<{ readonly jobId: string }> | null>;
  readonly status: (endpointId: string, jobId: string) => Promise<V213JobRead>;
  readonly cancel: (endpointId: string, jobId: string) => Promise<V213JobRead>;
  readonly deleteLane: (deployment: V213LaneDeployment) => Promise<void>;
  readonly inventory: () => Promise<V213InventoryRead>;
  readonly billingAmount: () => Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly now: () => Date;
}

export interface V213DualLaneInput {
  readonly accountIdSha256: string;
  readonly mage: V213SealedLane;
  readonly soulx: V213SealedLane;
  readonly billingBaselineUsd: number;
  readonly totalCapUsd: 17.5;
  readonly mageQualificationCapUsd: 4.5;
  readonly soulxQualificationCapUsd: 1;
  readonly stageAuthorityPublicKeyPem: string;
  /** Protected HMAC verifier. Its secret is never included in canonical handoffs. */
  readonly receiptSigner: ProvenanceReceiptSigner;
  readonly minimumStableReadSpacingMs?: number;
  readonly maxStatusReads?: number;
  readonly pollIntervalMs?: number;
  readonly envelopes: Readonly<{
    readonly mage: JsonValue;
    readonly soulx2s: JsonValue;
    readonly soulx4s: JsonValue;
    readonly soulx6s: JsonValue;
    readonly soulx10s: JsonValue;
    readonly soulxCancel: JsonValue;
    readonly soulxInvalidOutput: JsonValue;
    readonly soulxTimeout: JsonValue;
  }>;
}

export interface V213DualLaneSuccess {
  readonly schemaVersion: "videoforge.v213-dual-lane-live/v1";
  readonly qualified: true;
  readonly productionAuthorityConsumption: V213StageConsumptionRecord;
  readonly qualificationReceipts: readonly ProvenanceReceipt[];
  readonly production: Readonly<{
    readonly mage: V213LaneDeployment;
    readonly soulx: V213LaneDeployment;
  }>;
  readonly settled: Readonly<{
    readonly baselineBillingUsd: number;
    readonly finalBillingUsd: number;
    readonly observedIncrementUsd: number;
    readonly threeStableZeroWorkerReads: true;
  }>;
}

export interface V213AdmissionHandoff {
  readonly schemaVersion: "videoforge.v213-admission-handoff/v1";
  readonly inputSha256: string;
  readonly admission: V213AdmissionRead;
  readonly handoffSha256: string;
}

export interface V213MageQualificationHandoff {
  readonly schemaVersion: "videoforge.v213-mage-qualification-handoff/v1";
  readonly inputSha256: string;
  readonly priorHandoffSha256: string;
  readonly receipt: ProvenanceReceipt;
  readonly billingAfterUsd: number;
  readonly authorityConsumption: V213StageConsumptionRecord;
  readonly zeroWorkersAfter: true;
  readonly threeStableZeroWorkerReads: true;
  readonly handoffSha256: string;
}

export interface V213SoulXQualificationHandoff {
  readonly schemaVersion: "videoforge.v213-soulx-qualification-handoff/v1";
  readonly inputSha256: string;
  readonly priorHandoffSha256: string;
  readonly receipts: readonly ProvenanceReceipt[];
  readonly billingAfterUsd: number;
  readonly authorityConsumption: V213StageConsumptionRecord;
  readonly zeroWorkersAfter: true;
  readonly threeStableZeroWorkerReads: true;
  readonly handoffSha256: string;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;

const fail = (code: string): never => {
  throw new V213DualLaneError(code);
};

const hashId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const hashCanonical = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;

const hashV213Input = (input: V213DualLaneInput): string =>
  hashCanonical({
    accountIdSha256: input.accountIdSha256,
    mage: input.mage,
    soulx: input.soulx,
    billingBaselineUsd: input.billingBaselineUsd,
    totalCapUsd: input.totalCapUsd,
    mageQualificationCapUsd: input.mageQualificationCapUsd,
    soulxQualificationCapUsd: input.soulxQualificationCapUsd,
    stageAuthorityPublicKeyPem: input.stageAuthorityPublicKeyPem,
    maxStatusReads: input.maxStatusReads ?? 180,
    pollIntervalMs: input.pollIntervalMs ?? 2_000,
    envelopes: input.envelopes,
  });

const sealHandoff = <T extends object>(
  value: T,
): Readonly<T & { readonly handoffSha256: string }> =>
  Object.freeze({ ...value, handoffSha256: hashCanonical(value) });

const assertHandoffHash = (value: { readonly handoffSha256: string }): void => {
  const { handoffSha256, ...content } = value;
  if (!SHA256.test(handoffSha256) || hashCanonical(content) !== handoffSha256) {
    fail("V213_HANDOFF_HASH_MISMATCH");
  }
};

const signatureBytes = (value: string): Buffer => {
  if (!/^[A-Za-z0-9+/]{80,120}={0,2}$/u.test(value)) fail("V213_SIGNATURE_INVALID");
  return Buffer.from(value, "base64");
};

const verifySignedObject = (
  value: Readonly<Record<string, unknown>>,
  signatureBase64: string,
  publicKeyPem: string,
  code: string,
): void => {
  try {
    if (
      !verify(
        null,
        Buffer.from(canonicalizeJson(value as JsonValue), "utf8"),
        publicKeyPem,
        signatureBytes(signatureBase64),
      )
    ) {
      fail(code);
    }
  } catch (error) {
    if (error instanceof V213DualLaneError) throw error;
    fail(code);
  }
};

function assertStageAuthority(
  authority: V213SignedStageAuthority,
  input: V213DualLaneInput,
  stage: V213Stage,
  predecessorHandoffSha256: string,
  now: Date,
): void {
  const { signatureBase64, ...signed } = authority;
  if (
    authority.schemaVersion !== "videoforge.v213-stage-authority/v1" ||
    !ID.test(authority.authorityId) ||
    authority.stage !== stage ||
    authority.inputSha256 !== hashV213Input(input) ||
    authority.predecessorHandoffSha256 !== predecessorHandoffSha256 ||
    !/^[A-Za-z0-9_-]{32,128}$/u.test(authority.nonce) ||
    authority.singleUse !== true ||
    !Number.isFinite(Date.parse(authority.issuedAt)) ||
    !Number.isFinite(Date.parse(authority.expiresAt)) ||
    now.getTime() < Date.parse(authority.issuedAt) ||
    now.getTime() >= Date.parse(authority.expiresAt)
  ) {
    fail("V213_STAGE_AUTHORITY_INVALID");
  }
  verifySignedObject(
    signed,
    signatureBase64,
    input.stageAuthorityPublicKeyPem,
    "V213_STAGE_AUTHORITY_SIGNATURE_INVALID",
  );
}

async function consumeStageAuthority(
  transport: V213DualLaneTransport,
  authority: V213SignedStageAuthority,
): Promise<V213StageConsumptionRecord> {
  const consumed = await transport.durable.claimStageAuthority(authority);
  if (
    consumed.authorityId !== authority.authorityId ||
    consumed.nonceSha256 !== hashId(authority.nonce) ||
    !Number.isFinite(Date.parse(consumed.consumedAt)) ||
    Math.abs(transport.now().getTime() - Date.parse(consumed.consumedAt)) > 60_000
  ) {
    fail("V213_STAGE_CONSUMPTION_RECORD_INVALID");
  }
  if (consumed.decision === "REPLAY_REJECTED") fail("V213_STAGE_AUTHORITY_REPLAYED");
  return Object.freeze(consumed);
}

const operationIdentity = (
  authorityId: string,
  kind: V213OperationKind,
  resourceKey: string,
  requestSha256: string,
): Omit<V213DurableOperationRecord, "state" | "providerId"> => ({
  operationId: hashCanonical({ authorityId, kind, resourceKey, requestSha256 }).slice(7, 47),
  stageAuthorityId: authorityId,
  kind,
  requestSha256,
  resourceKey,
});

const finiteMoney = (value: number): boolean => Number.isFinite(value) && value >= 0;
const moneyLeq = (left: number, right: number): boolean => left <= right + 0.000_001;

function assertSealedLane(value: V213SealedLane, lane: V213Lane): void {
  if (
    value.lane !== lane ||
    !IMAGE.test(value.publicImage) ||
    !COMMIT.test(value.sourceCommit) ||
    !SHA256.test(value.deploymentSha256) ||
    !ID.test(value.volumeId) ||
    hashId(value.volumeId) !== value.volumeIdSha256 ||
    !SHA256.test(value.volumeManifestSha256) ||
    !ID.test(value.receiptKeyId)
  ) {
    fail("V213_SEALED_LANE_INVALID");
  }
}

function assertVolumes(
  volumes: V213AdmissionRead["volumes"],
  expected: readonly V213SealedLane[],
): void {
  const sorted = [...volumes].sort((left, right) => left.idSha256.localeCompare(right.idSha256));
  const expectedSorted = [...expected].sort((left, right) =>
    left.volumeIdSha256.localeCompare(right.volumeIdSha256),
  );
  if (
    sorted.length !== 2 ||
    sorted.some(
      (volume, index) =>
        volume.idSha256 !== expectedSorted[index]?.volumeIdSha256 ||
        volume.manifestSha256 !== expectedSorted[index]?.volumeManifestSha256 ||
        volume.sizeGb !== V213_VOLUME_SIZE_GB ||
        volume.region !== V213_REGION,
    )
  ) {
    fail("V213_VOLUME_INTEGRITY_MISMATCH");
  }
}

function assertAdmission(read: V213AdmissionRead, input: V213DualLaneInput): void {
  if (
    read.accountIdSha256 !== input.accountIdSha256 ||
    !SHA256.test(read.accountIdSha256) ||
    read.gpu !== V213_GPU ||
    read.region !== V213_REGION ||
    !(["LOW", "MEDIUM", "HIGH"] as const).includes(read.availability) ||
    !finiteMoney(read.flexRateUsdPerGpuHour) ||
    read.flexRateUsdPerGpuHour > V213_MAX_RATE_USD_PER_GPU_HOUR ||
    !finiteMoney(read.cumulativeBillingUsd) ||
    read.cumulativeBillingUsd < input.billingBaselineUsd ||
    read.runningPods !== 0 ||
    read.activeWorkers !== 0 ||
    read.endpoints !== 0 ||
    read.privateTemplates !== 0 ||
    !Number.isFinite(Date.parse(read.checkedAt))
  ) {
    fail("V213_FRESH_ADMISSION_REJECTED");
  }
  assertVolumes(read.volumes, [input.mage, input.soulx]);
}

function assertDeployment(
  actual: V213LaneDeployment,
  sealed: V213SealedLane,
  purpose: "qualification" | "production",
): void {
  if (
    actual.lane !== sealed.lane ||
    actual.purpose !== purpose ||
    !ID.test(actual.endpointId) ||
    hashId(actual.endpointId) !== actual.endpointIdSha256 ||
    !ID.test(actual.templateId) ||
    hashId(actual.templateId) !== actual.templateIdSha256 ||
    actual.image !== sealed.publicImage ||
    actual.sourceCommit !== sealed.sourceCommit ||
    actual.deploymentSha256 !== sealed.deploymentSha256 ||
    actual.volumeIdSha256 !== sealed.volumeIdSha256 ||
    actual.volumeManifestSha256 !== sealed.volumeManifestSha256 ||
    actual.volumeSizeGb !== 50 ||
    actual.volumeMount !== V213_VOLUME_MOUNT ||
    actual.region !== V213_REGION ||
    actual.gpu !== V213_GPU ||
    actual.gpuCount !== 1 ||
    actual.workersMin !== 0 ||
    actual.workersMax !== 1 ||
    actual.handlerConcurrency !== 1 ||
    actual.scalerType !== "REQUEST_COUNT" ||
    actual.scalerValue !== 1 ||
    !Number.isSafeInteger(actual.initTimeoutSeconds) ||
    actual.initTimeoutSeconds < 420 ||
    actual.initTimeoutSeconds > 900
  ) {
    fail("V213_DEPLOYMENT_READBACK_MISMATCH");
  }
}

const sameDeployment = (left: V213LaneDeployment, right: V213LaneDeployment): boolean =>
  canonicalizeJson(left as unknown as JsonValue) ===
  canonicalizeJson(right as unknown as JsonValue);

async function createAndReadLane(
  transport: V213DualLaneTransport,
  sealed: V213SealedLane,
  purpose: "qualification" | "production",
  authorityId: string,
): Promise<V213LaneDeployment> {
  const resourceKey = `v213-${authorityId}-${sealed.lane}-${purpose}`;
  const requestSha256 = hashCanonical({
    sealed,
    purpose,
    resourceKey,
    workersMin: 0,
    workersMax: 1,
  });
  const operation = operationIdentity(authorityId, "create", resourceKey, requestSha256);
  const claim = await transport.durable.claimOperation(operation);
  let operationState = claim.record.state;
  let created: V213LaneDeployment | null = null;
  if (claim.action === "DONE") {
    created = claim.record.evidence as V213LaneDeployment | null;
    created ??= await transport.findLaneByResourceKey(resourceKey);
  } else if (claim.action === "RECONCILE") {
    created = await transport.findLaneByResourceKey(resourceKey);
    created ??= claim.record.evidence as V213LaneDeployment | null;
  } else {
    let ack: Awaited<ReturnType<V213DualLaneTransport["createLane"]>>;
    try {
      ack = await transport.createLane({
        sealed,
        purpose,
        resourceKey,
        workersMin: 0,
        workersMax: 1,
      });
    } catch {
      ack = { kind: "ACK_UNKNOWN" };
    }
    if (ack.kind === "ACK") created = ack.deployment;
    if (created === null) {
      const unknown = await transport.durable.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "ACK_UNKNOWN",
        ...(ack.kind === "ACK_UNKNOWN" && ack.partial
          ? { providerId: ack.partial.templateId, evidence: ack.partial as unknown as JsonValue }
          : {}),
      });
      operationState = unknown.state;
      created = await transport.findLaneByResourceKey(resourceKey);
    }
  }
  if (created === null) throw new V213DualLaneError("V213_CREATE_ACK_UNKNOWN");
  assertDeployment(created, sealed, purpose);
  if (operationState !== "TERMINAL" && operationState !== "ACKED") {
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: operationState,
      to: "ACKED",
      providerId: created.endpointId,
      evidence: created as unknown as JsonValue,
    });
  }
  const readOperation = operationIdentity(
    authorityId,
    "readback",
    resourceKey,
    hashCanonical(created),
  );
  const readClaim = await transport.durable.claimOperation(readOperation);
  if (readClaim.action !== "DONE") {
    const readback = await transport.readLane(created);
    assertDeployment(readback, sealed, purpose);
    if (!sameDeployment(created, readback)) fail("V213_DEPLOYMENT_READBACK_MISMATCH");
  }
  if (readClaim.record.state !== "TERMINAL") {
    await transport.durable.transitionOperation({
      operationId: readOperation.operationId,
      from: readClaim.record.state,
      to: "TERMINAL",
      providerId: created.endpointId,
      evidence: created as unknown as JsonValue,
    });
  }
  return created;
}

type Case = Readonly<{
  lane: V213Lane;
  id: string;
  envelope: JsonValue;
  seconds: number;
  mode: "complete" | "cancel" | "invalid" | "timeout";
  cold: boolean;
}>;

async function dispatchOnce(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  testCase: Case,
  authorityId: string,
): Promise<{ jobId: string; requestSha256: string; envelopeSha256: string }> {
  const requestKey = `v213-${testCase.id}`;
  if (
    !testCase.envelope ||
    typeof testCase.envelope !== "object" ||
    Array.isArray(testCase.envelope)
  ) {
    fail("V213_QUALIFICATION_REQUEST_INVALID");
  }
  const request = testCase.envelope as Record<string, JsonValue>;
  const signedEnvelope = request.envelope;
  if (!signedEnvelope || typeof signedEnvelope !== "object" || Array.isArray(signedEnvelope)) {
    fail("V213_QUALIFICATION_REQUEST_INVALID");
  }
  const { envelope: _envelope, ...requestBody } = request;
  const envelopeSha256 = hashCanonical(signedEnvelope);
  const requestSha256 = hashCanonical(requestBody);
  const operation = operationIdentity(authorityId, "dispatch", requestKey, requestSha256);
  const claim = await transport.durable.claimOperation(operation);
  if (claim.action === "DONE" && claim.record.providerId && ID.test(claim.record.providerId)) {
    return { jobId: claim.record.providerId, requestSha256, envelopeSha256 };
  }
  let state = claim.record.state;
  let recovered: Readonly<{ readonly jobId: string }> | null =
    claim.record.providerId && ID.test(claim.record.providerId)
      ? { jobId: claim.record.providerId }
      : null;
  if (claim.action === "EXECUTE") {
    let ack: V213DispatchAck;
    try {
      ack = await transport.dispatch({ deployment, requestKey, envelope: testCase.envelope });
    } catch {
      ack = { kind: "ACK_UNKNOWN" };
    }
    if (ack.kind === "ACK") recovered = { jobId: ack.jobId };
    else {
      const unknown = await transport.durable.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "ACK_UNKNOWN",
      });
      state = unknown.state;
    }
  }
  recovered ??= await transport.findJobByRequestKey({
    endpointId: deployment.endpointId,
    requestKey,
  });
  if (!recovered || !ID.test(recovered.jobId)) {
    throw new V213DualLaneError("V213_DISPATCH_ACK_UNKNOWN");
  }
  if (state !== "ACKED" && state !== "TERMINAL") {
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: state,
      to: "ACKED",
      providerId: recovered.jobId,
    });
  }
  return { jobId: recovered.jobId, requestSha256, envelopeSha256 };
}

function assertReceipt(
  delivery: V213WorkerReceiptDelivery | undefined,
  deployment: V213LaneDeployment,
  testCase: Case,
  providerJobId: string,
  requestSha256: string,
  envelopeSha256: string,
  signer: ProvenanceReceiptSigner,
  usedReceiptNonces: Set<number>,
): ProvenanceReceipt {
  if (!delivery) throw new V213DualLaneError("V213_QUALIFICATION_RECEIPT_INVALID");
  const request = testCase.envelope as Record<string, JsonValue>;
  const signedEnvelope = request.envelope as Record<string, JsonValue>;
  const tenant = signedEnvelope.tenant as Record<string, JsonValue>;
  const work = signedEnvelope.work as Record<string, JsonValue>;
  const runtime = signedEnvelope.runtime as Record<string, JsonValue>;
  const dispatchToken = signedEnvelope.dispatch_token;
  if (
    typeof tenant?.account_id !== "string" ||
    typeof tenant.workspace_id !== "string" ||
    typeof work?.attempt_id !== "string" ||
    typeof runtime?.deployment_id !== "string" ||
    typeof dispatchToken !== "string"
  ) {
    fail("V213_QUALIFICATION_REQUEST_INVALID");
  }
  const expectation: ReceiptExpectation = {
    dispatchTokenSha256: hashId(dispatchToken as string) as `sha256:${string}`,
    envelopeSha256: envelopeSha256 as `sha256:${string}`,
    requestSha256: requestSha256 as `sha256:${string}`,
    attemptId: work.attempt_id as string,
    providerJobId,
    accountId: tenant.account_id as string,
    workspaceId: tenant.workspace_id as string,
    deploymentId: runtime.deployment_id as string,
    endpointIdSha256: deployment.endpointIdSha256 as `sha256:${string}`,
    containerDigest: deployment.image.slice(
      deployment.image.indexOf("sha256:"),
    ) as `sha256:${string}`,
    volumeIdSha256: deployment.volumeIdSha256 as `sha256:${string}`,
    volumeManifestSha256: deployment.volumeManifestSha256 as `sha256:${string}`,
    modelManifestSha256: deployment.volumeManifestSha256 as `sha256:${string}`,
    gpuAllowlist: [V213_GPU],
    seenNonces: usedReceiptNonces,
  };
  const receipt: ProvenanceReceipt = (() => {
    try {
      return verifyV213WorkerReceipt(signer, delivery, expectation).receipt;
    } catch (error) {
      if (
        error instanceof ReceiptVerificationError &&
        (error.code === "RECEIPT_SIGNATURE_INVALID" || error.code === "RECEIPT_HASH_MISMATCH")
      ) {
        return fail("V213_QUALIFICATION_RECEIPT_SIGNATURE_INVALID");
      }
      return fail("V213_QUALIFICATION_RECEIPT_INVALID");
    }
  })();
  const items = receipt.items;
  const probes = items.map((item) => item.probe);
  const containerReadyMs = receipt.timings.container_ready_ms;
  const totalMs = receipt.timings.total_ms;
  if (
    receipt.lane !== (testCase.lane === "mage" ? "mage_image" : "soulx_avatar") ||
    receipt.signature.key_id !== signer.keyId ||
    usedReceiptNonces.has(receipt.receipt_nonce) ||
    !Number.isSafeInteger(receipt.runtime_probe.total_vram_bytes) ||
    receipt.runtime_probe.total_vram_bytes < V213_GPU_VRAM_MIN_BYTES ||
    receipt.runtime_probe.total_vram_bytes > V213_GPU_VRAM_MAX_BYTES ||
    !Number.isSafeInteger(receipt.runtime_probe.peak_vram_bytes) ||
    receipt.runtime_probe.peak_vram_bytes <= 0 ||
    receipt.runtime_probe.peak_vram_bytes > receipt.runtime_probe.total_vram_bytes ||
    !Number.isSafeInteger(containerReadyMs) ||
    typeof containerReadyMs !== "number" ||
    (testCase.cold && containerReadyMs >= V213_SOULX_COLD_READY_LIMIT_MS) ||
    !Number.isSafeInteger(totalMs) ||
    typeof totalMs !== "number" ||
    totalMs <= 0 ||
    items.length < 1 ||
    items.some((item) => item.state !== "SUCCEEDED" || !item.output_sha256) ||
    (testCase.lane === "mage" &&
      probes.some(
        (probe) => probe.format !== "png" || probe.width !== 1280 || probe.height !== 720,
      )) ||
    (testCase.lane === "soulx" &&
      probes.some(
        (probe) =>
          probe.format !== "mp4" ||
          probe.width !== 512 ||
          probe.height !== 512 ||
          probe.fps_num !== 25 ||
          probe.fps_den !== 1 ||
          typeof probe.duration_ms !== "number" ||
          Math.abs(probe.duration_ms - testCase.seconds * 1_000) > 80,
      ))
  ) {
    fail("V213_QUALIFICATION_RECEIPT_INVALID");
  }
  usedReceiptNonces.add(receipt.receipt_nonce);
  return receipt;
}

async function runCase(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  testCase: Case,
  maxReads: number,
  pollMs: number,
  authorityId: string,
  signer: ProvenanceReceiptSigner,
  usedReceiptNonces: Set<number>,
): Promise<ProvenanceReceipt | null> {
  const dispatched = await dispatchOnce(transport, deployment, testCase, authorityId);
  const { jobId } = dispatched;
  if (testCase.mode === "cancel") {
    const cancelled = await cancelJobDurably(transport, deployment, jobId, authorityId);
    if (cancelled.jobId !== jobId || cancelled.status !== "CANCELLED") {
      fail("V213_CANCEL_UNCONFIRMED");
    }
    return null;
  }
  for (let read = 0; read < maxReads; read += 1) {
    const observed = await readJobDurably(transport, deployment, jobId, authorityId, read);
    if (observed.jobId !== jobId) fail("V213_JOB_ID_MISMATCH");
    if (observed.status === "IN_QUEUE" || observed.status === "IN_PROGRESS") {
      if (read + 1 < maxReads) await transport.sleep(pollMs);
      continue;
    }
    if (testCase.mode === "invalid") {
      if (
        observed.status !== "FAILED" ||
        observed.failureCode !== "SOULX_OUTPUT_CONTRACT_INVALID"
      ) {
        fail("V213_INVALID_OUTPUT_FAULT_UNPROVEN");
      }
      return null;
    }
    if (testCase.mode === "timeout") {
      if (observed.status !== "TIMED_OUT") fail("V213_TIMEOUT_FAULT_UNPROVEN");
      return null;
    }
    if (observed.status !== "COMPLETED") fail("V213_JOB_FAILED");
    if (observed.outputReadbackVerified !== true) fail("V213_OUTPUT_READBACK_UNCONFIRMED");
    return assertReceipt(
      observed.receiptDelivery,
      deployment,
      testCase,
      jobId,
      dispatched.requestSha256,
      dispatched.envelopeSha256,
      signer,
      usedReceiptNonces,
    );
  }
  const cancelled = await cancelJobDurably(transport, deployment, jobId, authorityId);
  if (cancelled.jobId !== jobId || cancelled.status !== "CANCELLED") {
    fail("V213_STATUS_TIMEOUT_CANCEL_UNCONFIRMED");
  }
  throw new V213DualLaneError("V213_STATUS_TIMEOUT");
}

async function readJobDurably(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  jobId: string,
  authorityId: string,
  read: number,
): Promise<V213JobRead> {
  const resourceKey = `${deployment.endpointIdSha256}:${jobId}:${read}`;
  const operation = operationIdentity(
    authorityId,
    "status",
    resourceKey,
    hashCanonical({ endpointIdSha256: deployment.endpointIdSha256, jobId, read }),
  );
  const claim = await transport.durable.claimOperation(operation);
  if (claim.action === "DONE" && claim.record.evidence) {
    return claim.record.evidence as unknown as V213JobRead;
  }
  const observed = await transport.status(deployment.endpointId, jobId);
  if (claim.record.state !== "TERMINAL") {
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: claim.record.state,
      to: "TERMINAL",
      providerId: jobId,
      evidence: observed as unknown as JsonValue,
    });
  }
  return observed;
}

async function cancelJobDurably(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  jobId: string,
  authorityId: string,
): Promise<V213JobRead> {
  const resourceKey = `${deployment.endpointIdSha256}:${jobId}`;
  const operation = operationIdentity(
    authorityId,
    "cancel",
    resourceKey,
    hashCanonical({ endpointIdSha256: deployment.endpointIdSha256, jobId }),
  );
  const claim = await transport.durable.claimOperation(operation);
  let operationState = claim.record.state;
  let observed: V213JobRead;
  if (claim.action === "DONE" && claim.record.evidence) {
    return claim.record.evidence as unknown as V213JobRead;
  }
  if (claim.action === "EXECUTE") {
    try {
      observed = await transport.cancel(deployment.endpointId, jobId);
    } catch {
      const unknown = await transport.durable.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "ACK_UNKNOWN",
      });
      operationState = unknown.state;
      observed = await transport.status(deployment.endpointId, jobId);
      if (observed.status !== "CANCELLED") {
        if (unknown.state !== "ACK_UNKNOWN") fail("V213_CANCEL_UNCONFIRMED");
        fail("V213_CANCEL_UNCONFIRMED");
      }
    }
  } else {
    // A restart after IN_FLIGHT/ACK_UNKNOWN must reconcile by GET and never cancel twice.
    observed = await transport.status(deployment.endpointId, jobId);
  }
  if (observed.status !== "CANCELLED") fail("V213_CANCEL_UNCONFIRMED");
  if (operationState !== "TERMINAL") {
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: operationState,
      to: "TERMINAL",
      providerId: jobId,
      evidence: observed as unknown as JsonValue,
    });
  }
  return observed;
}

function assertInput(input: V213DualLaneInput): void {
  assertSealedLane(input.mage, "mage");
  assertSealedLane(input.soulx, "soulx");
  if (
    !SHA256.test(input.accountIdSha256) ||
    !input.stageAuthorityPublicKeyPem.includes("PUBLIC KEY") ||
    input.receiptSigner.keyId !== input.mage.receiptKeyId ||
    input.receiptSigner.keyId !== input.soulx.receiptKeyId ||
    !finiteMoney(input.billingBaselineUsd) ||
    input.totalCapUsd !== V213_TOTAL_CAP_USD ||
    input.mageQualificationCapUsd !== V213_MAGE_QUALIFICATION_CAP_USD ||
    input.soulxQualificationCapUsd !== V213_SOULX_QUALIFICATION_CAP_USD ||
    (input.minimumStableReadSpacingMs !== undefined &&
      (!Number.isSafeInteger(input.minimumStableReadSpacingMs) ||
        input.minimumStableReadSpacingMs < 250 ||
        input.minimumStableReadSpacingMs > 10_000))
  ) {
    fail("V213_AUTHORITY_CAP_INVALID");
  }
  if (input.mage.volumeIdSha256 === input.soulx.volumeIdSha256) {
    fail("V213_VOLUME_INTEGRITY_MISMATCH");
  }
}

export async function issueV213StageAuthority(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  stage: V213Stage,
  predecessorHandoffSha256: string,
): Promise<V213SignedStageAuthority> {
  assertInput(input);
  if (!SHA256.test(predecessorHandoffSha256)) fail("V213_STAGE_PREDECESSOR_INVALID");
  const authority = await transport.durable.issueStageAuthority({
    stage,
    inputSha256: hashV213Input(input),
    predecessorHandoffSha256,
  });
  assertStageAuthority(authority, input, stage, predecessorHandoffSha256, transport.now());
  return Object.freeze(authority);
}

function assertPhaseSpend(
  phase: V213Lane,
  baseline: number,
  before: number,
  after: number,
  phaseCap: number,
): void {
  if (
    !finiteMoney(before) ||
    !finiteMoney(after) ||
    after < before ||
    before < baseline ||
    !moneyLeq(after - before, phaseCap) ||
    !moneyLeq(after - baseline, V213_TOTAL_CAP_USD)
  ) {
    fail(`V213_${phase.toUpperCase()}_CAP_BREACH`);
  }
}

async function stableFinalRead(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  production: readonly V213LaneDeployment[],
): Promise<{ finalBilling: number; increment: number }> {
  const expectedEndpoints = production.map((item) => item.endpointIdSha256).sort();
  const expectedTemplates = production.map((item) => item.templateIdSha256).sort();
  let priorBilling: number | null = null;
  let priorCheckedAt = 0;
  let finalBilling = 0;
  for (let read = 0; read < 3; read += 1) {
    const [inventory, billing] = await Promise.all([
      transport.inventory(),
      transport.billingAmount(),
    ]);
    const checkedAt = Date.parse(inventory.checkedAt);
    const spacing = input.minimumStableReadSpacingMs ?? 250;
    if (
      !Number.isFinite(checkedAt) ||
      Math.abs(transport.now().getTime() - checkedAt) > 60_000 ||
      (priorCheckedAt !== 0 && checkedAt - priorCheckedAt < spacing) ||
      inventory.runningPods !== 0 ||
      inventory.activeWorkers !== 0 ||
      inventory.queuedJobs !== 0 ||
      canonicalizeJson([...inventory.endpointIdSha256s].sort()) !==
        canonicalizeJson(expectedEndpoints) ||
      canonicalizeJson([...inventory.templateIdSha256s].sort()) !==
        canonicalizeJson(expectedTemplates)
    ) {
      fail("V213_ZERO_WORKER_DRAIN_UNCONFIRMED");
    }
    assertVolumes(inventory.volumes, [input.mage, input.soulx]);
    if (
      !finiteMoney(billing) ||
      billing < input.billingBaselineUsd ||
      !moneyLeq(billing - input.billingBaselineUsd, input.totalCapUsd) ||
      (priorBilling !== null && Math.abs(billing - priorBilling) > 0.000_001)
    ) {
      fail("V213_BILLING_UNSETTLED");
    }
    priorBilling = billing;
    priorCheckedAt = checkedAt;
    finalBilling = billing;
    if (read < 2) await transport.sleep(spacing);
  }
  return { finalBilling, increment: finalBilling - input.billingBaselineUsd };
}

const pollPolicy = (input: V213DualLaneInput): { maxReads: number; pollMs: number } => {
  const maxReads = input.maxStatusReads ?? 180;
  const pollMs = input.pollIntervalMs ?? 2_000;
  if (
    !Number.isSafeInteger(maxReads) ||
    maxReads < 1 ||
    maxReads > 360 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 100 ||
    pollMs > 10_000
  ) {
    fail("V213_POLL_POLICY_INVALID");
  }
  return { maxReads, pollMs };
};

async function cleanupCreated(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  created: readonly V213LaneDeployment[],
  authorityId: string,
): Promise<void> {
  let failed = false;
  for (const deployment of [...created].reverse()) {
    try {
      await deleteLaneDurably(transport, deployment, authorityId);
    } catch {
      failed = true;
    }
  }
  if (failed) fail("V213_ATTRIBUTABLE_CLEANUP_UNCONFIRMED");
  try {
    await stableQualificationZeroRead(transport, input);
  } catch {
    fail("V213_ATTRIBUTABLE_CLEANUP_UNCONFIRMED");
  }
}

async function deleteLaneDurably(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  authorityId: string,
): Promise<void> {
  const resourceKey = `v213-${authorityId}-${deployment.lane}-${deployment.purpose}`;
  const operation = operationIdentity(
    authorityId,
    "delete",
    resourceKey,
    hashCanonical({ endpointIdSha256: deployment.endpointIdSha256, resourceKey }),
  );
  const claim = await transport.durable.claimOperation(operation);
  let state = claim.record.state;
  if (claim.action === "EXECUTE") {
    try {
      await transport.deleteLane(deployment);
    } catch {
      const unknown = await transport.durable.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "ACK_UNKNOWN",
      });
      state = unknown.state;
    }
  }
  if ((await transport.findLaneByResourceKey(resourceKey)) !== null) {
    fail("V213_DELETE_UNCONFIRMED");
  }
  if (state !== "TERMINAL") {
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: state,
      to: "TERMINAL",
      providerId: deployment.endpointId,
    });
  }
}

async function stableQualificationZeroRead(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
): Promise<number> {
  let priorBilling: number | null = null;
  let priorCheckedAt = 0;
  let finalBilling = 0;
  for (let read = 0; read < 3; read += 1) {
    const [inventory, billing] = await Promise.all([
      transport.inventory(),
      transport.billingAmount(),
    ]);
    const checkedAt = Date.parse(inventory.checkedAt);
    const spacing = input.minimumStableReadSpacingMs ?? 250;
    if (
      !Number.isFinite(checkedAt) ||
      Math.abs(transport.now().getTime() - checkedAt) > 60_000 ||
      (priorCheckedAt !== 0 && checkedAt - priorCheckedAt < spacing) ||
      inventory.runningPods !== 0 ||
      inventory.activeWorkers !== 0 ||
      inventory.queuedJobs !== 0 ||
      inventory.endpointIdSha256s.length !== 0 ||
      inventory.templateIdSha256s.length !== 0
    ) {
      fail("V213_QUALIFICATION_ZERO_WORKER_DRAIN_UNCONFIRMED");
    }
    assertVolumes(inventory.volumes, [input.mage, input.soulx]);
    if (
      !finiteMoney(billing) ||
      billing < input.billingBaselineUsd ||
      !moneyLeq(billing - input.billingBaselineUsd, input.totalCapUsd) ||
      (priorBilling !== null && Math.abs(billing - priorBilling) > 0.000_001)
    ) {
      fail("V213_BILLING_UNSETTLED");
    }
    priorBilling = billing;
    priorCheckedAt = checkedAt;
    finalBilling = billing;
    if (read < 2) await transport.sleep(spacing);
  }
  return finalBilling;
}

/** Read-only first stage. Persist its exact handoff before authorizing the Mage mutation stage. */
export async function readV213DualLaneAdmission(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
): Promise<V213AdmissionHandoff> {
  assertInput(input);
  pollPolicy(input);
  const admission = await transport.freshAdmission();
  assertAdmission(admission, input);
  if (Math.abs(transport.now().getTime() - Date.parse(admission.checkedAt)) > 60_000) {
    fail("V213_FRESH_ADMISSION_REJECTED");
  }
  if (
    !moneyLeq(
      admission.cumulativeBillingUsd -
        input.billingBaselineUsd +
        input.mageQualificationCapUsd +
        input.soulxQualificationCapUsd,
      input.totalCapUsd,
    )
  ) {
    fail("V213_CAP_RESERVATION_REJECTED");
  }
  return sealHandoff({
    schemaVersion: "videoforge.v213-admission-handoff/v1" as const,
    inputSha256: hashV213Input(input),
    admission,
  });
}

/** Mutating Mage-only stage. The exact admission handoff must be durably committed first. */
export async function runV213MageQualification(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  admissionHandoff: V213AdmissionHandoff,
  authority: V213SignedStageAuthority,
): Promise<V213MageQualificationHandoff> {
  assertInput(input);
  const { maxReads, pollMs } = pollPolicy(input);
  assertHandoffHash(admissionHandoff);
  if (
    admissionHandoff.schemaVersion !== "videoforge.v213-admission-handoff/v1" ||
    admissionHandoff.inputSha256 !== hashV213Input(input)
  ) {
    fail("V213_MAGE_STAGE_PREDECESSOR_INVALID");
  }
  assertStageAuthority(authority, input, "mage", admissionHandoff.handoffSha256, transport.now());
  const authorityConsumption = await consumeStageAuthority(transport, authority);
  const created: V213LaneDeployment[] = [];
  try {
    const mageBefore = await transport.billingAmount();
    const mageQualification = await createAndReadLane(
      transport,
      input.mage,
      "qualification",
      authority.authorityId,
    );
    created.push(mageQualification);
    const mageCase: Case = {
      lane: "mage",
      id: "mage-cold-representative",
      envelope: input.envelopes.mage,
      seconds: 0,
      mode: "complete",
      cold: true,
    };
    const mageReceipt = await runCase(
      transport,
      mageQualification,
      mageCase,
      maxReads,
      pollMs,
      authority.authorityId,
      input.receiptSigner,
      new Set<number>(),
    );
    if (!mageReceipt) throw new V213DualLaneError("V213_MAGE_QUALIFICATION_INCOMPLETE");
    created.splice(created.indexOf(mageQualification), 1);
    await deleteLaneDurably(transport, mageQualification, authority.authorityId);
    const mageAfter = await stableQualificationZeroRead(transport, input);
    assertPhaseSpend(
      "mage",
      input.billingBaselineUsd,
      mageBefore,
      mageAfter,
      input.mageQualificationCapUsd,
    );
    const handoff = sealHandoff({
      schemaVersion: "videoforge.v213-mage-qualification-handoff/v1" as const,
      inputSha256: hashV213Input(input),
      priorHandoffSha256: admissionHandoff.handoffSha256,
      receipt: mageReceipt,
      billingAfterUsd: mageAfter,
      authorityConsumption,
      zeroWorkersAfter: true as const,
      threeStableZeroWorkerReads: true as const,
    });
    await transport.durable.completeStageAuthority(
      authority.authorityId,
      handoff.handoffSha256,
      handoff as unknown as JsonValue,
    );
    return handoff;
  } catch (error) {
    await cleanupCreated(transport, input, created, authority.authorityId);
    throw error;
  }
}

/** Mutating SoulX-only stage. It cannot run without the exact Mage PASS handoff. */
export async function runV213SoulXQualification(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  mageHandoff: V213MageQualificationHandoff,
  authority: V213SignedStageAuthority,
): Promise<V213SoulXQualificationHandoff> {
  assertInput(input);
  const { maxReads, pollMs } = pollPolicy(input);
  assertHandoffHash(mageHandoff);
  if (
    mageHandoff.schemaVersion !== "videoforge.v213-mage-qualification-handoff/v1" ||
    mageHandoff.inputSha256 !== hashV213Input(input) ||
    !moneyLeq(
      mageHandoff.billingAfterUsd - input.billingBaselineUsd + input.soulxQualificationCapUsd,
      input.totalCapUsd,
    )
  ) {
    fail("V213_SOULX_STAGE_PREDECESSOR_INVALID");
  }
  assertStageAuthority(authority, input, "soulx", mageHandoff.handoffSha256, transport.now());
  const authorityConsumption = await consumeStageAuthority(transport, authority);
  const created: V213LaneDeployment[] = [];
  try {
    const soulxBefore = mageHandoff.billingAfterUsd;
    const soulxQualification = await createAndReadLane(
      transport,
      input.soulx,
      "qualification",
      authority.authorityId,
    );
    created.push(soulxQualification);
    const soulxCases: readonly Case[] = [
      {
        lane: "soulx",
        id: "soulx-cold-2s",
        envelope: input.envelopes.soulx2s,
        seconds: 2,
        mode: "complete",
        cold: true,
      },
      {
        lane: "soulx",
        id: "soulx-warm-4s",
        envelope: input.envelopes.soulx4s,
        seconds: 4,
        mode: "complete",
        cold: false,
      },
      {
        lane: "soulx",
        id: "soulx-warm-6s",
        envelope: input.envelopes.soulx6s,
        seconds: 6,
        mode: "complete",
        cold: false,
      },
      {
        lane: "soulx",
        id: "soulx-warm-10s",
        envelope: input.envelopes.soulx10s,
        seconds: 10,
        mode: "complete",
        cold: false,
      },
      {
        lane: "soulx",
        id: "soulx-cancel",
        envelope: input.envelopes.soulxCancel,
        seconds: 2,
        mode: "cancel",
        cold: false,
      },
      {
        lane: "soulx",
        id: "soulx-invalid-output",
        envelope: input.envelopes.soulxInvalidOutput,
        seconds: 2,
        mode: "invalid",
        cold: false,
      },
      {
        lane: "soulx",
        id: "soulx-timeout",
        envelope: input.envelopes.soulxTimeout,
        seconds: 2,
        mode: "timeout",
        cold: false,
      },
    ];
    const receipts: ProvenanceReceipt[] = [];
    const usedReceiptNonces = new Set<number>();
    for (const testCase of soulxCases) {
      const receipt = await runCase(
        transport,
        soulxQualification,
        testCase,
        maxReads,
        pollMs,
        authority.authorityId,
        input.receiptSigner,
        usedReceiptNonces,
      );
      if (receipt) receipts.push(receipt);
    }
    created.splice(created.indexOf(soulxQualification), 1);
    await deleteLaneDurably(transport, soulxQualification, authority.authorityId);
    const soulxAfter = await stableQualificationZeroRead(transport, input);
    assertPhaseSpend(
      "soulx",
      input.billingBaselineUsd,
      soulxBefore,
      soulxAfter,
      input.soulxQualificationCapUsd,
    );
    const handoff = sealHandoff({
      schemaVersion: "videoforge.v213-soulx-qualification-handoff/v1" as const,
      inputSha256: hashV213Input(input),
      priorHandoffSha256: mageHandoff.handoffSha256,
      receipts: Object.freeze([...receipts]),
      billingAfterUsd: soulxAfter,
      authorityConsumption,
      zeroWorkersAfter: true as const,
      threeStableZeroWorkerReads: true as const,
    });
    await transport.durable.completeStageAuthority(
      authority.authorityId,
      handoff.handoffSha256,
      handoff as unknown as JsonValue,
    );
    return handoff;
  } catch (error) {
    await cleanupCreated(transport, input, created, authority.authorityId);
    throw error;
  }
}

/** Production mutation stage. It creates no endpoint until both exact qualification handoffs pass. */
export async function createV213Max1Deployments(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
  mageHandoff: V213MageQualificationHandoff,
  soulxHandoff: V213SoulXQualificationHandoff,
  authority: V213SignedStageAuthority,
): Promise<V213DualLaneSuccess> {
  assertInput(input);
  assertHandoffHash(mageHandoff);
  assertHandoffHash(soulxHandoff);
  if (
    mageHandoff.schemaVersion !== "videoforge.v213-mage-qualification-handoff/v1" ||
    soulxHandoff.schemaVersion !== "videoforge.v213-soulx-qualification-handoff/v1" ||
    mageHandoff.inputSha256 !== hashV213Input(input) ||
    soulxHandoff.inputSha256 !== hashV213Input(input) ||
    soulxHandoff.priorHandoffSha256 !== mageHandoff.handoffSha256
  ) {
    fail("V213_PRODUCTION_STAGE_PREDECESSOR_INVALID");
  }
  assertStageAuthority(authority, input, "production", soulxHandoff.handoffSha256, transport.now());
  const authorityConsumption = await consumeStageAuthority(transport, authority);
  const created: V213LaneDeployment[] = [];
  try {
    // Intended production resources exist only after both exact lane qualifications pass.
    const mageProduction = await createAndReadLane(
      transport,
      input.mage,
      "production",
      authority.authorityId,
    );
    created.push(mageProduction);
    const soulxProduction = await createAndReadLane(
      transport,
      input.soulx,
      "production",
      authority.authorityId,
    );
    created.push(soulxProduction);

    const settled = await stableFinalRead(transport, input, [mageProduction, soulxProduction]);
    const receipts = [mageHandoff.receipt, ...soulxHandoff.receipts];
    const qualificationCap = input.mageQualificationCapUsd + input.soulxQualificationCapUsd;
    if (!moneyLeq(settled.increment, qualificationCap)) {
      fail("V213_QUALIFICATION_CAP_BREACH");
    }
    const result = Object.freeze({
      schemaVersion: "videoforge.v213-dual-lane-live/v1",
      qualified: true,
      productionAuthorityConsumption: authorityConsumption,
      qualificationReceipts: Object.freeze([...receipts]),
      production: Object.freeze({ mage: mageProduction, soulx: soulxProduction }),
      settled: Object.freeze({
        baselineBillingUsd: input.billingBaselineUsd,
        finalBillingUsd: settled.finalBilling,
        observedIncrementUsd: settled.increment,
        threeStableZeroWorkerReads: true,
      }),
    });
    await transport.durable.completeStageAuthority(
      authority.authorityId,
      hashCanonical(result),
      result as unknown as JsonValue,
    );
    return result;
  } catch (error) {
    await cleanupCreated(transport, input, created, authority.authorityId);
    throw error;
  }
}

/**
 * Convenience composition for bounded callers that durably persist each returned handoff between
 * calls. Production executors should call the four explicit exports directly at transaction
 * boundaries; this wrapper exists for provider-free tests and single-process tools.
 */
export async function runV213DualLaneLive(
  transport: V213DualLaneTransport,
  input: V213DualLaneInput,
): Promise<V213DualLaneSuccess> {
  const admission = await readV213DualLaneAdmission(transport, input);
  const mageAuthority = await issueV213StageAuthority(
    transport,
    input,
    "mage",
    admission.handoffSha256,
  );
  const mage = await runV213MageQualification(transport, input, admission, mageAuthority);
  const soulxAuthority = await issueV213StageAuthority(
    transport,
    input,
    "soulx",
    mage.handoffSha256,
  );
  const soulx = await runV213SoulXQualification(transport, input, mage, soulxAuthority);
  const productionAuthority = await issueV213StageAuthority(
    transport,
    input,
    "production",
    soulx.handoffSha256,
  );
  return createV213Max1Deployments(transport, input, mage, soulx, productionAuthority);
}
