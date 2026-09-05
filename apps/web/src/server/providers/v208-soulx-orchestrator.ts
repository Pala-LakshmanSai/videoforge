import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import type {
  V213DualLaneTransport,
  V213LaneDeployment,
  V213JobRead,
  V213QualificationCaseDescriptor,
  V213QualificationCaseMaterialization,
  V213SealedLane,
} from "./v213-dual-lane-live.js";
import {
  cancelJobDurably,
  createAndReadLane,
  deleteLaneDurably,
  readJobDurably,
  type V213OperationKind,
} from "./v213-dual-lane-live.js";
import type {
  V208SoulXWholeSpanDescriptor,
  V213QualificationInputCleanupEvidence,
} from "../hosted/v213-qualification-materializer.js";
import {
  buildV208SoulXQualificationPlan,
  parseV208SoulXAuthority,
  validateV208SoulXQualificationResult,
  V208_SOULX_VOLUME_ID_SHA256,
  V208_SOULX_VOLUME_MANIFEST_SHA256,
  type V208SoulXQualificationResult,
} from "./v208-soulx-qualification.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const IMAGE = /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/u;
const RATE = 1.116;
const MAX_COLD_START_SECONDS_PER_JOB = 800;
const QUALIFICATION_JOB_COUNT = 5;
const MAX_SUCCESS_JOB_SECONDS = 800;
const MAX_FOCUSED_FAULT_JOB_SECONDS = 60;
const MAX_TIMEOUT_JOB_SECONDS = 5;
const MAX_IDLE_SECONDS = 60;
// V2-08 alone uses a 60-second idle window to preserve the cold worker until immediate warm
// dispatch. No composition may assume that output
// verification or materialization finishes quickly enough to keep it warm, so every one of the
// five serial dispatches receives a full cold-start reserve.
const WORST_CASE_GPU_SECONDS =
  QUALIFICATION_JOB_COUNT * MAX_COLD_START_SECONDS_PER_JOB +
  2 * MAX_SUCCESS_JOB_SECONDS +
  2 * MAX_FOCUSED_FAULT_JOB_SECONDS +
  MAX_TIMEOUT_JOB_SECONDS +
  MAX_IDLE_SECONDS;
export const V208_WORST_CASE_LIABILITY_USD = (WORST_CASE_GPU_SECONDS * RATE) / 3_600;

export function assertV208StageConsumptionDecision(
  decision: "EXECUTE" | "RESUME" | "REPLAY_REJECTED",
): void {
  if (decision === "REPLAY_REJECTED") throw new Error("V208_AUTHORITY_REPLAY_REJECTED");
}

export interface V208SoulXOrchestratorDependencies {
  readonly transport: V213DualLaneTransport;
  readonly soulx: V213SealedLane;
  readonly materializeWholeSpan: (input: {
    readonly descriptor: V208SoulXWholeSpanDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
  }) => Promise<V213QualificationCaseMaterialization>;
  readonly verifySuccess: (input: {
    readonly descriptor: V208SoulXWholeSpanDescriptor;
    readonly jobId: string;
    readonly deployment: V213LaneDeployment;
    readonly materialization: V213QualificationCaseMaterialization;
    readonly observed: V213JobRead;
  }) => Promise<{
    readonly workerReceiptVerified: true;
    readonly outputItemsVerified: 4;
    readonly nativeFullSplitReadbackVerified: true;
    readonly exactAudioVideoProbeVerified: true;
    readonly coldModelReadyMs: number;
    readonly workerId: string;
  }>;
  readonly cleanupOutputKeys: (keys: readonly string[]) => Promise<true>;
  readonly cleanupMaterializedInputs: (input: {
    readonly materialization: V213QualificationCaseMaterialization;
    readonly terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  }) => Promise<{
    readonly originalRequestSha256: `sha256:${string}`;
    readonly evidence: V213QualificationInputCleanupEvidence;
  }>;
  /** Used only after exact lane absence when an ambiguous dispatch has no knowable job outcome. */
  readonly cleanupAmbiguousMaterializedInputs: (
    materialization: V213QualificationCaseMaterialization,
  ) => Promise<true>;
  readonly reconstructDeterministicQualificationKeys: (input: {
    readonly descriptor: V208SoulXWholeSpanDescriptor | V213QualificationCaseDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
  }) => Promise<{
    readonly inputKeys: readonly string[];
    readonly outputKeys: readonly string[];
  }>;
  readonly cleanupDeterministicQualificationKeys: (input: {
    readonly descriptor: V208SoulXWholeSpanDescriptor | V213QualificationCaseDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
    readonly terminalOutcome: "FAILED";
  }) => Promise<{
    readonly inputKeys: readonly string[];
    readonly outputKeys: readonly string[];
    readonly absenceVerified: true;
  }>;
  readonly cleanupAttributableResource: (resourceKey: string) => Promise<true>;
  readonly serializeEvidence: (result: V208SoulXQualificationResult) => Promise<void>;
  readonly maxStatusReads?: number;
  readonly maxCancelStatusReads?: number;
  readonly pollIntervalMs?: number;
  readonly minimumStableReadSpacingMs?: number;
  readonly interruptionCheckpoint?: (
    phase: "lane-delete" | "attributable-cleanup" | "output-delete" | "final-zero",
  ) => Promise<void>;
  readonly materializationCheckpoint?: (descriptorId: string) => Promise<void>;
  readonly deploymentCheckpoint?: () => Promise<void>;
  readonly laneDeletionCheckpoint?: () => Promise<void>;
}

export class V208ProcessInterruption extends Error {}

export function validateV208WholeSpanSuccessProof(value: {
  readonly workerReceiptVerified: boolean;
  readonly outputItemsVerified: number;
  readonly nativeFullSplitReadbackVerified: boolean;
  readonly exactAudioVideoProbeVerified: boolean;
  readonly coldModelReadyMs: number;
  readonly workerId: string;
}): void {
  if (
    value.workerReceiptVerified !== true ||
    value.outputItemsVerified !== 4 ||
    value.nativeFullSplitReadbackVerified !== true ||
    value.exactAudioVideoProbeVerified !== true ||
    !Number.isSafeInteger(value.coldModelReadyMs) ||
    value.coldModelReadyMs < 0 ||
    !ID.test(value.workerId)
  )
    throw new Error("V208_WHOLE_SPAN_SUCCESS_PROOF_INVALID");
}

function validateInputCleanupEvidence(
  materialization: V213QualificationCaseMaterialization,
  terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT",
  originalRequestSha256: string,
  evidence: V213QualificationInputCleanupEvidence,
): void {
  const request = materialization.request as Record<string, JsonValue>;
  const ports = request.ports as Record<string, JsonValue> | undefined;
  const inputs = ports?.inputs;
  const inputObjectKeySha256s = Array.isArray(inputs)
    ? inputs.map((input) => {
        const path = (input as Record<string, JsonValue>).path;
        return typeof path === "string" && path.startsWith("/") ? hashId(path.slice(1)) : "";
      })
    : [];
  const { evidenceSha256: _hash, ...unsigned } = evidence;
  void _hash;
  if (
    inputObjectKeySha256s.length === 0 ||
    inputObjectKeySha256s.some((value) => !SHA256.test(value)) ||
    evidence.schemaVersion !== "videoforge.v213-qualification-input-cleanup/v1" ||
    evidence.terminalOutcome !== terminalOutcome ||
    evidence.absenceVerified !== true ||
    evidence.requestSha256 !== originalRequestSha256 ||
    !SHA256.test(originalRequestSha256) ||
    canonicalizeJson(evidence.deletedObjectKeySha256s as unknown as JsonValue) !==
      canonicalizeJson(inputObjectKeySha256s as unknown as JsonValue) ||
    new Set(evidence.deletedObjectKeySha256s).size !== evidence.deletedObjectKeySha256s.length ||
    evidence.evidenceSha256 !== hashCanonical(unsigned)
  )
    throw new Error("V208_INPUT_CLEANUP_EVIDENCE_INVALID");
}

const hashCanonical = (value: unknown): string =>
  `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue))
    .digest("hex")}`;

const hashId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function assertPollPolicy(dependencies: V208SoulXOrchestratorDependencies): {
  reads: number;
  cancelReads: number;
  pollMs: number;
  stableMs: number;
} {
  const reads = dependencies.maxStatusReads ?? 240;
  const cancelReads = dependencies.maxCancelStatusReads ?? 30;
  const pollMs = dependencies.pollIntervalMs ?? 2_000;
  const stableMs = dependencies.minimumStableReadSpacingMs ?? 2_000;
  if (
    !Number.isSafeInteger(reads) ||
    reads < 1 ||
    reads > 300 ||
    !Number.isSafeInteger(cancelReads) ||
    cancelReads < 1 ||
    cancelReads > 60 ||
    !Number.isSafeInteger(pollMs) ||
    pollMs < 100 ||
    pollMs > 2_000 ||
    !Number.isSafeInteger(stableMs) ||
    stableMs < 2_000 ||
    stableMs > 10_000
  )
    throw new Error("V208_POLL_POLICY_INVALID");
  return { reads, cancelReads, pollMs, stableMs };
}

function assertDeploymentReadback(
  actual: V213LaneDeployment,
  acknowledged: V213LaneDeployment,
  sealed: V213SealedLane,
): void {
  if (
    actual.lane !== "soulx" ||
    actual.purpose !== "qualification" ||
    actual.endpointId !== acknowledged.endpointId ||
    !ID.test(actual.endpointId) ||
    actual.endpointIdSha256 !== hashId(actual.endpointId) ||
    actual.templateId !== acknowledged.templateId ||
    !ID.test(actual.templateId) ||
    actual.templateIdSha256 !== hashId(actual.templateId) ||
    actual.image !== sealed.publicImage ||
    !IMAGE.test(actual.image) ||
    actual.sourceCommit !== sealed.sourceCommit ||
    !COMMIT.test(actual.sourceCommit) ||
    actual.deploymentSha256 !== sealed.deploymentSha256 ||
    !SHA256.test(actual.deploymentSha256) ||
    actual.volumeIdSha256 !== V208_SOULX_VOLUME_ID_SHA256 ||
    actual.volumeManifestSha256 !== V208_SOULX_VOLUME_MANIFEST_SHA256 ||
    actual.volumeSizeGb !== 50 ||
    actual.volumeMount !== "/runpod-volume" ||
    actual.region !== "EU-RO-1" ||
    actual.gpu !== "NVIDIA GeForce RTX 4090" ||
    actual.gpuCount !== 1 ||
    actual.workersMin !== 0 ||
    actual.workersMax !== 1 ||
    actual.handlerConcurrency !== 1 ||
    actual.scalerType !== "REQUEST_COUNT" ||
    actual.scalerValue !== 1 ||
    actual.initTimeoutSeconds !== 800
  )
    throw new Error("V208_DEPLOYMENT_READBACK_MISMATCH");
}

function keys(materialization: V213QualificationCaseMaterialization, expected: number) {
  const request = materialization.request as Record<string, JsonValue>;
  const authorities = request.generated_output_authorities;
  if (!Array.isArray(authorities) || authorities.length !== expected)
    throw new Error("V208_OUTPUT_AUTHORITY_COUNT_INVALID");
  return authorities.map((authority) => {
    const path = (authority as Record<string, JsonValue>).path;
    if (typeof path !== "string" || !path.startsWith("/tenant/") || path.includes(".."))
      throw new Error("V208_OUTPUT_AUTHORITY_INVALID");
    return path.slice(1);
  });
}

function inputKeys(materialization: V213QualificationCaseMaterialization): string[] {
  const request = materialization.request as Record<string, JsonValue>;
  const ports = request.ports as Record<string, JsonValue> | undefined;
  const inputs = ports?.inputs;
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error("V208_INPUT_AUTHORITY_INVALID");
  return inputs.map((authority) => {
    const path = (authority as Record<string, JsonValue>).path;
    if (typeof path !== "string" || !path.startsWith("/tenant/") || path.includes(".."))
      throw new Error("V208_INPUT_AUTHORITY_INVALID");
    return path.slice(1);
  });
}

async function journalMaterializationKeys(
  transport: V213DualLaneTransport,
  authorityId: string,
  deploymentSha256: string,
  planSha256: string,
  descriptorId: string,
  materialization: V213QualificationCaseMaterialization,
  outputCount: number,
): Promise<void> {
  const operation = phaseOperation(
    authorityId,
    deploymentSha256,
    planSha256,
    `materialization-${descriptorId}`,
  );
  const claim = await transport.durable.claimOperation(operation);
  if (claim.action === "DONE") return;
  await completePhase(transport, operation, claim.record.state, {
    descriptorId,
    inputKeys: inputKeys(materialization),
    outputKeys: keys(materialization, outputCount),
    materializationEvidenceSha256: materialization.materializationEvidenceSha256,
  });
}

interface V208CleanupPlanEvidence {
  readonly deployment: V213LaneDeployment;
  readonly descriptorKeys: readonly {
    readonly descriptorId: string;
    readonly inputKeys: readonly string[];
    readonly outputKeys: readonly string[];
  }[];
  readonly evidenceSha256: string;
}

function validateCleanupPlanEvidence(
  raw: unknown,
  sealed: V213SealedLane,
  expectedDescriptorIds: readonly string[],
): V208CleanupPlanEvidence {
  const value = raw as V208CleanupPlanEvidence | null;
  if (!value || !Array.isArray(value.descriptorKeys) || !SHA256.test(value.evidenceSha256))
    throw new Error("V208_CLEANUP_PLAN_INVALID");
  assertDeploymentReadback(value.deployment, value.deployment, sealed);
  if (
    canonicalizeJson(value.descriptorKeys.map(({ descriptorId }) => descriptorId) as JsonValue) !==
    canonicalizeJson(expectedDescriptorIds as unknown as JsonValue)
  )
    throw new Error("V208_CLEANUP_PLAN_INVALID");
  const allKeys: string[] = [];
  for (const item of value.descriptorKeys) {
    if (
      !ID.test(item.descriptorId) ||
      !Array.isArray(item.inputKeys) ||
      item.inputKeys.length === 0 ||
      !Array.isArray(item.outputKeys) ||
      item.outputKeys.length === 0 ||
      [...item.inputKeys, ...item.outputKeys].some(
        (key) => typeof key !== "string" || !key.startsWith("tenant/") || key.includes(".."),
      )
    )
      throw new Error("V208_CLEANUP_PLAN_INVALID");
    allKeys.push(...item.inputKeys, ...item.outputKeys);
  }
  if (new Set(allKeys).size !== allKeys.length)
    throw new Error("V208_CLEANUP_PLAN_INVALID");
  const { evidenceSha256: _hash, ...unsigned } = value;
  void _hash;
  if (value.evidenceSha256 !== hashCanonical(unsigned))
    throw new Error("V208_CLEANUP_PLAN_INVALID");
  return value;
}

async function recoverV208DeploymentFromDurableCreate(
  transport: V213DualLaneTransport,
  sealed: V213SealedLane,
  authorityId: string,
): Promise<{ readonly deployment: V213LaneDeployment } | { readonly absent: true }> {
  const resourceKey = `v213-${authorityId}-${sealed.lane}-qualification`;
  const createOperation = operationIdentity(
    authorityId,
    "create",
    resourceKey,
    hashCanonical({
      sealed,
      purpose: "qualification",
      resourceKey,
      workersMin: 0,
      workersMax: 1,
      idleTimeoutSeconds: 60,
    }),
  );
  const createClaim = await transport.durable.claimOperation(createOperation);
  if (createClaim.action === "EXECUTE") throw new Error("V208_DURABLE_DEPLOYMENT_REQUIRED");
  let createState = createClaim.record.state;
  let deployment = createClaim.record.evidence as V213LaneDeployment | undefined;
  if (!deployment) {
    if (createState === "TERMINAL") throw new Error("V208_DURABLE_DEPLOYMENT_REQUIRED");
    const found = await transport.findLaneByResourceKey(resourceKey);
    if (found === null) {
      await transport.durable.transitionOperation({
        operationId: createOperation.operationId,
        from: createState,
        to: "TERMINAL",
        evidence: { absent: true },
      });
      return { absent: true };
    }
    assertDeploymentReadback(found, found, sealed);
    if (createState !== "ACKED") {
      const acked = await transport.durable.transitionOperation({
        operationId: createOperation.operationId,
        from: createState,
        to: "ACKED",
        providerId: found.endpointId,
        evidence: found as unknown as JsonValue,
      });
      createState = acked.state;
    }
    deployment = found;
  }
  assertDeploymentReadback(deployment, deployment, sealed);
  const readbackOperation = operationIdentity(
    authorityId,
    "readback",
    resourceKey,
    hashCanonical(deployment),
  );
  const readbackClaim = await transport.durable.claimOperation(readbackOperation);
  let readback = readbackClaim.record.evidence as V213LaneDeployment | undefined;
  if (readbackClaim.action !== "DONE") {
    readback = await transport.readLane(deployment);
    assertDeploymentReadback(readback, deployment, sealed);
    if (
      canonicalizeJson(readback as unknown as JsonValue) !==
      canonicalizeJson(deployment as unknown as JsonValue)
    )
      throw new Error("V208_DURABLE_DEPLOYMENT_REQUIRED");
    await transport.durable.transitionOperation({
      operationId: readbackOperation.operationId,
      from: readbackClaim.record.state,
      to: "TERMINAL",
      providerId: deployment.endpointId,
      evidence: deployment as unknown as JsonValue,
    });
  }
  if (!readback) throw new Error("V208_DURABLE_DEPLOYMENT_REQUIRED");
  assertDeploymentReadback(readback, deployment, sealed);
  if (canonicalizeJson(readback as unknown as JsonValue) !== canonicalizeJson(deployment as unknown as JsonValue))
    throw new Error("V208_DURABLE_DEPLOYMENT_REQUIRED");
  return { deployment };
}

const operationIdentity = (
  authorityId: string,
  kind: V213OperationKind,
  resourceKey: string,
  requestSha256: string,
) => ({
  operationId: hashCanonical({ authorityId, kind, resourceKey, requestSha256 }).slice(7, 47),
  stageAuthorityId: authorityId,
  kind,
  resourceKey,
  requestSha256,
});

const phaseOperation = (authorityId: string, deploymentSha256: string, planSha256: string, phase: string) =>
  operationIdentity(
    authorityId,
    "status",
    `${deploymentSha256}:v208-phase-${phase}:0`,
    hashCanonical({ planSha256, phase }),
  );

async function completePhase(
  transport: V213DualLaneTransport,
  operation: ReturnType<typeof phaseOperation>,
  from: "IN_FLIGHT" | "ACK_UNKNOWN" | "ACKED" | "TERMINAL",
  evidence: JsonValue,
) {
  if (from === "TERMINAL") throw new Error("V208_PHASE_CLAIM_STATE_INVALID");
  await transport.durable.transitionOperation({
    operationId: operation.operationId,
    from,
    to: "TERMINAL",
    evidence,
  });
}

async function terminal(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  jobId: string,
  reads: number,
  cancelReads: number,
  pollMs: number,
  authorityId: string,
) {
  for (let index = 0; index < reads; index += 1) {
    const value = await readJobDurably(transport, deployment, jobId, authorityId, index);
    if (value.jobId !== jobId) throw new Error("V208_JOB_ID_DRIFT");
    if (value.status !== "IN_QUEUE" && value.status !== "IN_PROGRESS") return value;
    if (index + 1 < reads) await transport.sleep(pollMs);
  }
  await cancelAndConfirmTerminal(
    transport,
    deployment,
    jobId,
    cancelReads,
    pollMs,
    authorityId,
  );
  throw new Error("V208_STATUS_HORIZON_CANCELLED");
}

async function cancelAndConfirmTerminal(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  jobId: string,
  cancelReads: number,
  pollMs: number,
  authorityId: string,
) {
  const cancelled = await cancelJobDurably(transport, deployment, jobId, authorityId);
  if (cancelled.jobId !== jobId) throw new Error("V208_JOB_ID_DRIFT");
  for (let index = 0; index < cancelReads; index += 1) {
    const value =
      index === 0 && cancelled.status !== "IN_QUEUE" && cancelled.status !== "IN_PROGRESS"
        ? cancelled
        : await readJobDurably(transport, deployment, jobId, authorityId, 10_000 + index);
    if (value.jobId !== jobId) throw new Error("V208_JOB_ID_DRIFT");
    if (value.status !== "IN_QUEUE" && value.status !== "IN_PROGRESS") return value;
    if (index + 1 < cancelReads) await transport.sleep(pollMs);
  }
  throw new Error("V208_STATUS_HORIZON_CANCEL_UNCONFIRMED");
}

export async function dispatchV208Durably(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  id: string,
  materialization: V213QualificationCaseMaterialization,
  executionTimeoutMs: 5_000 | 60_000 | 800_000,
  authorityId: string,
) {
  const requestKey = `v208-${id}`;
  const operation = operationIdentity(
    authorityId,
    "dispatch",
    requestKey,
    hashCanonical({ request: materialization.request, executionTimeoutMs, ttlMs: 7_200_000 }),
  );
  const claim = await transport.durable.claimOperation(operation);
  let state = claim.record.state;
  let found =
    claim.record.providerId && ID.test(claim.record.providerId)
      ? { jobId: claim.record.providerId }
      : null;
  if (claim.action === "EXECUTE") {
    let ack: Awaited<ReturnType<V213DualLaneTransport["dispatch"]>>;
    try {
      ack = await transport.dispatch({
        deployment,
        requestKey,
        envelope: materialization.request,
        policy: { executionTimeoutMs, ttlMs: 7_200_000 },
      });
    } catch {
      ack = { kind: "ACK_UNKNOWN" };
    }
    if (ack.kind === "ACK") found = { jobId: ack.jobId };
    else {
      const transitioned = await transport.durable.transitionOperation({
        operationId: operation.operationId,
        from: "IN_FLIGHT",
        to: "ACK_UNKNOWN",
      });
      state = transitioned.state;
    }
  }
  found ??= await transport.findJobByRequestKey({
    endpointId: deployment.endpointId,
    requestKey,
  });
  if (!found || !ID.test(found.jobId)) throw new Error("V208_DISPATCH_ACK_UNKNOWN");
  if (state !== "ACKED" && state !== "TERMINAL")
    await transport.durable.transitionOperation({
      operationId: operation.operationId,
      from: state,
      to: "ACKED",
      providerId: found.jobId,
    });
  return found.jobId;
}

async function waitForLaneDrain(
  transport: V213DualLaneTransport,
  deployment: V213LaneDeployment,
  pollMs: number,
): Promise<void> {
  // The longest V2-08 dispatch policy is 800 seconds. The extra minute covers provider status
  // propagation and the five-second scale-to-zero idle setting without permitting an unbounded
  // wait or deleting an endpoint underneath a running worker.
  const maxReads = Math.ceil(860_000 / pollMs);
  for (let read = 0; read < maxReads; read += 1) {
    const inventory = await transport.inventory();
    const soulxVolume = inventory.volumes.filter(
      (volume) =>
        volume.idSha256 === V208_SOULX_VOLUME_ID_SHA256 &&
        volume.manifestSha256 === V208_SOULX_VOLUME_MANIFEST_SHA256 &&
        volume.sizeGb === 50 &&
        volume.region === "EU-RO-1",
    );
    if (soulxVolume.length !== 1) throw new Error("V208_SOULX_VOLUME_DRIFT");
    if (
      inventory.endpointIdSha256s.length !== 1 ||
      inventory.endpointIdSha256s[0] !== deployment.endpointIdSha256 ||
      inventory.templateIdSha256s.length !== 1 ||
      inventory.templateIdSha256s[0] !== deployment.templateIdSha256
    )
      throw new Error("V208_LANE_INVENTORY_DRIFT");
    if (inventory.runningPods === 0 && inventory.activeWorkers === 0 && inventory.queuedJobs === 0)
      return;
    if (read + 1 < maxReads) await transport.sleep(pollMs);
  }
  throw new Error("V208_LANE_DRAIN_TIMEOUT");
}

export async function runV208SoulXWithV213Transport(
  dependencies: V208SoulXOrchestratorDependencies,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<V208SoulXQualificationResult> {
  const authority = parseV208SoulXAuthority(environment);
  const plan = buildV208SoulXQualificationPlan(authority);
  const poll = assertPollPolicy(dependencies);
  if (authority.finiteCapUsd < V208_WORST_CASE_LIABILITY_USD)
    throw new Error("V208_WORST_CASE_LIABILITY_EXCEEDS_CAP");
  if (
    authority.cumulativeBillingStopThresholdUsd - authority.billingBaselineUsd <
    V208_WORST_CASE_LIABILITY_USD
  )
    throw new Error("V208_WORST_CASE_LIABILITY_EXCEEDS_CUMULATIVE_THRESHOLD");
  if (
    dependencies.soulx.lane !== "soulx" ||
    dependencies.soulx.publicImage !== authority.image ||
    dependencies.soulx.sourceCommit !== authority.imageSourceCommit ||
    dependencies.soulx.volumeIdSha256 !== V208_SOULX_VOLUME_ID_SHA256 ||
    dependencies.soulx.volumeManifestSha256 !== V208_SOULX_VOLUME_MANIFEST_SHA256
  )
    throw new Error("V208_SOULX_BINDING_INVALID");
  // Durable authority mutation is SQL-only. Claim it before admission so a process restart can
  // enter cleanup even when paid work has legitimately moved billing above the initial baseline.
  const issued = await dependencies.transport.durable.issueStageAuthority({
    stage: "soulx",
    inputSha256: plan.planSha256,
    predecessorHandoffSha256: authority.predecessorClosureSha256,
  });
  const consumed = await dependencies.transport.durable.claimStageAuthority(issued);
  assertV208StageConsumptionDecision(consumed.decision);
  const qualificationOperation = phaseOperation(
    issued.authorityId,
    dependencies.soulx.deploymentSha256,
    plan.planSha256,
    "qualification-complete",
  );
  const qualificationClaim = await dependencies.transport.durable.claimOperation(
    qualificationOperation,
  );
  const plannedDescriptors = [
    ...plan.qualification.wholeSpanDescriptors,
    ...plan.qualification.caseDescriptors.filter(({ mode }) => mode !== "complete"),
  ];
  const cleanupPlanOperation = phaseOperation(
    issued.authorityId,
    dependencies.soulx.deploymentSha256,
    plan.planSha256,
    "cleanup-plan",
  );
  const cleanupPlanClaim = await dependencies.transport.durable.claimOperation(cleanupPlanOperation);
  let cleanupPlan: V208CleanupPlanEvidence | null = null;
  let resumeCreateAbsent = false;
  const buildAndPersistCleanupPlan = async (
    planDeployment: V213LaneDeployment,
  ): Promise<V208CleanupPlanEvidence> => {
    const descriptorKeys = [] as Array<{
      descriptorId: string;
      inputKeys: readonly string[];
      outputKeys: readonly string[];
    }>;
    for (const descriptor of plannedDescriptors) {
      const reconstructed = await dependencies.reconstructDeterministicQualificationKeys({
        descriptor,
        deployment: planDeployment,
        stageAuthorityId: issued.authorityId,
        inputSha256: plan.planSha256,
      });
      descriptorKeys.push({ descriptorId: descriptor.id, ...reconstructed });
    }
    const unsigned = { deployment: planDeployment, descriptorKeys };
    const validated = validateCleanupPlanEvidence(
      { ...unsigned, evidenceSha256: hashCanonical(unsigned) },
      dependencies.soulx,
      plannedDescriptors.map(({ id }) => id),
    );
    await completePhase(
      dependencies.transport,
      cleanupPlanOperation,
      cleanupPlanClaim.record.state,
      validated as unknown as JsonValue,
    );
    return validated;
  };
  if (consumed.decision === "RESUME") {
    if (cleanupPlanClaim.action === "DONE")
      cleanupPlan = validateCleanupPlanEvidence(
        cleanupPlanClaim.record.evidence,
        dependencies.soulx,
        plannedDescriptors.map(({ id }) => id),
      );
    else {
      const recovered = await recoverV208DeploymentFromDurableCreate(
        dependencies.transport,
        dependencies.soulx,
        issued.authorityId,
      );
      if ("absent" in recovered) resumeCreateAbsent = true;
      else cleanupPlan = await buildAndPersistCleanupPlan(recovered.deployment);
    }
  }
  const admission = await dependencies.transport.freshAdmission();
  const admissionCheckedAt = Date.parse(admission.checkedAt);
  const admissionNow = dependencies.transport.now().getTime();
  const exactVolume = admission.volumes.filter(
    (volume) =>
      volume.idSha256 === V208_SOULX_VOLUME_ID_SHA256 &&
      volume.manifestSha256 === V208_SOULX_VOLUME_MANIFEST_SHA256 &&
      volume.sizeGb === 50 &&
      volume.region === "EU-RO-1",
  );
  const commonAdmissionInvalid =
    admission.accountIdSha256 !== authority.runpodAccountIdSha256 ||
    !Number.isFinite(admissionNow) ||
    !Number.isFinite(admissionCheckedAt) ||
    Math.abs(admissionNow - admissionCheckedAt) > 60_000 ||
    !Number.isFinite(admission.cumulativeBillingUsd) ||
    admission.cumulativeBillingUsd < authority.billingBaselineUsd ||
    admission.cumulativeBillingUsd > authority.cumulativeBillingStopThresholdUsd ||
    exactVolume.length !== 1;
  const executeAdmissionInvalid =
    consumed.decision === "EXECUTE" &&
    (admission.gpu !== "NVIDIA GeForce RTX 4090" ||
      admission.region !== "EU-RO-1" ||
      admission.availability !== authority.requiredAvailability ||
      admission.runningPods !== 0 ||
      admission.activeWorkers !== 0 ||
      admission.endpoints !== 0 ||
      admission.privateTemplates !== 0 ||
      !Number.isFinite(admission.flexRateUsdPerGpuHour) ||
      admission.flexRateUsdPerGpuHour < 0 ||
      admission.flexRateUsdPerGpuHour > RATE ||
      admission.cumulativeBillingUsd !== authority.billingBaselineUsd);
  if (commonAdmissionInvalid || executeAdmissionInvalid)
    throw new Error("V208_FRESH_ADMISSION_REJECTED");
  // The concrete V2-13 transport reconstructs deterministic cleanup names from this prefix.
  const resourceKey = `v213-${issued.authorityId}-soulx-qualification`;
  let deployment: V213LaneDeployment | null = null;
  const outputKeys: string[] = [];
  const activeJobs = new Set<string>();
  const materializations: Array<{
    readonly materialization: V213QualificationCaseMaterialization;
    terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | null;
    cleaned: boolean;
  }> = [];
  const activeJobMaterializations = new Map<string, (typeof materializations)[number]>();
  let attributableCleaned = false;
  let outputsCleaned = false;
  let laneAbsenceConfirmed = false;
  let result: V208SoulXQualificationResult | null = null;
  let failure: unknown = null;
  let inputCleanupEvidenceVerified = 0;
  let finalProofCompleted = false;
  let finalBilling = admission.cumulativeBillingUsd;
  let qualificationBillingBaseline = authority.billingBaselineUsd;
  let resumedQualification = false;
  let cleanupOnlyResume = false;
  let cleanupResumeDeployment: V213LaneDeployment | null = null;
  const proveFinalState = async () => {
    let priorBilling: number | null = null;
    let priorCheckedAt = 0;
    for (let read = 0; read < 3; read += 1) {
      const [inventory, billing] = await Promise.all([
        dependencies.transport.inventory(),
        dependencies.transport.billingAmount(),
      ]);
      const checkedAt = Date.parse(inventory.checkedAt);
      const retainedSoulX = inventory.volumes.filter(
        (volume) =>
          volume.idSha256 === V208_SOULX_VOLUME_ID_SHA256 &&
          volume.manifestSha256 === V208_SOULX_VOLUME_MANIFEST_SHA256 &&
          volume.sizeGb === 50 &&
          volume.region === "EU-RO-1",
      );
      if (
        !Number.isFinite(checkedAt) ||
        Math.abs(dependencies.transport.now().getTime() - checkedAt) > 60_000 ||
        (priorCheckedAt !== 0 && checkedAt - priorCheckedAt < poll.stableMs) ||
        inventory.runningPods !== 0 ||
        inventory.activeWorkers !== 0 ||
        inventory.queuedJobs !== 0 ||
        inventory.endpointIdSha256s.length !== 0 ||
        inventory.templateIdSha256s.length !== 0 ||
        retainedSoulX.length !== 1 ||
        !Number.isFinite(billing) ||
        billing < admission.cumulativeBillingUsd ||
        (priorBilling !== null && Math.abs(billing - priorBilling) > 0.000_001) ||
        billing > authority.cumulativeBillingStopThresholdUsd ||
        billing - qualificationBillingBaseline > authority.finiteCapUsd
      )
        throw new Error("V208_ZERO_COMPUTE_OR_CAP_UNCONFIRMED");
      finalBilling = billing;
      priorBilling = billing;
      priorCheckedAt = checkedAt;
      if (read < 2) await dependencies.transport.sleep(poll.stableMs);
    }
    finalProofCompleted = true;
  };
  const cleanupKnownInputs = async (
    record: (typeof materializations)[number],
    terminalOutcome: Exclude<(typeof record)["terminalOutcome"], null>,
  ) => {
    record.terminalOutcome = terminalOutcome;
    const cleaned = await dependencies.cleanupMaterializedInputs({
      materialization: record.materialization,
      terminalOutcome,
    });
    validateInputCleanupEvidence(
      record.materialization,
      terminalOutcome,
      cleaned.originalRequestSha256,
      cleaned.evidence,
    );
    record.cleaned = true;
    inputCleanupEvidenceVerified += 1;
  };
  let coldReady = -1;
  let coldWorkerId = "";
  let outputItems = 0;
  let successReceipts = 0;
  let nativeFullSplitVerified = true;
  let exactAudioVideoVerified = true;
  let cancellationVerified = false;
  let invalidOutputVerified = false;
  let timeoutVerified = false;
  try {
    if (qualificationClaim.action === "DONE") {
      resumedQualification = true;
      const saved = qualificationClaim.record.evidence as unknown as {
        deployment: V213LaneDeployment;
        outputKeys: string[];
        coldReady: number;
        coldWorkerId: string;
        billingBaselineUsd: number;
      };
      if (
        !saved ||
        !Array.isArray(saved.outputKeys) ||
        saved.outputKeys.length !== 11 ||
        !Number.isSafeInteger(saved.coldReady) ||
        !ID.test(saved.coldWorkerId) ||
        !Number.isFinite(saved.billingBaselineUsd) ||
        saved.billingBaselineUsd < 0
      )
        throw new Error("V208_QUALIFICATION_PHASE_EVIDENCE_INVALID");
      assertDeploymentReadback(saved.deployment, saved.deployment, dependencies.soulx);
      deployment = saved.deployment;
      outputKeys.push(...saved.outputKeys);
      coldReady = saved.coldReady;
      coldWorkerId = saved.coldWorkerId;
      qualificationBillingBaseline = saved.billingBaselineUsd;
      outputItems = 8;
      successReceipts = 2;
      cancellationVerified = true;
      invalidOutputVerified = true;
      timeoutVerified = true;
      inputCleanupEvidenceVerified = 5;
    } else if (consumed.decision === "RESUME") {
      // An interrupted execution without the signed qualification-complete receipt can never
      // restart paid work. Reconstruct only an existing lane and enter the cleanup path below.
      if (!cleanupPlan && !resumeCreateAbsent) throw new Error("V208_CLEANUP_PLAN_REQUIRED");
      deployment = cleanupPlan?.deployment ?? null;
      cleanupOnlyResume = true;
      cleanupResumeDeployment = deployment;
      if (resumeCreateAbsent) laneAbsenceConfirmed = true;
      throw new Error("V208_RESUME_REQUIRES_CLEANUP_ONLY");
    } else {
    deployment = await createAndReadLane(
      dependencies.transport,
      dependencies.soulx,
      "qualification",
      issued.authorityId,
      60,
    );
    assertDeploymentReadback(deployment, deployment, dependencies.soulx);
    await dependencies.deploymentCheckpoint?.();
    cleanupPlan = await buildAndPersistCleanupPlan(deployment);
    const pendingSuccesses: Array<{
      readonly descriptor: (typeof plan.qualification.wholeSpanDescriptors)[number];
      readonly materialization: V213QualificationCaseMaterialization;
      readonly record: (typeof materializations)[number];
      jobId: string | null;
    }> = [];
    // Materialize both before starting compute so no staging delay falls inside the warm window.
    for (const descriptor of plan.qualification.wholeSpanDescriptors) {
      const materialization = await dependencies.materializeWholeSpan({
        descriptor,
        deployment,
        stageAuthorityId: issued.authorityId,
        inputSha256: plan.planSha256,
      });
      const materializationRecord: (typeof materializations)[number] = {
        materialization,
        terminalOutcome: null,
        cleaned: false,
      };
      materializations.push(materializationRecord);
      outputKeys.push(...keys(materialization, 4));
      await dependencies.materializationCheckpoint?.(descriptor.id);
      await journalMaterializationKeys(
        dependencies.transport,
        issued.authorityId,
        dependencies.soulx.deploymentSha256,
        plan.planSha256,
        descriptor.id,
        materialization,
        4,
      );
      pendingSuccesses.push({
        descriptor,
        materialization,
        record: materializationRecord,
        jobId: null,
      });
    }
    const coldPending = pendingSuccesses[0];
    const warmPending = pendingSuccesses[1];
    if (!coldPending?.descriptor.cold || warmPending?.descriptor.cold !== false)
      throw new Error("V208_WARM_PLAN_ORDER_INVALID");
    coldPending.jobId = await dispatchV208Durably(
      dependencies.transport,
      deployment,
      coldPending.descriptor.id,
      coldPending.materialization,
      800_000,
      issued.authorityId,
    );
    activeJobs.add(coldPending.jobId);
    activeJobMaterializations.set(coldPending.jobId, coldPending.record);
    for (const [index, pending] of pendingSuccesses.entries()) {
      const { descriptor, materialization, record: materializationRecord } = pending;
      const jobId = pending.jobId;
      if (!jobId) throw new Error("V208_SUCCESS_JOB_MISSING");
      const observed = await terminal(
        dependencies.transport,
        deployment,
        jobId,
        poll.reads,
        poll.cancelReads,
        poll.pollMs,
        issued.authorityId,
      );
      if (index === 0) {
        // The cold terminal read is the queue-empty guard. Dispatch warm immediately, before any
        // input deletion, R2 GET, hashing, or ffprobe can let the max1 worker idle out.
        warmPending.jobId = await dispatchV208Durably(
          dependencies.transport,
          deployment,
          warmPending.descriptor.id,
          warmPending.materialization,
          800_000,
          issued.authorityId,
        );
        activeJobs.add(warmPending.jobId);
        activeJobMaterializations.set(warmPending.jobId, warmPending.record);
      }
      activeJobs.delete(jobId);
      activeJobMaterializations.delete(jobId);
      if (observed.status === "IN_QUEUE" || observed.status === "IN_PROGRESS")
        throw new Error("V208_TERMINAL_STATUS_UNPROVEN");
      await cleanupKnownInputs(materializationRecord, observed.status);
      if (observed.status !== "COMPLETED" || !observed.receiptDelivery)
        throw new Error("V208_WHOLE_SPAN_COMPLETION_UNPROVEN");
      const verified = await dependencies.verifySuccess({
        descriptor,
        jobId,
        deployment,
        materialization,
        observed,
      });
      validateV208WholeSpanSuccessProof(verified);
      successReceipts += 1;
      outputItems += verified.outputItemsVerified;
      nativeFullSplitVerified = nativeFullSplitVerified && verified.nativeFullSplitReadbackVerified;
      exactAudioVideoVerified = exactAudioVideoVerified && verified.exactAudioVideoProbeVerified;
      if (descriptor.cold) {
        coldReady = verified.coldModelReadyMs;
        coldWorkerId = verified.workerId;
      } else if (
        verified.workerId !== coldWorkerId ||
        verified.coldModelReadyMs < 0
      ) {
        throw new Error("V208_WARM_WORKER_REUSE_UNPROVEN");
      }
    }
    for (const descriptor of plan.qualification.caseDescriptors.filter(
      (item) => item.mode !== "complete",
    )) {
      const materialization = await dependencies.transport.materializeQualificationCase({
        descriptor,
        deployment,
        stageAuthorityId: issued.authorityId,
        inputSha256: plan.planSha256,
      });
      const materializationRecord: (typeof materializations)[number] = {
        materialization,
        terminalOutcome: null,
        cleaned: false,
      };
      materializations.push(materializationRecord);
      outputKeys.push(...keys(materialization, 1));
      await dependencies.materializationCheckpoint?.(descriptor.id);
      await journalMaterializationKeys(
        dependencies.transport,
        issued.authorityId,
        dependencies.soulx.deploymentSha256,
        plan.planSha256,
        descriptor.id,
        materialization,
        1,
      );
      const jobId = await dispatchV208Durably(
        dependencies.transport,
        deployment,
        descriptor.id,
        materialization,
        descriptor.mode === "timeout" ? 5_000 : 60_000,
        issued.authorityId,
      );
      activeJobs.add(jobId);
      activeJobMaterializations.set(jobId, materializationRecord);
      if (descriptor.mode === "cancel") {
        const confirmed = await cancelAndConfirmTerminal(
          dependencies.transport,
          deployment,
          jobId,
          poll.cancelReads,
          poll.pollMs,
          issued.authorityId,
        );
        if (confirmed.status !== "CANCELLED")
          throw new Error("V208_CANCEL_TERMINAL_READBACK_UNPROVEN");
        await cleanupKnownInputs(materializationRecord, confirmed.status);
        cancellationVerified = true;
        activeJobs.delete(jobId);
        activeJobMaterializations.delete(jobId);
      } else {
        const observed = await terminal(
          dependencies.transport,
          deployment,
          jobId,
          poll.reads,
          poll.cancelReads,
          poll.pollMs,
          issued.authorityId,
        );
        activeJobs.delete(jobId);
        activeJobMaterializations.delete(jobId);
        if (observed.status === "IN_QUEUE" || observed.status === "IN_PROGRESS")
          throw new Error("V208_TERMINAL_STATUS_UNPROVEN");
        await cleanupKnownInputs(materializationRecord, observed.status);
        if (
          (descriptor.mode === "invalid" &&
            (observed.status !== "FAILED" ||
              observed.failureCode !== "SOULX_OUTPUT_CONTRACT_INVALID")) ||
          (descriptor.mode === "timeout" && observed.status !== "TIMED_OUT")
        )
          throw new Error("V208_FAULT_GATE_UNPROVEN");
        if (descriptor.mode === "invalid") invalidOutputVerified = true;
        if (descriptor.mode === "timeout") timeoutVerified = true;
      }
    }
    if (
      successReceipts !== 2 ||
      outputItems !== 8 ||
      nativeFullSplitVerified !== true ||
      exactAudioVideoVerified !== true ||
      cancellationVerified !== true ||
      invalidOutputVerified !== true ||
      timeoutVerified !== true ||
      inputCleanupEvidenceVerified !== 5 ||
      !deployment
    )
      throw new Error("V208_AGGREGATE_SUCCESS_PROOF_INVALID");
    await completePhase(
      dependencies.transport,
      qualificationOperation,
      qualificationClaim.record.state,
      {
        deployment,
        outputKeys,
        coldReady,
        coldWorkerId,
        billingBaselineUsd: qualificationBillingBaseline,
      } as unknown as JsonValue,
    );
    }
    // Stop the compute lane before deleting its output objects. This prevents a late worker write
    // from recreating a supposedly deleted artifact after cleanup was declared complete.
    const laneStillPresent =
      !resumedQualification ||
      (await dependencies.transport.findLaneByResourceKey(resourceKey)) !== null;
    if (laneStillPresent)
      await waitForLaneDrain(dependencies.transport, deployment, poll.pollMs);
    await deleteLaneDurably(dependencies.transport, deployment, issued.authorityId);
    await dependencies.interruptionCheckpoint?.("lane-delete");
    deployment = null;
    const laneDeleted = (await dependencies.transport.findLaneByResourceKey(resourceKey)) === null;
    if (!laneDeleted) throw new Error("V208_DELETE_UNCONFIRMED");
    laneAbsenceConfirmed = true;
    const attributableOperation = phaseOperation(
      issued.authorityId,
      dependencies.soulx.deploymentSha256,
      plan.planSha256,
      "attributable-cleanup",
    );
    const attributableClaim = await dependencies.transport.durable.claimOperation(
      attributableOperation,
    );
    if (attributableClaim.action !== "DONE") {
      await dependencies.cleanupAttributableResource(resourceKey);
      await dependencies.interruptionCheckpoint?.("attributable-cleanup");
      await completePhase(
        dependencies.transport,
        attributableOperation,
        attributableClaim.record.state,
        { cleaned: true },
      );
    }
    attributableCleaned = true;
    const outputOperation = phaseOperation(
      issued.authorityId,
      dependencies.soulx.deploymentSha256,
      plan.planSha256,
      "output-cleanup",
    );
    const outputClaim = await dependencies.transport.durable.claimOperation(outputOperation);
    const outputsDeleted =
      outputClaim.action === "DONE" ? true : await dependencies.cleanupOutputKeys(outputKeys);
    if (outputClaim.action !== "DONE") await dependencies.interruptionCheckpoint?.("output-delete");
    if (outputClaim.action !== "DONE")
      await completePhase(
        dependencies.transport,
        outputOperation,
        outputClaim.record.state,
        { outputsDeleted: true, outputKeysSha256: hashCanonical(outputKeys) },
      );
    outputsCleaned = true;
    const finalOperation = phaseOperation(
      issued.authorityId,
      dependencies.soulx.deploymentSha256,
      plan.planSha256,
      "final-zero-proof",
    );
    const finalClaim = await dependencies.transport.durable.claimOperation(finalOperation);
    if (finalClaim.action === "DONE") {
      const saved = finalClaim.record.evidence as unknown as { finalBilling?: number };
      if (!Number.isFinite(saved?.finalBilling))
        throw new Error("V208_FINAL_PHASE_EVIDENCE_INVALID");
      finalBilling = saved.finalBilling!;
      finalProofCompleted = true;
    } else {
      await proveFinalState();
      await dependencies.interruptionCheckpoint?.("final-zero");
      await completePhase(
        dependencies.transport,
        finalOperation,
        finalClaim.record.state,
        { finalBilling },
      );
    }
    if (
      successReceipts !== 2 ||
      outputItems !== 8 ||
      nativeFullSplitVerified !== true ||
      exactAudioVideoVerified !== true ||
      cancellationVerified !== true ||
      invalidOutputVerified !== true ||
      timeoutVerified !== true ||
      inputCleanupEvidenceVerified !== 5
    )
      throw new Error("V208_AGGREGATE_SUCCESS_PROOF_INVALID");
    if (!finalProofCompleted) throw new Error("V208_FINAL_CLEANUP_PROOF_INVALID");
    result = validateV208SoulXQualificationResult(plan, {
      schemaVersion: "videoforge.v208-soulx-qualification-result/v1",
      planSha256: plan.planSha256,
      qualified: true,
      completeSpanSeconds: [2, 4, 6, 10],
      coldModelReadyMs: coldReady,
      nativeFullSplitReadbackVerified: nativeFullSplitVerified,
      exactAudioVideoProbeVerified: exactAudioVideoVerified,
      workerReceiptsVerified: successReceipts,
      outputItemsVerified: outputItems,
      cancellationVerified,
      invalidOutputVerified,
      timeoutVerified,
      endpointDeleted: laneDeleted,
      templateDeleted: laneDeleted,
      outputsDeleted,
      finalZeroComputeReads: 3,
      retainedSoulXVolumeUnchanged: true,
      workersMin: 0,
      workersMax: 1,
      observedSpendUsd: finalBilling - qualificationBillingBaseline,
      cumulativeBillingUsd: finalBilling,
    });
    await dependencies.transport.durable.completeStageAuthority(
      issued.authorityId,
      hashCanonical(result),
      result as unknown as JsonValue,
    );
    await dependencies.serializeEvidence(result);
  } catch (error) {
    if (error instanceof V208ProcessInterruption) throw error;
    failure = error;
  }
  let cleanupFailed = false;
  if (deployment) {
    for (const jobId of activeJobs) {
      try {
        const terminal = await cancelAndConfirmTerminal(
          dependencies.transport,
          deployment,
          jobId,
          poll.cancelReads,
          poll.pollMs,
          issued.authorityId,
        );
        const record = activeJobMaterializations.get(jobId);
        if (
          record &&
          terminal.status !== "IN_QUEUE" &&
          terminal.status !== "IN_PROGRESS" &&
          !record.cleaned
        )
          await cleanupKnownInputs(record, terminal.status);
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (deployment) {
    try {
      const cleanupLaneOperation = phaseOperation(
        issued.authorityId,
        dependencies.soulx.deploymentSha256,
        plan.planSha256,
        "cleanup-lane-deleted",
      );
      const cleanupLaneClaim = await dependencies.transport.durable.claimOperation(
        cleanupLaneOperation,
      );
      if (cleanupLaneClaim.action === "DONE") laneAbsenceConfirmed = true;
      else {
        const existingLane = await dependencies.transport.findLaneByResourceKey(resourceKey);
        if (existingLane !== null) {
          assertDeploymentReadback(existingLane, deployment, dependencies.soulx);
          await waitForLaneDrain(dependencies.transport, deployment, poll.pollMs);
          await deleteLaneDurably(dependencies.transport, deployment, issued.authorityId);
          await dependencies.laneDeletionCheckpoint?.();
        }
        laneAbsenceConfirmed =
          existingLane === null ||
          (await dependencies.transport.findLaneByResourceKey(resourceKey)) === null;
        if (!laneAbsenceConfirmed) throw new Error("V208_DELETE_UNCONFIRMED");
        await completePhase(
          dependencies.transport,
          cleanupLaneOperation,
          cleanupLaneClaim.record.state,
          { deploymentSha256: deployment.deploymentSha256, absent: true },
        );
        await dependencies.interruptionCheckpoint?.("lane-delete");
      }
    } catch (error) {
      if (error instanceof V208ProcessInterruption) throw error;
      cleanupFailed = true;
    }
  }
  if (laneAbsenceConfirmed) {
    if (cleanupOnlyResume) {
      if (resumeCreateAbsent) {
        // A durable read-only lookup proved the create acknowledgement was lost and no lane exists.
        // Since the cleanup plan precedes every materialization, there are no deterministic R2 keys.
      } else if (!cleanupResumeDeployment || !cleanupPlan) cleanupFailed = true;
      else {
        for (const planned of cleanupPlan.descriptorKeys) {
          try {
            const descriptor = plannedDescriptors.find(({ id }) => id === planned.descriptorId);
            if (!descriptor) throw new Error("V208_CLEANUP_PLAN_INVALID");
            const cleanupOperation = phaseOperation(
              issued.authorityId,
              dependencies.soulx.deploymentSha256,
              plan.planSha256,
              `r2-cleanup-${planned.descriptorId}`,
            );
            const cleanupClaim = await dependencies.transport.durable.claimOperation(
              cleanupOperation,
            );
            if (cleanupClaim.action === "DONE") {
              outputKeys.push(...planned.outputKeys);
              continue;
            }
            const cleaned = await dependencies.cleanupDeterministicQualificationKeys({
              descriptor,
              deployment: cleanupResumeDeployment,
              stageAuthorityId: issued.authorityId,
              inputSha256: plan.planSha256,
              terminalOutcome: "FAILED",
            });
            if (
              cleaned.absenceVerified !== true ||
              cleaned.inputKeys.length === 0 ||
              cleaned.outputKeys.length === 0 ||
              canonicalizeJson(cleaned.inputKeys as unknown as JsonValue) !==
                canonicalizeJson(planned.inputKeys as unknown as JsonValue) ||
              canonicalizeJson(cleaned.outputKeys as unknown as JsonValue) !==
                canonicalizeJson(planned.outputKeys as unknown as JsonValue)
            )
              throw new Error("V208_DETERMINISTIC_R2_CLEANUP_INVALID");
            await completePhase(
              dependencies.transport,
              cleanupOperation,
              cleanupClaim.record.state,
              {
                descriptorId: planned.descriptorId,
                inputKeysSha256: hashCanonical(planned.inputKeys),
                outputKeysSha256: hashCanonical(planned.outputKeys),
                absenceVerified: true,
              },
            );
            outputKeys.push(...cleaned.outputKeys);
          } catch {
            cleanupFailed = true;
          }
        }
      }
    }
    for (const record of materializations.filter(({ cleaned }) => !cleaned)) {
      try {
        if (record.terminalOutcome) await cleanupKnownInputs(record, record.terminalOutcome);
        else {
          await dependencies.cleanupAmbiguousMaterializedInputs(record.materialization);
          record.cleaned = true;
        }
      } catch {
        cleanupFailed = true;
      }
    }
  }
  if (!attributableCleaned) {
    try {
      await dependencies.cleanupAttributableResource(resourceKey);
      attributableCleaned = true;
      laneAbsenceConfirmed =
        (await dependencies.transport.findLaneByResourceKey(resourceKey)) === null;
      if (!laneAbsenceConfirmed) cleanupFailed = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (!outputsCleaned && laneAbsenceConfirmed) {
    try {
      await dependencies.cleanupOutputKeys(outputKeys);
      outputsCleaned = true;
    } catch {
      cleanupFailed = true;
    }
  }
  if (!outputsCleaned) cleanupFailed = true;
  if (laneAbsenceConfirmed && outputsCleaned && !finalProofCompleted) {
    try {
      await proveFinalState();
    } catch {
      cleanupFailed = true;
    }
  }
  if (cleanupFailed) throw new Error("V208_ATTRIBUTABLE_CLEANUP_UNCONFIRMED");
  if (failure) throw failure;
  if (!result) throw new Error("V208_RESULT_MISSING");
  return result;
}
