import { createHash } from "node:crypto";

import {
  canonicalSha256,
  assertDispatchableEnvelope,
  mintDispatchToken,
  validateV2ProviderAuthority,
  type FairAdmissionRepository,
  type PredispatchCommit,
  type ProvenanceReceipt,
  type ServerlessLane,
  type Sha256,
  type V2ProviderAuthority,
  type VideoRuntimeService,
  type WorkspaceScope,
} from "@videoforge/control-plane";
import {
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type ServerlessWorkerJobEnvelopeV3Document,
} from "@videoforge/contracts";

import {
  HostedServerlessCompositionError,
  type HostedCleanupLaneService,
  type HostedQualifiedLaneService,
  type HostedServerlessRuntimeComposition,
  type HostedVerifiedDeploymentSnapshot,
} from "../runtime/hosted-serverless-runtime";
import type {
  HostedEnvelopePairSignature,
  HostedEnvelopePairSigner,
} from "./hosted-envelope-signer";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const LANES = Object.freeze(["mage_image", "soulx_avatar"] as const);

export interface HostedPersistedLaneDispatchTask {
  readonly taskId: string;
  readonly lane: ServerlessLane;
  readonly state: "BLOCKED" | "READY";
  readonly attemptOrdinal: number;
  readonly itemIds: readonly string[];
  readonly itemsManifestSha256: Sha256;
  readonly inputManifestSha256: Sha256;
  readonly outputPrefix: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly requestBody: Readonly<Record<string, unknown>>;
  readonly requestBodySha256: Sha256;
  readonly envelope: Readonly<Record<string, unknown>>;
  readonly spendCeilingUsd: number;
  readonly reservationUsd: number;
  readonly rateSource: string;
  readonly rateCheckedAt: string;
  readonly checkpointAuthority: V2ProviderAuthority;
  readonly authorityExpiresAt: string;
}

export type HostedPublishedDeploymentBinding = HostedVerifiedDeploymentSnapshot;

export interface HostedPersistedDispatchPlan {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly generationPlanSha256: Sha256;
  readonly paidAuthority: {
    readonly approvalId: string;
    readonly approvalSha256: Sha256;
    readonly totalCapUsd: number;
    readonly expiresAt: string;
  };
  readonly tasks: readonly HostedPersistedLaneDispatchTask[];
}

export interface HostedPersistedServerlessAttempt {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly lane: ServerlessLane;
  readonly attemptOrdinal: number;
  readonly attemptId: string;
  readonly outboxId: string;
  readonly state: string;
}

/** Every method is inspection-only. Implementations must tenant-scope reads before identifiers. */
export interface HostedDispatchInspection {
  readPlan(
    scope: WorkspaceScope,
    generationRequestId: string,
  ): Promise<HostedPersistedDispatchPlan | null>;
  readAttempt(
    scope: WorkspaceScope,
    input: { readonly taskId: string; readonly attemptOrdinal: number },
  ): Promise<HostedPersistedServerlessAttempt | null>;
  /** Global active deployment truth; this port is read-only and returns sealed identifiers only. */
  readPublishedDeployment(lane: ServerlessLane): Promise<HostedPublishedDeploymentBinding | null>;
}

export interface HostedDispatchRuntime {
  readonly fairAdmission: Pick<FairAdmissionRepository, "listOwned">;
  readonly videoRuntime: Pick<VideoRuntimeService, "byGenerationRequest" | "bindLaneAttempt">;
  requireLane(lane: ServerlessLane): Promise<HostedQualifiedLaneService>;
  requireCleanupLane(lane: ServerlessLane): Promise<HostedCleanupLaneService>;
}

export interface HostedPaidAuthorityClaim {
  readonly approvalId: string;
  readonly approvalSha256: Sha256;
  readonly claimId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequestId: string;
  readonly totalCapUsd: number;
  readonly cumulativeReservationUsd: number;
  readonly expiresAt: string;
  readonly claimedAt: string;
}

export interface HostedPaidAuthorityGate {
  /** Must atomically persist a unique approval claim or reject replay/cross-scope/cap drift. */
  claimOnce(input: {
    readonly approvalId: string;
    readonly approvalSha256: Sha256;
    readonly claimId: string;
    readonly scope: WorkspaceScope;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly generationRequestId: string;
    readonly generationPlanSha256: Sha256;
    readonly leaseId: string;
    readonly lanes: readonly {
      readonly lane: ServerlessLane;
      readonly checkpointId: "V2-07" | "V2-08";
      readonly operations: readonly string[];
      readonly resources: readonly string[];
      readonly deploymentId: string;
      readonly endpointIdSha256: Sha256;
      readonly endpointConfigSha256: Sha256;
      readonly workerImageDigest: Sha256;
      readonly modelManifestSha256: Sha256;
      readonly volumeIdSha256: Sha256;
      readonly volumeManifestSha256: Sha256;
      readonly deploymentSnapshotSha256: Sha256;
    }[];
    readonly totalCapUsd: number;
    readonly cumulativeReservationUsd: number;
    readonly expiresAt: string;
  }): Promise<HostedPaidAuthorityClaim>;
}

export type HostedDispatchBlockedReason =
  | "HOSTED_SERVERLESS_LANE_UNQUALIFIED"
  | "HOSTED_SERVERLESS_BINDING_INVALID"
  | "HOSTED_SERVERLESS_VERIFICATION_REJECTED"
  | "HOSTED_SERVERLESS_VERIFICATION_EXPIRED";

export type HostedDispatchResult =
  | {
      readonly state: "DISABLED_UNQUALIFIED";
      readonly reason: HostedDispatchBlockedReason;
      readonly inspectedTaskCount: number;
      readonly serverlessAttemptCount: 0;
      readonly outboxCount: 0;
      readonly authorityCount: 0;
      readonly transportCallCount: 0;
    }
  | {
      readonly state: "RECONCILIATION_REQUIRED";
      readonly reason: "EXISTING_ATTEMPT" | "DISPATCH_ACK_UNKNOWN";
      readonly attemptId: string;
      readonly taskId: string;
      readonly lane: ServerlessLane;
      readonly committed: readonly HostedCommittedDispatch[];
    }
  | {
      readonly state: "DISPATCHED";
      readonly committed: readonly HostedCommittedDispatch[];
    };

export interface HostedCommittedDispatch {
  readonly taskId: string;
  readonly lane: ServerlessLane;
  readonly attemptId: string;
  readonly authorityId: string;
  readonly outboxId: string;
  readonly providerJobId: string;
}

export class HostedDispatchCoordinationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HostedDispatchCoordinationError";
  }
}

export interface HostedDispatchIds {
  readonly attemptId: string;
  readonly authorityId: string;
  readonly outboxId: string;
  readonly ledgerId: string;
  readonly costEventId: string;
  readonly assignmentId: string;
  readonly leaseId: string;
  readonly holderSha256: Sha256;
}

function reject(code: string): never {
  throw new HostedDispatchCoordinationError(code);
}

function deterministicUuid(namespace: string, stableKey: string): string {
  const source = createHash("sha256")
    .update(`${namespace}:${stableKey}`)
    .digest("hex")
    .slice(0, 32);
  const versioned = `${source.slice(0, 12)}5${source.slice(13, 16)}8${source.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

export function deriveHostedDispatchIds(input: {
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly attemptOrdinal: number;
}): HostedDispatchIds {
  const stableKey = `${input.generationRequestId}:${input.taskId}:${input.attemptOrdinal}`;
  const id = (kind: string) => deterministicUuid(`hosted-serverless-${kind}`, stableKey);
  return Object.freeze({
    attemptId: id("attempt"),
    authorityId: id("authority"),
    outboxId: id("outbox"),
    ledgerId: id("ledger"),
    costEventId: id("cost-event"),
    assignmentId: id("assignment"),
    leaseId: id("outbox-lease"),
    holderSha256: `sha256:${createHash("sha256").update(`hosted-dispatch-holder:${stableKey}`).digest("hex")}`,
  });
}

function exactObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactIso(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

function deploymentSnapshotSha256(snapshot: HostedVerifiedDeploymentSnapshot): Sha256 {
  return canonicalSha256(snapshot as unknown as Readonly<Record<string, unknown>>);
}

function requiredAuthorityResources(binding: HostedPublishedDeploymentBinding): readonly string[] {
  const deployment = binding.deployment;
  return Object.freeze([
    `endpoint:${deployment.deploymentId}`,
    `gpu:nvidia-geforce-rtx-4090-eu-ro-1`,
    `image:${deployment.workerImageDigest.slice("sha256:".length)}`,
    `volume:${deployment.volumeIdSha256.slice("sha256:".length)}`,
  ]);
}

function validateLiveAuthority(input: {
  readonly task: HostedPersistedLaneDispatchTask;
  readonly binding: HostedPublishedDeploymentBinding;
  readonly now: string;
}): void {
  const task = input.task;
  const authority = task.checkpointAuthority;
  try {
    validateV2ProviderAuthority(authority);
  } catch {
    reject("HOSTED_SERVERLESS_LIVE_AUTHORITY_INVALID");
  }
  const operations = ["serverless_run", "serverless_status", "serverless_cancel"] as const;
  const resources = requiredAuthorityResources(input.binding);
  const authorizedAt = authority.authorizedByUserAt;
  const authorizedMillis = authorizedAt === null ? Number.NaN : Date.parse(authorizedAt);
  const expiresMillis = Date.parse(task.authorityExpiresAt);
  const nowMillis = Date.parse(input.now);
  const taskRateMillis = Date.parse(task.rateCheckedAt);
  if (
    authority.mode !== "paid" ||
    authority.provider !== "RunPod Serverless" ||
    authority.checkpointId !== (task.lane === "mage_image" ? "V2-07" : "V2-08") ||
    !sameStrings(authority.allowedOperations, operations) ||
    !sameStrings(authority.authorizedOperations, operations) ||
    !sameStrings(authority.resources, resources) ||
    authority.modelId !== input.binding.deployment.modelManifestSha256 ||
    !Number.isFinite(authority.capUsd) ||
    authority.capUsd <= 0 ||
    task.spendCeilingUsd > authority.capUsd ||
    task.reservationUsd > authority.capUsd ||
    !exactIso(task.authorityExpiresAt) ||
    !Number.isFinite(authorizedMillis) ||
    authorizedMillis > nowMillis ||
    expiresMillis <= nowMillis ||
    expiresMillis <= authorizedMillis ||
    expiresMillis - authorizedMillis > 24 * 60 * 60 * 1_000 ||
    taskRateMillis < authorizedMillis ||
    taskRateMillis > nowMillis ||
    authority.rateSnapshot.length !== resources.length ||
    authority.rateSnapshot.some(
      (rate) =>
        !resources.includes(rate.resourceId) ||
        Date.parse(rate.checkedAt) < authorizedMillis ||
        Date.parse(rate.checkedAt) > nowMillis,
    )
  ) {
    reject("HOSTED_SERVERLESS_LIVE_AUTHORITY_INVALID");
  }
}

async function validateEnvelopeBindings(input: {
  readonly scope: WorkspaceScope;
  readonly plan: HostedPersistedDispatchPlan;
  readonly task: HostedPersistedLaneDispatchTask;
  readonly ids: HostedDispatchIds;
  readonly binding: HostedPublishedDeploymentBinding;
  readonly now: string;
}): Promise<Readonly<Record<string, unknown>>> {
  if (
    Object.hasOwn(input.task.envelope, "authority_sha256") ||
    Object.hasOwn(input.task.envelope, "signature")
  ) {
    reject("HOSTED_SERVERLESS_ENVELOPE_TEMPLATE_SIGNED");
  }
  const structuralCandidate = {
    ...input.task.envelope,
    authority_sha256: `sha256:${"0".repeat(64)}`,
    signature: {
      algorithm: "HMAC-SHA256",
      key_id: "structural-validation-only",
      value: "0".repeat(64),
    },
  };
  try {
    assertDispatchableEnvelope(structuralCandidate);
  } catch {
    reject("HOSTED_SERVERLESS_ENVELOPE_INVALID");
  }
  let envelope: ServerlessWorkerJobEnvelopeV3Document;
  try {
    envelope = (
      await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", structuralCandidate)
    ).value;
  } catch {
    reject("HOSTED_SERVERLESS_ENVELOPE_INVALID");
  }
  const { task, plan, binding } = input;
  const deployment = binding.deployment;
  if (
    envelope.tenant.account_id !== input.scope.accountId ||
    envelope.tenant.workspace_id !== input.scope.workspaceId ||
    envelope.work.project_revision_id !== plan.projectRevisionId ||
    envelope.work.generation_request_id !== plan.generationRequestId ||
    envelope.work.task_id !== task.taskId ||
    envelope.work.attempt_id !== input.ids.attemptId ||
    envelope.work.lane !== task.lane ||
    envelope.work.items_manifest_sha256 !== task.itemsManifestSha256 ||
    envelope.work.item_count !== task.itemIds.length ||
    envelope.runtime.deployment_id !== deployment.deploymentId ||
    envelope.runtime.endpoint_profile_id !== deployment.endpointProfileId ||
    envelope.runtime.container_digest !== deployment.workerImageDigest ||
    envelope.runtime.model_manifest_sha256 !== deployment.modelManifestSha256 ||
    envelope.runtime.volume_id_sha256 !== deployment.volumeIdSha256 ||
    envelope.artifacts.input_manifest_sha256 !== task.inputManifestSha256 ||
    envelope.artifacts.output_prefix !== task.outputPrefix ||
    (envelope.artifacts as Readonly<Record<string, unknown>>).plan_manifest_sha256 !==
      plan.generationPlanSha256 ||
    envelope.limits.max_items !== task.itemIds.length ||
    envelope.limits.max_input_bytes !== task.maxInputBytes ||
    envelope.limits.max_output_bytes !== task.maxOutputBytes ||
    envelope.limits.execution_timeout_seconds !== deployment.executionTimeoutSeconds ||
    envelope.limits.init_timeout_seconds !== deployment.initTimeoutSeconds ||
    Date.parse(envelope.limits.expires_at) <= Date.parse(input.now) ||
    Date.parse(envelope.limits.expires_at) > Date.parse(task.authorityExpiresAt)
  ) {
    reject("HOSTED_SERVERLESS_ENVELOPE_BINDING_INVALID");
  }
  const { authority_sha256: _authority, signature: _signature, ...body } = envelope;
  void _authority;
  void _signature;
  return Object.freeze(body);
}

function validatePlan(
  scope: WorkspaceScope,
  generationRequestId: string,
  plan: HostedPersistedDispatchPlan,
): readonly HostedPersistedLaneDispatchTask[] {
  if (
    plan.accountId !== scope.accountId ||
    plan.workspaceId !== scope.workspaceId ||
    plan.generationRequestId !== generationRequestId
  ) {
    reject("HOSTED_SERVERLESS_PLAN_TENANT_MISMATCH");
  }
  if (
    ![plan.projectId, plan.projectRevisionId, plan.generationRequestId].every((value) =>
      UUID.test(value),
    ) ||
    !SHA256.test(plan.generationPlanSha256) ||
    !UUID.test(plan.paidAuthority.approvalId) ||
    !SHA256.test(plan.paidAuthority.approvalSha256) ||
    !Number.isFinite(plan.paidAuthority.totalCapUsd) ||
    plan.paidAuthority.totalCapUsd <= 0 ||
    !exactIso(plan.paidAuthority.expiresAt)
  ) {
    reject("HOSTED_SERVERLESS_PLAN_LINEAGE_INVALID");
  }
  if (
    plan.tasks.length !== LANES.length ||
    new Set(plan.tasks.map((task) => task.lane)).size !== LANES.length ||
    !LANES.every((lane) => plan.tasks.some((task) => task.lane === lane))
  ) {
    reject("HOSTED_SERVERLESS_TASK_CARDINALITY_INVALID");
  }
  const expectedPrefix =
    `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${plan.projectId}` +
    `/revision/${plan.projectRevisionId}/lane/`;
  for (const task of plan.tasks) {
    if (
      !UUID.test(task.taskId) ||
      task.state !== "READY" ||
      !Number.isSafeInteger(task.attemptOrdinal) ||
      task.attemptOrdinal < 1 ||
      task.attemptOrdinal > 3 ||
      task.itemIds.length < 1 ||
      task.itemIds.length > 4096 ||
      new Set(task.itemIds).size !== task.itemIds.length ||
      task.itemIds.some((itemId) => itemId.length < 1 || itemId.length > 240) ||
      !SHA256.test(task.itemsManifestSha256) ||
      !SHA256.test(task.inputManifestSha256) ||
      !SHA256.test(task.requestBodySha256) ||
      canonicalSha256(task.requestBody) !== task.requestBodySha256 ||
      !exactObject(task.requestBody) ||
      !exactObject(task.envelope) ||
      task.outputPrefix !==
        `${expectedPrefix}${task.lane === "mage_image" ? "mage-image" : "soulx-avatar"}` +
          `/job/${deriveHostedDispatchIds({ generationRequestId: plan.generationRequestId, taskId: task.taskId, attemptOrdinal: task.attemptOrdinal }).attemptId}` ||
      !Number.isSafeInteger(task.maxInputBytes) ||
      task.maxInputBytes < 1 ||
      !Number.isSafeInteger(task.maxOutputBytes) ||
      task.maxOutputBytes < 1 ||
      !Number.isFinite(task.spendCeilingUsd) ||
      task.spendCeilingUsd <= 0 ||
      task.spendCeilingUsd > 2 ||
      !Number.isFinite(task.reservationUsd) ||
      task.reservationUsd < 0 ||
      task.reservationUsd > task.spendCeilingUsd ||
      task.rateSource.length < 1 ||
      !exactIso(task.rateCheckedAt)
    ) {
      reject("HOSTED_SERVERLESS_TASK_LINEAGE_INVALID");
    }
  }
  return Object.freeze(
    [...plan.tasks].sort((left, right) => LANES.indexOf(left.lane) - LANES.indexOf(right.lane)),
  );
}

function validatePlanIdentity(
  scope: WorkspaceScope,
  generationRequestId: string,
  plan: HostedPersistedDispatchPlan,
): void {
  if (
    plan.accountId !== scope.accountId ||
    plan.workspaceId !== scope.workspaceId ||
    plan.generationRequestId !== generationRequestId
  ) {
    reject("HOSTED_SERVERLESS_PLAN_TENANT_MISMATCH");
  }
  if (
    ![plan.projectId, plan.projectRevisionId, plan.generationRequestId].every((value) =>
      UUID.test(value),
    ) ||
    !SHA256.test(plan.generationPlanSha256) ||
    plan.tasks.some(
      (task) => !UUID.test(task.taskId) || !LANES.includes(task.lane) || task.state === undefined,
    )
  ) {
    reject("HOSTED_SERVERLESS_PLAN_LINEAGE_INVALID");
  }
}

function validateExisting(
  scope: WorkspaceScope,
  plan: HostedPersistedDispatchPlan,
  task: Pick<HostedPersistedLaneDispatchTask, "taskId" | "lane" | "attemptOrdinal">,
  existing: HostedPersistedServerlessAttempt,
): void {
  const ids = deriveHostedDispatchIds({
    generationRequestId: plan.generationRequestId,
    taskId: task.taskId,
    attemptOrdinal: task.attemptOrdinal,
  });
  if (
    existing.accountId !== scope.accountId ||
    existing.workspaceId !== scope.workspaceId ||
    existing.projectId !== plan.projectId ||
    existing.projectRevisionId !== plan.projectRevisionId ||
    existing.generationRequestId !== plan.generationRequestId ||
    existing.taskId !== task.taskId ||
    existing.lane !== task.lane ||
    existing.attemptOrdinal !== task.attemptOrdinal ||
    existing.attemptId !== ids.attemptId ||
    existing.outboxId !== ids.outboxId
  ) {
    reject("HOSTED_SERVERLESS_EXISTING_ATTEMPT_LINEAGE_INVALID");
  }
}

async function preflight(input: {
  readonly scope: WorkspaceScope;
  readonly generationRequestId: string;
  readonly inspection: HostedDispatchInspection;
  readonly runtime: HostedDispatchRuntime;
  readonly now: string;
  readonly plan: HostedPersistedDispatchPlan;
}): Promise<{
  readonly plan: HostedPersistedDispatchPlan;
  readonly tasks: readonly HostedPersistedLaneDispatchTask[];
  readonly runtimeId: string;
  readonly leaseId: string;
}> {
  if (!exactIso(input.now)) reject("HOSTED_SERVERLESS_CLOCK_INVALID");
  const plan = input.plan;
  const tasks = validatePlan(input.scope, input.generationRequestId, plan);
  const [owned, runtime] = await Promise.all([
    input.runtime.fairAdmission.listOwned(input.scope),
    input.runtime.videoRuntime.byGenerationRequest(input.scope, plan.generationRequestId),
  ]);
  const request = owned.find(
    (candidate) =>
      candidate.requestKind === "VIDEO" && candidate.requestId === plan.generationRequestId,
  );
  if (
    request?.state !== "ACTIVE" ||
    request.leaseId === null ||
    request.leaseSlot === null ||
    request.leaseExpiresAt === null ||
    Date.parse(request.leaseExpiresAt) <= Date.parse(input.now) ||
    tasks.some((task) => {
      const lane = runtime?.lanes.find((candidate) => candidate.lane === task.lane);
      return lane === undefined || task.attemptOrdinal !== lane.attemptOrdinal + 1;
    })
  ) {
    reject("HOSTED_SERVERLESS_ADMISSION_REQUIRED");
  }
  if (
    runtime === null ||
    runtime.projectId !== plan.projectId ||
    runtime.projectRevisionId !== plan.projectRevisionId ||
    runtime.generationRequestId !== plan.generationRequestId ||
    runtime.stage !== "WAITING_FOR_WORKER" ||
    tasks.some((task) => {
      const lane = runtime.lanes.find((candidate) => candidate.lane === task.lane);
      return (
        lane?.state !== "MANIFEST_DURABLE" ||
        lane.itemsManifestSha256 !== task.itemsManifestSha256 ||
        lane.plannedItemCount !== task.itemIds.length ||
        lane.currentAttemptId !== null
      );
    })
  ) {
    reject("HOSTED_SERVERLESS_RUNTIME_NOT_PREPARED");
  }
  return { plan, tasks, runtimeId: runtime.runtimeId, leaseId: request.leaseId };
}

function blocked(
  error: HostedServerlessCompositionError,
  inspectedTaskCount: number,
): HostedDispatchResult {
  return Object.freeze({
    state: "DISABLED_UNQUALIFIED" as const,
    reason: error.code,
    inspectedTaskCount,
    serverlessAttemptCount: 0 as const,
    outboxCount: 0 as const,
    authorityCount: 0 as const,
    transportCallCount: 0 as const,
  });
}

/**
 * Provider-free composition seam. Plan/admission/runtime reads happen first. Both lane facades must
 * independently prove fresh canonical sealed qualification before any deployment, authority,
 * attempt, outbox, runtime binding, or transport operation is allowed.
 */
export async function dispatchHostedPreparedGeneration(input: {
  readonly scope: WorkspaceScope;
  readonly generationRequestId: string;
  readonly inspection: HostedDispatchInspection;
  readonly runtime: HostedDispatchRuntime | HostedServerlessRuntimeComposition;
  readonly paidAuthorityGate: HostedPaidAuthorityGate;
  /** Required trusted boundary; absent composition must fail before any durable mutation. */
  readonly envelopeSigner?: HostedEnvelopePairSigner;
  readonly now: string;
}): Promise<HostedDispatchResult> {
  if (!exactIso(input.now)) reject("HOSTED_SERVERLESS_CLOCK_INVALID");
  const inspectedPlan = await input.inspection.readPlan(input.scope, input.generationRequestId);
  if (inspectedPlan === null) reject("HOSTED_SERVERLESS_PLAN_NOT_FOUND");
  validatePlanIdentity(input.scope, input.generationRequestId, inspectedPlan);
  let lanes: Readonly<Record<ServerlessLane, HostedQualifiedLaneService>>;
  try {
    const [mage, soulx] = await Promise.all([
      input.runtime.requireLane("mage_image"),
      input.runtime.requireLane("soulx_avatar"),
    ]);
    lanes = Object.freeze({ mage_image: mage, soulx_avatar: soulx });
  } catch (error) {
    if (error instanceof HostedServerlessCompositionError) {
      return blocked(error, inspectedPlan.tasks.length);
    }
    throw error;
  }

  const { plan, tasks, runtimeId, leaseId } = await preflight({ ...input, plan: inspectedPlan });

  const published = await Promise.all(
    LANES.map(
      async (lane) => [lane, await input.inspection.readPublishedDeployment(lane)] as const,
    ),
  );
  const bindings = {} as Record<ServerlessLane, HostedPublishedDeploymentBinding>;
  for (const [lane, binding] of published) {
    const verified = lanes[lane].verifiedDeployment;
    if (
      binding === null ||
      binding.deployment.deploymentId !== lanes[lane].deploymentId ||
      binding.sealedLineageSha256 !== verified.sealedLineageSha256 ||
      canonicalSha256(binding.deployment) !== canonicalSha256(verified.deployment) ||
      canonicalSha256(binding.sealedLineage as unknown as Readonly<Record<string, unknown>>) !==
        canonicalSha256(verified.sealedLineage as unknown as Readonly<Record<string, unknown>>) ||
      deploymentSnapshotSha256(binding) !== deploymentSnapshotSha256(verified)
    ) {
      reject("HOSTED_SERVERLESS_ACTIVE_DEPLOYMENT_DRIFT");
    }
    bindings[lane] = binding;
  }
  const envelopeTemplates = new Map<ServerlessLane, Readonly<Record<string, unknown>>>();
  for (const task of tasks) {
    const ids = deriveHostedDispatchIds({
      generationRequestId: plan.generationRequestId,
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
    });
    validateLiveAuthority({ task, binding: bindings[task.lane], now: input.now });
    if (
      task.checkpointAuthority.capUsd !== plan.paidAuthority.totalCapUsd ||
      task.authorityExpiresAt !== plan.paidAuthority.expiresAt
    ) {
      reject("HOSTED_SERVERLESS_LIVE_AUTHORITY_INVALID");
    }
    envelopeTemplates.set(
      task.lane,
      await validateEnvelopeBindings({
        scope: input.scope,
        plan,
        task,
        ids,
        binding: bindings[task.lane],
        now: input.now,
      }),
    );
  }

  for (const task of tasks) {
    const existing = await input.inspection.readAttempt(input.scope, {
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
    });
    if (existing !== null) {
      validateExisting(input.scope, plan, task, existing);
      return Object.freeze({
        state: "RECONCILIATION_REQUIRED" as const,
        reason: "EXISTING_ATTEMPT" as const,
        attemptId: existing.attemptId,
        taskId: task.taskId,
        lane: task.lane,
        committed: Object.freeze([]),
      });
    }
  }

  if (input.envelopeSigner === undefined) {
    reject("HOSTED_SERVERLESS_ENVELOPE_SIGNER_REQUIRED");
  }

  const cumulativeReservationUsd = tasks.reduce((total, task) => total + task.reservationUsd, 0);
  if (
    !Number.isFinite(cumulativeReservationUsd) ||
    cumulativeReservationUsd < 0 ||
    cumulativeReservationUsd > plan.paidAuthority.totalCapUsd ||
    Date.parse(plan.paidAuthority.expiresAt) <= Date.parse(input.now)
  ) {
    reject("HOSTED_SERVERLESS_PAID_AUTHORITY_CAP_INVALID");
  }
  const claimId = deterministicUuid(
    "hosted-paid-authority-claim",
    `${plan.paidAuthority.approvalId}:${plan.generationRequestId}`,
  );
  const claim = await input.paidAuthorityGate.claimOnce({
    approvalId: plan.paidAuthority.approvalId,
    approvalSha256: plan.paidAuthority.approvalSha256,
    claimId,
    scope: input.scope,
    projectId: plan.projectId,
    projectRevisionId: plan.projectRevisionId,
    generationRequestId: plan.generationRequestId,
    generationPlanSha256: plan.generationPlanSha256,
    leaseId,
    lanes: tasks.map((task) => ({
      lane: task.lane,
      checkpointId: task.lane === "mage_image" ? "V2-07" : "V2-08",
      operations: Object.freeze([...task.checkpointAuthority.authorizedOperations]),
      resources: Object.freeze([...task.checkpointAuthority.resources]),
      deploymentId: bindings[task.lane].deployment.deploymentId,
      endpointIdSha256: bindings[task.lane].deployment.endpointIdSha256,
      endpointConfigSha256: bindings[task.lane].deployment.endpointConfigSha256,
      workerImageDigest: bindings[task.lane].deployment.workerImageDigest,
      modelManifestSha256: bindings[task.lane].deployment.modelManifestSha256,
      volumeIdSha256: bindings[task.lane].deployment.volumeIdSha256,
      volumeManifestSha256: bindings[task.lane].deployment.volumeManifestSha256,
      deploymentSnapshotSha256: deploymentSnapshotSha256(bindings[task.lane]),
    })),
    totalCapUsd: plan.paidAuthority.totalCapUsd,
    cumulativeReservationUsd,
    expiresAt: plan.paidAuthority.expiresAt,
  });
  if (
    claim.approvalId !== plan.paidAuthority.approvalId ||
    claim.approvalSha256 !== plan.paidAuthority.approvalSha256 ||
    claim.claimId !== claimId ||
    claim.accountId !== input.scope.accountId ||
    claim.workspaceId !== input.scope.workspaceId ||
    claim.generationRequestId !== plan.generationRequestId ||
    claim.totalCapUsd !== plan.paidAuthority.totalCapUsd ||
    claim.cumulativeReservationUsd !== cumulativeReservationUsd ||
    claim.expiresAt !== plan.paidAuthority.expiresAt ||
    !exactIso(claim.claimedAt) ||
    Date.parse(claim.claimedAt) > Date.parse(claim.expiresAt)
  ) {
    reject("HOSTED_SERVERLESS_PAID_AUTHORITY_CLAIM_INVALID");
  }

  // Source-only safety boundary: these lane commits are not yet one atomic database operation.
  // Pair signing and verification prevent either transport from starting with a partial/unsigned
  // pair, but activation remains forbidden until the persistence adapter commits both lanes
  // atomically with the paid-authority claim.
  const prepared: {
    readonly task: HostedPersistedLaneDispatchTask;
    readonly ids: HostedDispatchIds;
    readonly dispatchToken: string;
    readonly body: Readonly<Record<string, unknown>>;
  }[] = [];
  for (const task of tasks) {
    const ids = deriveHostedDispatchIds({
      generationRequestId: plan.generationRequestId,
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
    });
    const template = envelopeTemplates.get(task.lane);
    if (template === undefined) reject("HOSTED_SERVERLESS_ENVELOPE_INVALID");
    const dispatchToken = mintDispatchToken();
    const body = Object.freeze({ ...template, dispatch_token: dispatchToken });
    prepared.push(Object.freeze({ task, ids, dispatchToken, body }));
  }

  const beforeHashes = await Promise.all(
    prepared.map(({ body }) => sha256CanonicalJson(body as JsonValue)),
  );
  let signedPair: readonly HostedEnvelopePairSignature[];
  try {
    signedPair = await input.envelopeSigner.signPair(
      prepared.map(({ task, body }) => ({ lane: task.lane, body: body as JsonValue })),
    );
  } catch {
    reject("HOSTED_SERVERLESS_ENVELOPE_SIGNING_FAILED");
  }
  if (
    signedPair.length !== prepared.length ||
    new Set(signedPair.map(({ lane }) => lane)).size !== prepared.length ||
    new Set(signedPair.map(({ keyId }) => keyId)).size !== 1 ||
    new Set(signedPair.map(({ keyHash }) => keyHash)).size !== 1
  ) {
    reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
  }
  let pairVerified = false;
  try {
    pairVerified = await input.envelopeSigner.verifyPair(
      prepared.map(({ task, body }) => ({ lane: task.lane, body: body as JsonValue })),
      signedPair,
    );
  } catch {
    reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
  }
  if (!pairVerified) reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
  const signedEnvelopes = new Map<ServerlessLane, ServerlessWorkerJobEnvelopeV3Document>();
  for (let index = 0; index < prepared.length; index += 1) {
    const item = prepared[index]!;
    const signed = signedPair.find(({ lane }) => lane === item.task.lane);
    const afterHash = await sha256CanonicalJson(item.body as JsonValue);
    if (
      signed === undefined ||
      beforeHashes[index] !== afterHash ||
      signed.authoritySha256 !== beforeHashes[index] ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(signed.keyId) ||
      !SHA256.test(signed.keyHash) ||
      signed.signature.algorithm !== "HMAC-SHA256" ||
      signed.signature.key_id !== signed.keyId ||
      !/^[0-9a-f]{64}$/u.test(signed.signature.value)
    ) {
      reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
    }
    try {
      signedEnvelopes.set(
        item.task.lane,
        (
          await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", {
            ...item.body,
            authority_sha256: signed.authoritySha256,
            signature: signed.signature,
          })
        ).value,
      );
    } catch {
      reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
    }
  }

  const predispatchCommits = new Map<ServerlessLane, PredispatchCommit>();
  for (const { task, ids, dispatchToken } of prepared) {
    const envelope = signedEnvelopes.get(task.lane);
    if (envelope === undefined) reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
    const commit = await lanes[task.lane].commitPredispatch(input.scope, {
      dispatchToken,
      envelope: envelope as unknown as Readonly<Record<string, unknown>>,
      attemptId: ids.attemptId,
      authorityId: ids.authorityId,
      outboxId: ids.outboxId,
      ledgerId: ids.ledgerId,
      costEventId: ids.costEventId,
      projectId: plan.projectId,
      projectRevisionId: plan.projectRevisionId,
      generationRequestId: plan.generationRequestId,
      taskId: task.taskId,
      attemptOrdinal: task.attemptOrdinal,
      itemsManifestSha256: task.itemsManifestSha256,
      itemCount: task.itemIds.length,
      inputManifestSha256: task.inputManifestSha256,
      outputPrefix: task.outputPrefix,
      maxInputBytes: task.maxInputBytes,
      maxOutputBytes: task.maxOutputBytes,
      requestBody: task.requestBody,
      spendCeilingUsd: task.spendCeilingUsd,
      reservationUsd: task.reservationUsd,
      rateSource: task.rateSource,
      rateCheckedAt: task.rateCheckedAt,
      now: claim.claimedAt,
      checkpointAuthority: task.checkpointAuthority,
    });
    predispatchCommits.set(task.lane, commit);
  }

  const committed: HostedCommittedDispatch[] = [];
  for (const { task, ids } of prepared) {
    const envelope = signedEnvelopes.get(task.lane);
    const commit = predispatchCommits.get(task.lane);
    if (envelope === undefined || commit === undefined) {
      reject("HOSTED_SERVERLESS_ENVELOPE_SIGNATURE_INVALID");
    }
    await input.runtime.videoRuntime.bindLaneAttempt(input.scope, {
      runtimeId,
      lane: task.lane,
      attemptId: ids.attemptId,
      attemptOrdinal: task.attemptOrdinal,
      now: claim.claimedAt,
    });
    const outcome = await lanes[task.lane].dispatchOnce(input.scope, {
      commit,
      envelope: envelope as unknown as Readonly<Record<string, unknown>>,
      requestBodySha256: task.requestBodySha256,
      assignmentId: ids.assignmentId,
      leaseId: ids.leaseId,
      holderSha256: ids.holderSha256,
      now: claim.claimedAt,
    });
    if (outcome.kind === "DISPATCH_ACK_UNKNOWN") {
      return Object.freeze({
        state: "RECONCILIATION_REQUIRED" as const,
        reason: "DISPATCH_ACK_UNKNOWN" as const,
        attemptId: ids.attemptId,
        taskId: task.taskId,
        lane: task.lane,
        committed: Object.freeze([...committed]),
      });
    }
    committed.push(
      Object.freeze({
        taskId: task.taskId,
        lane: task.lane,
        attemptId: ids.attemptId,
        authorityId: ids.authorityId,
        outboxId: ids.outboxId,
        providerJobId: outcome.providerJobId,
      }),
    );
  }
  return Object.freeze({ state: "DISPATCHED" as const, committed: Object.freeze(committed) });
}

async function exactExisting(input: {
  readonly scope: WorkspaceScope;
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly attemptOrdinal: number;
  readonly inspection: HostedDispatchInspection;
}): Promise<HostedPersistedServerlessAttempt> {
  const plan = await input.inspection.readPlan(input.scope, input.generationRequestId);
  if (plan === null) reject("HOSTED_SERVERLESS_PLAN_NOT_FOUND");
  validatePlanIdentity(input.scope, input.generationRequestId, plan);
  const existing = await input.inspection.readAttempt(input.scope, {
    taskId: input.taskId,
    attemptOrdinal: input.attemptOrdinal,
  });
  if (existing === null) reject("HOSTED_SERVERLESS_ATTEMPT_NOT_FOUND");
  validateExisting(
    input.scope,
    plan,
    { taskId: input.taskId, lane: existing.lane, attemptOrdinal: input.attemptOrdinal },
    existing,
  );
  return existing;
}

/** Exact owned cancellation is available independently of qualification freshness. */
export async function cancelHostedPersistedAttempt(input: {
  readonly scope: WorkspaceScope;
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly attemptOrdinal: number;
  readonly inspection: HostedDispatchInspection;
  readonly runtime: Pick<HostedDispatchRuntime, "requireCleanupLane">;
  readonly requestedBy:
    | "OWNER_ACCOUNT"
    | "SYSTEM_DEADLINE"
    | "SYSTEM_TTL_EXPIRY"
    | "SYSTEM_SPEND_CEILING";
  readonly settledCostUsd: number;
  readonly now: string;
}): Promise<{ readonly providerTerminalState: string | null }> {
  const existing = await exactExisting(input);
  const lane = await input.runtime.requireCleanupLane(existing.lane);
  return lane.cancel(input.scope, {
    cancellationId: deterministicUuid("hosted-serverless-cancellation", existing.attemptId),
    attemptId: existing.attemptId,
    requestedBy: input.requestedBy,
    settledCostUsd: input.settledCostUsd,
    now: input.now,
  });
}

/** Reconciliation is explicit and can never flow back into a dispatch call. */
export async function reconcileHostedPersistedAttempt(input: {
  readonly scope: WorkspaceScope;
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly attemptOrdinal: number;
  readonly inspection: HostedDispatchInspection;
  readonly runtime: Pick<HostedDispatchRuntime, "requireCleanupLane">;
  readonly trigger:
    | "DISPATCH_ACK_UNKNOWN"
    | "POLL_DEADLINE"
    | "RESTART"
    | "WEBHOOK_ADVISORY"
    | "RESULT_WINDOW_EXPIRY_RISK"
    | "OWNER_CANCELLATION";
  readonly durableReceipts: readonly ProvenanceReceipt[];
  readonly possibleDuplicateComputeUsd: number;
  readonly now: string;
}): Promise<
  "UNIQUE_ASSIGNMENT_PROVED" | "NO_ASSIGNMENT_PROVED" | "TERMINAL_CONFIRMED" | "AMBIGUOUS_STOP"
> {
  const existing = await exactExisting(input);
  const ids = deriveHostedDispatchIds(existing);
  const lane = await input.runtime.requireCleanupLane(existing.lane);
  return lane.reconcile(input.scope, {
    reconciliationId: deterministicUuid("hosted-serverless-reconciliation", existing.attemptId),
    attemptId: existing.attemptId,
    assignmentId: ids.assignmentId,
    outboxId: existing.outboxId,
    trigger: input.trigger,
    durableReceipts: input.durableReceipts,
    possibleDuplicateComputeUsd: input.possibleDuplicateComputeUsd,
    now: input.now,
  });
}
