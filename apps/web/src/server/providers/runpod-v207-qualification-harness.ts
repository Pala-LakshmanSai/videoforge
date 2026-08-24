import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import {
  hashRunPodV207EndpointConfiguration,
  RunPodControlError,
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodJobDiagnostic,
  V207_RUNPOD_MIN_CUDA_VERSION,
  V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
  V207_RUNPOD_REGION,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_HANDLER_CONCURRENCY,
  V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
  V207_RUNPOD_INIT_TIMEOUT_SECONDS,
  V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
  V207_RUNPOD_FLASHBOOT,
  V207_RUNPOD_GPU,
  V207_RUNPOD_VOLUME_MOUNT,
  V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
  V207_TIMEOUT_TTL_MS,
  type RunPodEndpointPolicy,
  type RunPodDisposableResourceInventory,
  type RunPodInventory,
  type RunPodJobResult,
  type RunPodV207TimeoutPolicy,
  type RunPodV207ConcurrentReaderPolicy,
  type RunPodV207Placement,
} from "./runpod-control";
export { V207_TIMEOUT_EXECUTION_TIMEOUT_MS, V207_TIMEOUT_TTL_MS } from "./runpod-control";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PORT_CAPABILITY = /^[A-Za-z0-9._:-]{32,512}$/u;
const PORT_ID = ID;
const URL_MAX_LENGTH = 8_192;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const POST_JOB_WARM_IDLE_MAX_ATTEMPTS = 12;
const V207_RESUME_ACCOUNT = "account-a";
const V207_RESUME_WORKSPACE = "workspace-a";
const V207_RESUME_PROJECT = "project-a";
const V207_RESUME_REVISION = "revision-a";
const V207_PLAN_MANIFEST_SCHEMA = "videoforge-v207-plan-manifest/v1";
/** Pinned approved RTX 4090 Flex rate for this qualification lineage. */
export const V207_RUNPOD_GPU_HOURLY_RATE_USD = 1.1 as const;
/**
 * Provider billing is asynchronous. This is a conservative per-worker metering margin, not a
 * promise about when RunPod's account total will settle.
 */
export const V207_RUNPOD_BILLING_LAG_MARGIN_SECONDS = 60 as const;

type RecordValue = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function jsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(canonicalizeJson(value)) as JsonValue;
  } catch {
    throw new RunPodControlError("RUNPOD_QUALIFICATION_INPUT_NOT_JSON");
  }
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function validateUrl(value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > URL_MAX_LENGTH) {
    throw new RunPodControlError("RUNPOD_OUTPUT_URL_INVALID");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RunPodControlError("RUNPOD_OUTPUT_URL_INVALID");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new RunPodControlError("RUNPOD_OUTPUT_URL_INVALID");
  }
}

/** Generated-output authority returned by the artifact control plane. */
export interface RunPodV207OutputAuthority {
  readonly schemaVersion: "artifact-generated-output-authority/v1";
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly outputPrefix: string;
  /** One bounded generated-output authority and one opaque signed URL per batch item. */
  readonly authorities: readonly RecordValue[];
  readonly outputPutUrls: readonly string[];
}

export interface RunPodV207DispatchBatchInput {
  readonly requestKey: string;
  readonly attemptId: string;
  readonly input: RecordValue;
  readonly inputPorts?: readonly RecordValue[];
  readonly inputGetUrls?: readonly string[];
  readonly outputAuthority: RunPodV207OutputAuthority;
}

/** Exact durable artifact commit/readback facts carried into a replacement attempt. */
export interface RunPodV207AcceptedUnitRecord {
  readonly tenant: { readonly account_id: string; readonly workspace_id: string };
  readonly project_id: string;
  readonly revision_id: string;
  readonly lane: "mage-image";
  readonly plan_manifest: RecordValue;
  readonly plan_manifest_sha256: string;
  readonly source_attempt_id: string;
  readonly item_id: string;
  readonly output_object_key: string;
  readonly output_sha256: string;
  readonly output_bytes: number;
  readonly artifact_commit_receipt_sha256: string;
  readonly signed_provenance_receipt_sha256: string;
  readonly readback_port: RecordValue;
  readonly readback_get_url: string;
}

/** Redaction-safe identity facts required to prove a real process replacement. */
export interface RunPodV207WorkerProcessIdentity {
  readonly schema_version: "videoforge-v207-worker-process-identity/v1";
  /** Hash of the worker/pod identity signed by the worker in its provenance receipt. */
  readonly worker_id_sha256: string;
  /** Hash of the runtime pod identity echoed by each item runtime probe. */
  readonly pod_id_sha256: string;
}

export interface RunPodV207ProcessReplacementBoundary {
  readonly schema_version: "videoforge-v207-process-replacement-boundary/v1";
  readonly seed_job_id_sha256: string;
  readonly seed_worker_id_sha256: string;
  readonly seed_pod_id_sha256: string;
  readonly terminal_provider_pod_id_sha256: string;
  readonly terminal_provider_identity_source: "terminal_pod_record";
  readonly terminal_worker_record_count: number;
  readonly terminal_pod_record_count: number;
  readonly terminal_scale_zero_confirmed: true;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_WORKER_ID_KEYS = [
  "id",
  "workerId",
  "worker_id",
  "podId",
  "pod_id",
  "instanceId",
  "instance_id",
] as const;

function providerWorkerIdHash(value: unknown): string | null {
  const worker = asRecord(value);
  if (!worker) return null;
  for (const key of PROVIDER_WORKER_ID_KEYS) {
    const candidate = worker[key];
    if (typeof candidate === "string" && candidate.trim() !== "") return sha256(candidate);
  }
  return null;
}

/** The complete immutable scene plan carried into every durable accepted-unit fact. */
export function buildV207PlanManifest(
  batchItems: readonly unknown[],
  modelRevision: string,
): RecordValue {
  if (
    typeof modelRevision !== "string" ||
    !ID.test(modelRevision) ||
    batchItems.length < 1 ||
    batchItems.some((item) => asRecord(item) === null)
  ) {
    throw new RunPodControlError("RUNPOD_RESUME_PLAN_MANIFEST_INVALID");
  }
  return {
    schema_version: V207_PLAN_MANIFEST_SCHEMA,
    tenant: { account_id: V207_RESUME_ACCOUNT, workspace_id: V207_RESUME_WORKSPACE },
    project_id: V207_RESUME_PROJECT,
    revision_id: V207_RESUME_REVISION,
    lane: "mage-image",
    model_revision: modelRevision,
    items: batchItems.map((item) => jsonValue(item)),
  };
}

export function hashV207PlanManifest(planManifest: RecordValue): string {
  return sha256(canonicalizeJson(planManifest));
}

export interface RunPodV207QualificationHarnessOptions {
  readonly control: RunPodControlClient;
  /** Kept in memory only and never included in evidence. */
  readonly apiKey: string;
  readonly templateName: string;
  readonly endpointName: string;
  readonly imageName: string;
  readonly containerDiskInGb: number;
  /** Endpoint environment is supplied at activation time and never persisted in evidence. */
  readonly templateEnvironment?: Readonly<Record<string, string>>;
  readonly placement: RunPodV207Placement;
  readonly initialPolicy: RunPodEndpointPolicy;
  readonly concurrentReaderPolicy: RunPodV207ConcurrentReaderPolicy;
  /** No default is intentional: a paid run must supply its own approved finite cap. */
  readonly finiteSpendCapUsd: number;
  readonly spendSnapshotUsd: () => Promise<number>;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Optional bounded cancellation hook used by the live runner between provider reads. */
  readonly abortCheck?: () => void;
  /** Optional redacted status checkpoint hook; it must not receive raw provider identifiers. */
  readonly onStatusCheckpoint?: (status: {
    readonly idHash: string;
    readonly status: string;
    readonly executionTimeMs: number | null;
    readonly delayTimeMs: number | null;
  }) => Promise<void>;
  /** Injectable monotonic clock used only for conservative cancellation settlement. */
  readonly monotonicNowMs?: () => number;
}

/**
 * Verifies the exact ordered reader results after a bounded terminal recovery.  The harness only
 * owns provider status and dispatch identity; the caller owns the application output, R2 readback,
 * and v3 receipt checks.  Inputs are supplied in the same order as results so a reader cannot be
 * accepted against the sibling reader's authority.
 */
export type RunPodV207ConcurrentReaderVerifier = (
  results: readonly [RunPodJobResult, RunPodJobResult],
  inputs: readonly [RunPodV207DispatchBatchInput, RunPodV207DispatchBatchInput],
) => Promise<void>;

export interface RunPodV207HarnessEvidence {
  readonly schemaVersion: "videoforge.v2-07-qualification-harness/v1";
  readonly templateIdHash: string | null;
  readonly endpointIdHash: string | null;
  readonly initialConfigHash: string | null;
  readonly concurrentReaderConfigHash: string | null;
  readonly retainedVolumeIdHash: string;
  readonly imageDigest: string;
  readonly events: readonly RecordValue[];
  readonly measuredSpendUsd: number | null;
  readonly projectedSpendUsd: number | null;
  readonly activeWorstCaseLiabilityUsd: number;
  readonly newPaidWorkFenced: boolean;
  readonly gpuHourlyRateUsd: typeof V207_RUNPOD_GPU_HOURLY_RATE_USD;
  readonly billingLagMarginSeconds: typeof V207_RUNPOD_BILLING_LAG_MARGIN_SECONDS;
}

const assertAuthority = (
  authority: RunPodV207OutputAuthority,
  expected: {
    attemptId: string;
    itemCount: number;
    outputPrefix: string;
    reservationIds: readonly string[];
  },
): void => {
  if (
    authority.schemaVersion !== "artifact-generated-output-authority/v1" ||
    authority.attemptId !== expected.attemptId ||
    authority.outputPrefix !== expected.outputPrefix ||
    authority.authorities.length !== expected.itemCount ||
    authority.outputPutUrls.length !== expected.itemCount ||
    !ID.test(authority.accountId) ||
    !ID.test(authority.workspaceId) ||
    !authority.outputPrefix.startsWith("tenant/") ||
    authority.outputPrefix.includes("?") ||
    authority.outputPrefix.includes("../")
  ) {
    throw new RunPodControlError("RUNPOD_OUTPUT_AUTHORITY_INVALID");
  }
  const reservations = new Set<string>();
  for (const [index, port] of authority.authorities.entries()) {
    const keys = Object.keys(port).sort().join(",");
    if (
      keys !==
        "account_id,capability_handle,content_type,expires_at,max_content_length,max_uses,method,path,reservation_id,schema_version,workspace_id" ||
      port.schema_version !== "artifact-generated-output-authority/v1" ||
      port.account_id !== authority.accountId ||
      port.workspace_id !== authority.workspaceId ||
      port.method !== "PUT" ||
      typeof port.reservation_id !== "string" ||
      !PORT_ID.test(port.reservation_id) ||
      reservations.has(port.reservation_id) ||
      typeof port.path !== "string" ||
      !port.path.startsWith(`/${authority.outputPrefix}/artifact/`) ||
      !port.path.includes(`/job/${authority.attemptId}/`) ||
      port.path.includes("?") ||
      port.path.includes("/../") ||
      typeof port.content_type !== "string" ||
      !/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/u.test(port.content_type) ||
      typeof port.max_content_length !== "number" ||
      !Number.isSafeInteger(port.max_content_length) ||
      port.max_content_length < 1 ||
      port.max_content_length > 10_737_418_240 ||
      typeof port.expires_at !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(port.expires_at) ||
      typeof port.max_uses !== "number" ||
      port.max_uses !== 1 ||
      typeof port.capability_handle !== "string" ||
      !PORT_CAPABILITY.test(port.capability_handle)
    ) {
      throw new RunPodControlError("RUNPOD_OUTPUT_AUTHORITY_INVALID");
    }
    if (port.reservation_id !== expected.reservationIds[index]) {
      throw new RunPodControlError("RUNPOD_OUTPUT_AUTHORITY_RESERVATION_MISMATCH");
    }
    reservations.add(port.reservation_id);
    validateUrl(authority.outputPutUrls[index]);
  }
};

function assertResumeUnits(
  resumeValue: unknown,
  input: RunPodV207DispatchBatchInput,
  batchItems: readonly unknown[],
): number {
  if (resumeValue === undefined) return 0;
  const resume = asRecord(resumeValue);
  const acceptedUnits = resume?.accepted_units;
  if (
    resume?.schema_version !== "serverless-unit-resume/v1" ||
    !Array.isArray(acceptedUnits) ||
    acceptedUnits.length < 1 ||
    acceptedUnits.length >= batchItems.length
  ) {
    throw new RunPodControlError("RUNPOD_RESUME_AUTHORITY_INVALID");
  }
  const batch = asRecord(input.input.batch);
  const modelRevision = batch?.model_revision;
  if (typeof modelRevision !== "string") {
    throw new RunPodControlError("RUNPOD_RESUME_PLAN_MANIFEST_INVALID");
  }
  const expectedPlanManifest = buildV207PlanManifest(batchItems, modelRevision);
  const expectedPlanManifestSha256 = hashV207PlanManifest(expectedPlanManifest);
  const resumeCanonicalJson = input.input.resume_canonical_json;
  if (typeof resumeCanonicalJson !== "string" || resumeCanonicalJson !== canonicalizeJson(resume)) {
    throw new RunPodControlError("RUNPOD_RESUME_MANIFEST_HASH_INVALID");
  }
  const expectedResumeManifestSha256 = sha256(resumeCanonicalJson);
  const envelope = asRecord(input.input.envelope);
  const artifacts = asRecord(envelope?.artifacts);
  if (
    artifacts?.resume_manifest_sha256 !== expectedResumeManifestSha256 ||
    artifacts?.plan_manifest_sha256 !== expectedPlanManifestSha256 ||
    resume?.plan_manifest_sha256 !== expectedPlanManifestSha256 ||
    canonicalizeJson(resume?.plan_manifest) !== canonicalizeJson(expectedPlanManifest)
  ) {
    throw new RunPodControlError("RUNPOD_RESUME_MANIFEST_HASH_INVALID");
  }
  const expectedItems = new Map<string, RecordValue>();
  for (const rawItem of batchItems) {
    const item = asRecord(rawItem);
    if (typeof item?.scene_id !== "string") {
      throw new RunPodControlError("RUNPOD_RESUME_BATCH_INVALID");
    }
    expectedItems.set(item.scene_id, item);
  }
  const seen = new Set<string>();
  for (const rawUnit of acceptedUnits) {
    const unit = asRecord(rawUnit) as Record<string, any> | null;
    const tenant = asRecord(unit?.tenant) as Record<string, any> | null;
    const port = asRecord(unit?.readback_port) as Record<string, any> | null;
    if (
      !unit ||
      Object.keys(unit).sort().join(",") !==
        "artifact_commit_receipt_sha256,item_id,lane,output_bytes,output_object_key,output_sha256,plan_manifest,plan_manifest_sha256,project_id,readback_get_url,readback_port,revision_id,signed_provenance_receipt_sha256,source_attempt_id,tenant" ||
      !tenant ||
      Object.keys(tenant).sort().join(",") !== "account_id,workspace_id" ||
      tenant.account_id !== V207_RESUME_ACCOUNT ||
      tenant.workspace_id !== V207_RESUME_WORKSPACE ||
      typeof unit.project_id !== "string" ||
      unit.project_id !== V207_RESUME_PROJECT ||
      typeof unit.revision_id !== "string" ||
      unit.revision_id !== V207_RESUME_REVISION ||
      unit.lane !== "mage-image" ||
      canonicalizeJson(unit.plan_manifest) !== canonicalizeJson(expectedPlanManifest) ||
      unit.plan_manifest_sha256 !== expectedPlanManifestSha256 ||
      typeof unit.source_attempt_id !== "string" ||
      unit.source_attempt_id === input.attemptId ||
      !ID.test(unit.source_attempt_id) ||
      typeof unit.item_id !== "string" ||
      !expectedItems.has(unit.item_id) ||
      seen.has(unit.item_id) ||
      typeof unit.output_object_key !== "string" ||
      unit.output_object_key !==
        `tenant/${V207_RESUME_ACCOUNT}/workspace/${V207_RESUME_WORKSPACE}/project/${V207_RESUME_PROJECT}/revision/${V207_RESUME_REVISION}/lane/mage-image/job/${unit.source_attempt_id}/artifact/${unit.item_id}` ||
      typeof unit.output_sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.output_sha256) ||
      !Number.isSafeInteger(unit.output_bytes) ||
      unit.output_bytes < 1 ||
      unit.output_bytes > 10_737_418_240 ||
      typeof unit.artifact_commit_receipt_sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.artifact_commit_receipt_sha256) ||
      typeof unit.signed_provenance_receipt_sha256 !== "string" ||
      !/^sha256:[0-9a-f]{64}$/u.test(unit.signed_provenance_receipt_sha256) ||
      !port ||
      port.schema_version !== "artifact-transfer-port/v3" ||
      port.path !== `/${unit.output_object_key}` ||
      port.method !== "GET" ||
      port.account_id !== V207_RESUME_ACCOUNT ||
      port.workspace_id !== V207_RESUME_WORKSPACE ||
      port.content_type !== "image/png" ||
      port.content_length !== unit.output_bytes ||
      port.checksum_sha256 !== unit.output_sha256 ||
      port.max_uses !== 1 ||
      typeof port.reservation_id !== "string" ||
      typeof port.expires_at !== "string" ||
      typeof port.capability_handle !== "string" ||
      !PORT_CAPABILITY.test(port.capability_handle)
    ) {
      throw new RunPodControlError("RUNPOD_RESUME_AUTHORITY_INVALID");
    }
    validateUrl(unit.readback_get_url);
    seen.add(unit.item_id);
  }
  return acceptedUnits.length;
}

function assertExecutionSubset(
  executionValue: unknown,
  input: RunPodV207DispatchBatchInput,
  batchItems: readonly unknown[],
  acceptedUnitCount: number,
): number {
  const execution = asRecord(executionValue);
  const itemIds = execution?.item_ids;
  const batch = asRecord(input.input.batch);
  const modelRevision = batch?.model_revision;
  const envelope = asRecord(input.input.envelope);
  const artifacts = asRecord(envelope?.artifacts);
  if (executionValue === undefined && artifacts?.execution_manifest_sha256 === undefined) {
    return batchItems.length - acceptedUnitCount;
  }
  if (
    execution?.schema_version !== "serverless-execution-subset/v1" ||
    typeof modelRevision !== "string" ||
    !Array.isArray(itemIds) ||
    itemIds.length < 1 ||
    itemIds.some((itemId) => typeof itemId !== "string" || !ID.test(itemId)) ||
    new Set(itemIds).size !== itemIds.length
  ) {
    throw new RunPodControlError("RUNPOD_EXECUTION_SUBSET_INVALID");
  }
  const expectedPlan = buildV207PlanManifest(batchItems, modelRevision);
  const expectedPlanHash = hashV207PlanManifest(expectedPlan);
  const planCanonicalJson = input.input.plan_manifest_canonical_json;
  const executionCanonicalJson = input.input.execution_canonical_json;
  if (
    typeof executionCanonicalJson !== "string" ||
    executionCanonicalJson !== canonicalizeJson(execution) ||
    typeof planCanonicalJson !== "string" ||
    planCanonicalJson !== canonicalizeJson(expectedPlan) ||
    sha256(planCanonicalJson) !== expectedPlanHash
  ) {
    throw new RunPodControlError("RUNPOD_EXECUTION_SUBSET_INVALID");
  }
  const expectedExecutionHash = sha256(executionCanonicalJson);
  const plannedIds = new Set(
    batchItems.map((item) => {
      const value = asRecord(item);
      if (typeof value?.scene_id !== "string") {
        throw new RunPodControlError("RUNPOD_EXECUTION_SUBSET_INVALID");
      }
      return value.scene_id;
    }),
  );
  if (
    execution.plan_manifest_sha256 !== expectedPlanHash ||
    artifacts?.plan_manifest_sha256 !== expectedPlanHash ||
    artifacts?.execution_manifest_sha256 !== expectedExecutionHash ||
    itemIds.some((itemId) => !plannedIds.has(itemId))
  ) {
    throw new RunPodControlError("RUNPOD_EXECUTION_SUBSET_INVALID");
  }
  if (acceptedUnitCount > 0) {
    const resume = asRecord(input.input.resume);
    const accepted = new Set(
      Array.isArray(resume?.accepted_units)
        ? resume.accepted_units.map((unit) => asRecord(unit)?.item_id)
        : [],
    );
    const unresolved = [...plannedIds].filter((itemId) => !accepted.has(itemId));
    if (
      itemIds.length !== unresolved.length ||
      itemIds.some((itemId) => accepted.has(itemId)) ||
      unresolved.some((itemId) => !itemIds.includes(itemId))
    ) {
      throw new RunPodControlError("RUNPOD_EXECUTION_SUBSET_INVALID");
    }
  }
  return itemIds.length;
}

export function buildDispatchRequest(input: RunPodV207DispatchBatchInput): JsonValue {
  if (!ID.test(input.requestKey) || !ID.test(input.attemptId)) {
    throw new RunPodControlError("RUNPOD_QUALIFICATION_ATTEMPT_INVALID");
  }
  const batch = asRecord(input.input.batch);
  const batchItems = Array.isArray(batch?.items) ? batch.items : [];
  const envelope = asRecord(input.input.envelope);
  const artifacts = asRecord(envelope?.artifacts);
  const plannedItemCount = Array.isArray(batch?.items) ? batch.items.length : null;
  const outputPrefix = artifacts?.output_prefix ?? input.outputAuthority.outputPrefix;
  const reservationIds = artifacts?.transfer_port_reservation_ids;
  const inputPorts = input.inputPorts ?? [];
  const inputGetUrls = input.inputGetUrls ?? [];
  if (
    plannedItemCount === null ||
    typeof outputPrefix !== "string" ||
    !Array.isArray(reservationIds) ||
    reservationIds.some((value) => typeof value !== "string") ||
    Object.hasOwn(input.input, "policy") ||
    !input.input.envelope ||
    Object.hasOwn(input.input, "ports") ||
    Object.hasOwn(input.input, "output_put_urls") ||
    inputGetUrls.length !== inputPorts.length ||
    inputGetUrls.some((value) => {
      try {
        validateUrl(value);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new RunPodControlError(
      inputGetUrls.length !== inputPorts.length
        ? "RUNPOD_INPUT_URLS_INVALID"
        : "RUNPOD_QUALIFICATION_INPUT_INVALID",
    );
  }
  const acceptedUnitCount = assertResumeUnits(input.input.resume, input, batchItems);
  const itemCount = assertExecutionSubset(
    input.input.execution,
    input,
    batchItems,
    acceptedUnitCount,
  );
  if (itemCount < 1) throw new RunPodControlError("RUNPOD_RESUME_AUTHORITY_INVALID");
  assertAuthority(input.outputAuthority, {
    attemptId: input.attemptId,
    itemCount,
    outputPrefix,
    reservationIds: reservationIds as readonly string[],
  });
  return jsonValue({
    ...input.input,
    ports: {
      inputs: inputPorts,
      outputs: [],
    },
    input_get_urls: inputGetUrls,
    generated_output_authorities: input.outputAuthority.authorities,
    output_put_urls: input.outputAuthority.outputPutUrls,
  });
}

/**
 * Keep the recovery result ordered by the exact generated-output authority tuple.  This is the
 * small provider-neutral check that prevents a completed reader from being paired with its
 * sibling's output; the caller's verifier remains responsible for bytes, R2 readbacks, signatures,
 * and receipt hashes.
 */
function assertConcurrentReaderOutputOrder(
  result: RunPodJobResult,
  input: RunPodV207DispatchBatchInput,
): void {
  const output = asRecord(result.output);
  const batch = asRecord(input.input.batch);
  const batchItems = Array.isArray(batch?.items) ? batch.items : [];
  const acceptedUnitCount = assertResumeUnits(input.input.resume, input, batchItems);
  const itemCount = assertExecutionSubset(
    input.input.execution,
    input,
    batchItems,
    acceptedUnitCount,
  );
  const items = output?.items;
  const receipt = asRecord(output?.provenance_receipt);
  const receiptItems = receipt?.items;
  if (
    result.status !== "COMPLETED" ||
    output?.status !== "SUCCEEDED" ||
    !Array.isArray(items) ||
    items.length !== itemCount ||
    !Array.isArray(receiptItems) ||
    receiptItems.length !== itemCount
  ) {
    throw new RunPodControlError("RUNPOD_CONCURRENT_READER_OUTPUT_INVALID");
  }
  for (const index of items.keys()) {
    const authority = asRecord(input.outputAuthority.authorities[index]);
    const item = asRecord(items[index]);
    const receiptItem = asRecord(receiptItems[index]);
    const expectedObjectKey =
      typeof authority?.path === "string" && authority.path.startsWith("/")
        ? authority.path.slice(1)
        : null;
    if (
      expectedObjectKey === null ||
      item?.output_object_key !== expectedObjectKey ||
      receiptItem?.output_object_key !== expectedObjectKey
    ) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_OUTPUT_ORDER_INVALID");
    }
  }
}

/**
 * Bounded V2-07 lifecycle harness. It deliberately accepts output authorities from a separate
 * artifact control plane; it never fabricates a checksum, URL, capability, or reservation. This
 * is the safe seam for a generated-output issuer/finalize implementation.
 */
export class RunPodV207QualificationHarness {
  readonly #options: RunPodV207QualificationHarnessOptions;
  readonly #guard = new RunPodDrainGuard();
  readonly #events: RecordValue[] = [];
  readonly #readerJobs: RunPodServerlessJobClient[] = [];
  /** Exact reader job identities that must all be observed terminal before drain fallback. */
  readonly #readerJobIds = new Set<string>();
  /** Dispatch-order ledger for the two reader jobs and their exact input authorities. */
  readonly #readerJobOrder: string[] = [];
  readonly #readerInputs = new Map<string, RunPodV207DispatchBatchInput>();
  /** Terminal status results are retained in memory for bounded post-timeout verification. */
  readonly #terminalReaderResults = new Map<string, RunPodJobResult>();
  /** Every acknowledged job remains owned until a terminal status is observed. */
  readonly #ownedJobs = new Map<string, RunPodServerlessJobClient>();
  /** A terminal observation fences a later exact request-key replay from becoming owned again. */
  readonly #terminalJobIds = new Set<string>();
  /** Request/job identity is retained in memory to prove replay identity and reject job reuse. */
  readonly #requestJobIds = new Map<
    string,
    { readonly id: string; readonly client: RunPodServerlessJobClient }
  >();
  readonly #jobRequestKeys = new Map<string, string>();
  #template: { readonly id: string; readonly idHash: string } | null = null;
  #endpoint: { readonly id: string; readonly idHash: string } | null = null;
  #jobs: RunPodServerlessJobClient | null = null;
  #endpointIdentityBound = false;
  #initialConfigHash: string | null = null;
  #concurrentReaderConfigHash: string | null = null;
  #initialQualificationComplete = false;
  /** A direct warm-idle fallback is permitted only immediately after an owned terminal job. */
  #postJobWarmIdlePending = false;
  /** Blocks the primary client until every independently guarded reader has drained. */
  #concurrentReaderFence = false;
  /** Claims the one allowed two-reader dispatch while its primary fence is active. */
  #concurrentReaderDispatchClaimed = false;
  /** A timeout arms exactly one post-timeout status recovery; it never permits redispatch. */
  #concurrentReaderRecoveryArmed = false;
  /** Conservative cost already incurred but potentially absent from the asynchronous bill. */
  #projectedSettledLiabilityUsd = 0;
  /** Worst-case liability for every acknowledged non-terminal job. */
  readonly #activeSpendLiabilitiesUsd = new Map<
    string,
    { readonly usd: number; readonly initIncluded: boolean }
  >();
  /** A reservation held across an in-flight /run request before its provider job id is known. */
  #pendingDispatchLiabilityUsd = 0;
  #newPaidWorkFenced = false;
  /** Verified initialization reservations that exactly one following dispatch may consume. */
  #reservedInitCredits = 0;
  /** First-dispatch clock is immutable for the job lifetime and is never reset by replay/status. */
  readonly #dispatchStartedAtMs = new Map<string, number>();
  /** Null-timed cancellations remain fully reserved until two exact zero-worker health reads. */
  readonly #pendingCancelledLiabilities = new Map<
    string,
    {
      readonly startedAtMs: number;
      readonly reserved: { readonly usd: number; readonly initIncluded: boolean };
    }
  >();

  constructor(options: RunPodV207QualificationHarnessOptions) {
    if (
      options.templateName.trim() !== options.templateName ||
      options.endpointName.trim() !== options.endpointName ||
      !ID.test(options.templateName) ||
      !ID.test(options.endpointName) ||
      options.imageName !== V207_REPAIRED_IMAGE ||
      !Number.isSafeInteger(options.containerDiskInGb) ||
      options.containerDiskInGb !== 120 ||
      options.initialPolicy.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
      options.initialPolicy.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS ||
      options.concurrentReaderPolicy.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
      options.concurrentReaderPolicy.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS ||
      !Number.isFinite(options.finiteSpendCapUsd) ||
      options.finiteSpendCapUsd <= 0 ||
      options.finiteSpendCapUsd > 1_000 ||
      (options.pollIntervalMs !== undefined &&
        (!Number.isSafeInteger(options.pollIntervalMs) || options.pollIntervalMs < 1)) ||
      (options.maxPolls !== undefined &&
        (!Number.isSafeInteger(options.maxPolls) ||
          options.maxPolls < 1 ||
          options.maxPolls > 1_000))
    ) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_SCOPE_INVALID");
    }
    this.#options = options;
  }

  private mark(event: string, detail: RecordValue = {}): void {
    this.#events.push(Object.freeze({ event, ...detail }));
  }

  private checkAbort(): void {
    this.#options.abortCheck?.();
  }

  private monotonicNowMs(): number | null {
    const value = (this.#options.monotonicNowMs ?? (() => performance.now()))();
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  /**
   * Reconcile/cancel every acknowledged non-terminal job before endpoint drain. This is deliberately
   * separate from the normal success path: an operator abort or bounded reconciliation timeout can
   * interrupt a caller while the provider job is still running, and deleting the endpoint without
   * fencing that exact job would create an unplanned duplicate/cleanup race.
   */
  private async cancelOwnedJobs(): Promise<void> {
    if (this.#ownedJobs.size === 0) return;
    if (this.#guard.snapshot() === "active" || this.#guard.snapshot() === "warm_idle") {
      this.#guard.beginDrain();
    }
    const failures: string[] = [];
    for (const [jobId, client] of [...this.#ownedJobs.entries()]) {
      try {
        const observed = await client.status(jobId);
        this.mark("owned_job_cleanup_status", {
          job_id_hash: observed.idHash,
          status: observed.status,
        });
        if (TERMINAL_STATUSES.has(observed.status)) {
          this.settleJobSpendLiability(observed);
          // Cleanup reconciliation is authoritative for the same owned job ID. A bounded
          // caller timeout may end before RunPod exposes terminal status; preserve the later
          // terminal observation so max-two drain can prove quiescence without redispatch.
          this.#terminalJobIds.add(jobId);
          if (this.#readerJobIds.has(jobId)) this.#terminalReaderResults.set(jobId, observed);
        } else {
          const cancelled = await client.cancel(jobId);
          if (cancelled.status !== "CANCELLED") {
            throw new RunPodControlError("RUNPOD_OWNED_JOB_CANCEL_UNCONFIRMED");
          }
          this.#terminalJobIds.add(jobId);
          this.settleJobSpendLiability(cancelled);
          if (this.#readerJobIds.has(jobId)) this.#terminalReaderResults.set(jobId, cancelled);
          this.mark("owned_job_cleanup_cancelled", {
            job_id_hash: cancelled.idHash,
            status: cancelled.status,
          });
        }
        this.#ownedJobs.delete(jobId);
      } catch (error) {
        failures.push(
          error instanceof RunPodControlError ? error.code : "RUNPOD_OWNED_JOB_CLEANUP_FAILED",
        );
      }
    }
    if (failures.length > 0) {
      this.mark("owned_job_cleanup_uncertain", { error_count: failures.length });
      throw new RunPodControlError("RUNPOD_OWNED_JOB_CLEANUP_UNCERTAIN");
    }
  }

  private async assertSpendWithinCap(): Promise<number> {
    const spend = await this.#options.spendSnapshotUsd();
    if (!Number.isFinite(spend) || spend < 0) {
      throw new RunPodControlError("RUNPOD_SPEND_SNAPSHOT_INVALID");
    }
    if (spend > this.#options.finiteSpendCapUsd) {
      this.#newPaidWorkFenced = true;
      throw new RunPodControlError("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    }
    return spend;
  }

  private workerLiabilityUsd(executionTimeoutMs: number, includeInit: boolean): number {
    const seconds =
      (includeInit ? V207_RUNPOD_INIT_TIMEOUT_SECONDS : 0) +
      executionTimeoutMs / 1_000 +
      V207_RUNPOD_IDLE_TIMEOUT_SECONDS +
      V207_RUNPOD_BILLING_LAG_MARGIN_SECONDS;
    return (seconds / 3_600) * V207_RUNPOD_GPU_HOURLY_RATE_USD;
  }

  private infrastructureLiabilityUsd(workerCount: number): number {
    return (
      workerCount * (V207_RUNPOD_INIT_TIMEOUT_SECONDS / 3_600) * V207_RUNPOD_GPU_HOURLY_RATE_USD
    );
  }

  private activeSpendLiabilityUsd(): number {
    return [...this.#activeSpendLiabilitiesUsd.values()].reduce((sum, value) => sum + value.usd, 0);
  }

  /**
   * Admit a new potentially billed action only when the latest bill plus every unreported or
   * in-flight worst-case liability fits under the approved cap. Because RunPod billing settles
   * asynchronously, this is a local fail-closed projection fence, not a provider-side guarantee
   * that the final invoice cannot exceed the cap.
   */
  private async reservePaidLiability(liabilityUsd: number): Promise<void> {
    if (this.#newPaidWorkFenced) {
      throw new RunPodControlError("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    }
    const observedSpendUsd = await this.assertSpendWithinCap();
    const projectedSpendUsd =
      Math.max(observedSpendUsd, this.#projectedSettledLiabilityUsd) +
      this.activeSpendLiabilityUsd() +
      this.#pendingDispatchLiabilityUsd +
      liabilityUsd;
    if (projectedSpendUsd > this.#options.finiteSpendCapUsd + Number.EPSILON) {
      this.#newPaidWorkFenced = true;
      this.mark("finite_spend_headroom_insufficient", {
        observed_spend_usd: observedSpendUsd,
        projected_spend_usd: projectedSpendUsd,
        approved_cap_usd: this.#options.finiteSpendCapUsd,
        new_liability_usd: liabilityUsd,
        active_liability_usd: this.activeSpendLiabilityUsd(),
        unsettled_liability_floor_usd: this.#projectedSettledLiabilityUsd,
        no_new_paid_action: true,
        drain_existing_owned_work: true,
      });
      throw new RunPodControlError("RUNPOD_FINITE_SPEND_HEADROOM_INSUFFICIENT");
    }
  }

  private settleJobSpendLiability(job: RunPodJobResult): void {
    const reserved = this.#activeSpendLiabilitiesUsd.get(job.id);
    if (reserved === undefined) return;
    if (job.status === "CANCELLED" && job.executionTimeMs === null) {
      if (this.#pendingCancelledLiabilities.has(job.id)) return;
      const startedAtMs = this.#dispatchStartedAtMs.get(job.id);
      if (startedAtMs === undefined) {
        this.#activeSpendLiabilitiesUsd.delete(job.id);
        this.#projectedSettledLiabilityUsd += reserved.usd;
        this.#newPaidWorkFenced = true;
        this.mark("cancel_liability_retained_timer_unavailable", {
          job_id_hash: job.idHash,
          retained_liability_usd: reserved.usd,
          no_new_paid_action: true,
        });
        return;
      }
      this.#pendingCancelledLiabilities.set(job.id, { startedAtMs, reserved });
      this.mark("cancel_liability_pending_stable_zero", {
        job_id_hash: job.idHash,
        retained_liability_usd: reserved.usd,
      });
      return;
    }
    this.#activeSpendLiabilitiesUsd.delete(job.id);
    const measuredExecutionMs = job.executionTimeMs;
    const realizedUpperBound =
      measuredExecutionMs === null
        ? reserved.usd
        : this.workerLiabilityUsd(
            Math.min(measuredExecutionMs, V207_RUNPOD_EXECUTION_TIMEOUT_MS),
            reserved.initIncluded,
          );
    this.#projectedSettledLiabilityUsd += Math.min(reserved.usd, realizedUpperBound);
  }

  private settleCancelledLiabilitiesAfterStableZero(): void {
    for (const [jobId, pending] of this.#pendingCancelledLiabilities) {
      const endedAtMs = this.monotonicNowMs();
      const elapsedMs = endedAtMs === null ? null : endedAtMs - pending.startedAtMs;
      this.#activeSpendLiabilitiesUsd.delete(jobId);
      if (elapsedMs === null || !Number.isFinite(elapsedMs) || elapsedMs < 0) {
        this.#projectedSettledLiabilityUsd += pending.reserved.usd;
        this.#newPaidWorkFenced = true;
        this.mark("cancel_liability_retained_clock_anomaly", {
          retained_liability_usd: pending.reserved.usd,
          no_new_paid_action: true,
        });
      } else {
        const elapsedUpperBound = this.workerLiabilityUsd(elapsedMs, pending.reserved.initIncluded);
        const settledUsd = Math.min(pending.reserved.usd, elapsedUpperBound);
        this.#projectedSettledLiabilityUsd += settledUsd;
        this.mark("cancel_liability_settled_after_stable_zero", {
          elapsed_through_stable_zero_ms: elapsedMs,
          settled_liability_usd: settledUsd,
          original_reserved_liability_usd: pending.reserved.usd,
          stable_zero_read_count: 2,
        });
      }
      this.#pendingCancelledLiabilities.delete(jobId);
    }
  }

  private assertRetainedMageVolume(inventory: RunPodInventory): void {
    const expectedVolumeIdHash = sha256(this.#options.placement.networkVolumeId);
    const matches = inventory.networkVolumes.filter(
      (volume) =>
        volume.idHash === expectedVolumeIdHash &&
        volume.sizeGb === V207_RUNPOD_MAGE_VOLUME_SIZE_GB &&
        volume.dataCenterId === V207_RUNPOD_REGION,
    );
    if (matches.length !== 1) {
      throw new RunPodControlError("RUNPOD_MAGE_VOLUME_IDENTITY_UNCONFIRMED");
    }
    this.mark("retained_mage_volume_verified", {
      retained_volume_id_hash: expectedVolumeIdHash,
      retained_volume_size_gb: V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
      retained_volume_region: V207_RUNPOD_REGION,
    });
  }

  private assertCreated(): void {
    if (!this.#template || !this.#endpoint || !this.#jobs) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_NOT_CREATED");
    }
  }

  private assertPrimaryDispatchAllowed(): void {
    if (this.#concurrentReaderFence) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    }
  }

  private templateIdentityMatches(resource: {
    readonly name: string;
    readonly raw: RecordValue;
  }): boolean {
    const environment = asRecord(resource.raw.env);
    const expectedEnvironment = {
      LOG_LEVEL: "INFO",
      RUNPOD_INIT_TIMEOUT: String(V207_RUNPOD_INIT_TIMEOUT_SECONDS),
      ...(this.#options.templateEnvironment ?? {}),
    };
    return (
      resource.name === this.#options.templateName &&
      resource.raw.imageName === this.#options.imageName &&
      resource.raw.containerDiskInGb === this.#options.containerDiskInGb &&
      (resource.raw.isPublic === undefined || resource.raw.isPublic === false) &&
      resource.raw.isServerless === true &&
      (resource.raw.volumeInGb === undefined || resource.raw.volumeInGb === 0) &&
      (resource.raw.volumeMountPath === "/workspace" ||
        resource.raw.volumeMountPath === V207_RUNPOD_VOLUME_MOUNT) &&
      environment !== null &&
      Object.entries(expectedEnvironment).every(([key, value]) => environment[key] === value)
    );
  }

  private endpointIdentityMatches(
    resource: { readonly name: string; readonly raw: RecordValue },
    templateId: string,
    expectedPolicy: RunPodEndpointPolicy | RunPodV207ConcurrentReaderPolicy = this.#options
      .initialPolicy,
  ): boolean {
    // The Serverless endpoint list/detail shape currently omits computeType and dataCenterIds;
    // absence is tolerated only for those provider-unreported fields. Explicit values remain
    // strict, including the provider-observed FlashBoot=true policy pinned after Attempt 14.
    const networkVolumeId = resource.raw.networkVolumeId;
    const networkVolumeIds = resource.raw.networkVolumeIds;
    const volumeBindingMatches =
      (networkVolumeId === undefined ||
        networkVolumeId === this.#options.placement.networkVolumeId) &&
      (networkVolumeIds === undefined ||
        (Array.isArray(networkVolumeIds) &&
          networkVolumeIds.length === 1 &&
          networkVolumeIds[0] === this.#options.placement.networkVolumeId)) &&
      (networkVolumeId === this.#options.placement.networkVolumeId ||
        (Array.isArray(networkVolumeIds) &&
          networkVolumeIds.length === 1 &&
          networkVolumeIds[0] === this.#options.placement.networkVolumeId));
    const requiredExactStrings = (value: unknown, expected: readonly string[]): boolean =>
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((entry, index) => entry === expected[index]);
    const optionalExactStrings = (value: unknown, expected: readonly string[]): boolean =>
      value === undefined || requiredExactStrings(value, expected);
    return (
      resource.name === this.#options.endpointName &&
      resource.raw.templateId === templateId &&
      (resource.raw.computeType === undefined || resource.raw.computeType === "GPU") &&
      resource.raw.workersMin === 0 &&
      resource.raw.workersMax === expectedPolicy.workersMax &&
      resource.raw.gpuCount === 1 &&
      requiredExactStrings(resource.raw.gpuTypeIds, [V207_RUNPOD_GPU]) &&
      volumeBindingMatches &&
      optionalExactStrings(resource.raw.dataCenterIds, [V207_RUNPOD_REGION]) &&
      requiredExactStrings(resource.raw.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) &&
      resource.raw.minCudaVersion === V207_RUNPOD_MIN_CUDA_VERSION &&
      resource.raw.flashboot === V207_RUNPOD_FLASHBOOT &&
      resource.raw.idleTimeout === expectedPolicy.idleTimeout &&
      resource.raw.executionTimeoutMs === expectedPolicy.executionTimeoutMs &&
      resource.raw.scalerType === "REQUEST_COUNT" &&
      resource.raw.scalerValue === 1
    );
  }

  /**
   * RunPod can retain a stale throttled=1 health counter after the attributable worker and Pod
   * have both reached EXITED. Quiescent health alone never admits work. This method promotes that
   * state to true scale-zero only when a second provider inventory independently proves that every
   * attributable worker/Pod is terminal and the sole endpoint/template still have exact identity.
   */
  private async confirmTerminalScaleZeroBaseline(
    expectedPolicy: RunPodEndpointPolicy | RunPodV207ConcurrentReaderPolicy,
    event: string,
    mode: "health_first" | "startup_inventory_only" | "post_job_queue_only" = "health_first",
    options: {
      readonly requireProviderPodIdentity?: boolean;
      readonly expectedProviderPodIdSha256?: string;
    } = {},
  ): Promise<{
    readonly providerPodIdSha256: string | null;
    readonly providerIdentitySource: "terminal_pod_record" | null;
    readonly terminalWorkerRecordCount: number;
    readonly terminalPodRecordCount: number;
    readonly terminalScaleZeroConfirmed: true;
  }> {
    if (!this.#template || !this.#endpoint || !this.#jobs) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_NOT_CREATED");
    }
    if (
      mode === "startup_inventory_only" &&
      (this.#ownedJobs.size > 0 ||
        this.#readerJobs.length > 0 ||
        this.#initialQualificationComplete)
    ) {
      throw new RunPodControlError("RUNPOD_STARTUP_INVENTORY_FALLBACK_INVALID");
    }
    if (mode === "post_job_queue_only" && this.#ownedJobs.size > 0) {
      // A queue-only health read cannot account for an acknowledged job whose terminal state was
      // not observed locally. Never use terminal inventory to hide that still-owned work.
      throw new RunPodControlError("RUNPOD_POST_JOB_QUEUE_FALLBACK_INVALID");
    }
    try {
      // A fresh FlashBoot endpoint can leave a terminal worker/Pod record behind while its
      // health counters remain stale or incomplete.  Before the first /run there is no owned
      // job whose queue state could be hidden, so startup may use the exact terminal inventory
      // proof below.  Every post-dispatch/post-drain caller remains health-first by default.
      if (mode === "health_first") await this.#jobs.confirmQuiescent(12, 250);
      this.checkAbort();
      let startupQueueProofReadCount = 0;
      const confirmStartupQueueEmpty = async (): Promise<void> => {
        if (mode === "startup_inventory_only") {
          await this.#jobs!.confirmStartupQueueEmpty();
          startupQueueProofReadCount += 1;
          return;
        }
        if (mode === "post_job_queue_only") {
          await this.#jobs!.confirmQueueEmptyReadOnly(12, 250);
          startupQueueProofReadCount += 1;
        }
      };
      const terminalStatuses = new Set(["EXITED", "TERMINATED"]);
      const readAndValidate = async (): Promise<{
        readonly inventory: RunPodInventory;
        readonly signature: string;
        readonly providerPodIdSha256: string | null;
        readonly providerIdentitySource: "terminal_pod_record" | null;
      }> => {
        // Bracket each inventory snapshot with an independent queue-only health read. Worker
        // counters can remain stale during FlashBoot startup, but a queued/in-progress job must
        // never be hidden by the terminal-record fallback.
        await confirmStartupQueueEmpty();
        const [inventory, resources] = await Promise.all([
          this.#options.control.inventory(),
          this.#options.control.inventoryDisposableResources(),
        ]);
        await confirmStartupQueueEmpty();
        this.assertRetainedMageVolume(inventory);
        const endpointInventory = inventory.endpoints[0];
        const endpointResource = resources.endpoints[0];
        const templateResource = resources.templates[0];
        const rawWorkers = Array.isArray(endpointResource?.raw.workers)
          ? endpointResource.raw.workers
          : null;
        const rawWorkerStatuses =
          rawWorkers === null
            ? null
            : rawWorkers.map((worker) => {
                const value = asRecord(worker);
                const desired =
                  typeof value?.desiredStatus === "string" ? value.desiredStatus : null;
                const current = typeof value?.status === "string" ? value.status : null;
                if (desired && current && desired !== current) return "CONFLICT";
                return desired ?? current ?? "UNKNOWN";
              });
        const rawWorkerIdentityHashes =
          rawWorkers === null ? null : rawWorkers.map((worker) => providerWorkerIdHash(worker));
        const terminalPodIdentityHashes = inventory.pods
          .filter(
            (pod) =>
              pod.endpointWorker &&
              pod.endpointIdHash === this.#endpoint!.idHash &&
              terminalStatuses.has(pod.desiredStatus) &&
              pod.observedStatuses.length > 0 &&
              pod.observedStatuses.every((status) => terminalStatuses.has(status)),
          )
          .map((pod) => pod.idHash);
        // The sealed worker signs RUNPOD_POD_ID on both receipt identity axes. RunPod's
        // endpoint workers[].id is a separate opaque namespace and can retain stale records, so
        // it is never used as receipt identity. Select exactly one terminal Pod matching the
        // signed Pod hash while retaining every worker and Pod record in the stable snapshot.
        const terminalPodIdentitySha256 =
          terminalPodIdentityHashes.length === 1 &&
          terminalPodIdentityHashes[0] === options.expectedProviderPodIdSha256
            ? terminalPodIdentityHashes[0]!
            : null;
        const providerIdentitySource =
          terminalPodIdentitySha256 === null ? null : ("terminal_pod_record" as const);
        const exactTerminalInventory =
          inventory.runningPodCount === 0 &&
          inventory.activeServerlessWorkerCount === 0 &&
          inventory.pods.every(
            (pod) =>
              pod.endpointWorker &&
              pod.endpointIdHash === this.#endpoint!.idHash &&
              terminalStatuses.has(pod.desiredStatus) &&
              pod.observedStatuses.length > 0 &&
              pod.observedStatuses.every((status) => terminalStatuses.has(status)),
          ) &&
          inventory.endpoints.length === 1 &&
          endpointInventory?.idHash === this.#endpoint!.idHash &&
          endpointInventory.workersMin === expectedPolicy.workersMin &&
          endpointInventory.workersMax === expectedPolicy.workersMax &&
          endpointInventory.workerRecordsReported &&
          endpointInventory.activeWorkerCount === 0 &&
          endpointInventory.workerRecordCount === endpointInventory.exitedWorkerCount &&
          endpointInventory.workerStatuses.every((status) => terminalStatuses.has(status)) &&
          inventory.privateTemplateCount === 1 &&
          resources.endpoints.length === 1 &&
          endpointResource?.id === this.#endpoint!.id &&
          resources.templates.length === 1 &&
          templateResource?.id === this.#template!.id &&
          templateResource !== undefined &&
          this.templateIdentityMatches(templateResource) &&
          endpointResource !== undefined &&
          rawWorkerStatuses !== null &&
          rawWorkerStatuses.length === endpointInventory?.workerRecordCount &&
          rawWorkerStatuses.every(
            (status, index) =>
              terminalStatuses.has(status) && status === endpointInventory.workerStatuses[index],
          ) &&
          this.endpointIdentityMatches(endpointResource, templateResource.id, expectedPolicy) &&
          endpointResource.raw.flashboot === V207_RUNPOD_FLASHBOOT;
        if (
          options.requireProviderPodIdentity &&
          (terminalPodIdentitySha256 === null ||
            options.expectedProviderPodIdSha256 === undefined ||
            terminalPodIdentitySha256 !== options.expectedProviderPodIdSha256 ||
            endpointInventory?.workerRecordCount !== 1)
        ) {
          throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
        }
        if (!exactTerminalInventory || !endpointInventory) {
          throw new RunPodControlError("RUNPOD_TERMINAL_SCALE_ZERO_NOT_CONFIRMED");
        }
        return {
          inventory,
          providerPodIdSha256: terminalPodIdentitySha256,
          providerIdentitySource,
          signature: canonicalizeJson({
            pods: inventory.pods.map((pod) => ({
              idHash: pod.idHash,
              endpointIdHash: pod.endpointIdHash,
              desiredStatus: pod.desiredStatus,
              observedStatuses: pod.observedStatuses,
            })),
            endpoint: {
              idHash: endpointInventory.idHash,
              workersMin: endpointInventory.workersMin,
              workersMax: endpointInventory.workersMax,
              workerStatuses: endpointInventory.workerStatuses,
              workerIdentityHashes: rawWorkerIdentityHashes,
            },
            endpointResourceIdHash: sha256(endpointResource.id),
            templateResourceIdHash: sha256(templateResource.id),
          }),
        };
      };
      const sleep =
        this.#options.sleep ??
        ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
      let prior: Awaited<ReturnType<typeof readAndValidate>> | null = null;
      let stable: Awaited<ReturnType<typeof readAndValidate>> | null = null;
      // Policy transitions can append terminal FlashBoot worker/Pod records for a few seconds.
      // Never dispatch through that churn: require two consecutive exact snapshots, but allow a
      // bounded stabilization window while queue reads remain independently zero throughout.
      for (let attempt = 0; attempt < 40; attempt += 1) {
        this.checkAbort();
        try {
          const current = await readAndValidate();
          if (prior?.signature === current.signature) {
            stable = current;
            break;
          }
          prior = current;
        } catch (error) {
          prior = null;
          if (
            !(error instanceof RunPodControlError) ||
            error.code !== "RUNPOD_TERMINAL_SCALE_ZERO_NOT_CONFIRMED" ||
            attempt === 39
          ) {
            throw error;
          }
        }
        await sleep(250);
      }
      if (stable === null) {
        throw new RunPodControlError("RUNPOD_TERMINAL_SCALE_ZERO_NOT_CONFIRMED");
      }
      const endpointInventory = stable.inventory.endpoints[0]!;
      this.#guard.confirmZero(0, 0);
      this.mark(event, {
        endpoint_id_hash: this.#endpoint.idHash,
        endpoint_worker_record_count: endpointInventory.workerRecordCount,
        terminal_pod_record_count: stable.inventory.pods.length,
        stable_terminal_snapshot_count: 2,
        ...(mode === "startup_inventory_only"
          ? {
              startup_health_proof: "fresh_endpoint_no_owned_job_inventory_only",
              startup_queue_proof_read_count: startupQueueProofReadCount,
            }
          : mode === "post_job_queue_only"
            ? {
                post_job_health_proof: "queue_empty_only_terminal_inventory",
                post_job_queue_proof_read_count: startupQueueProofReadCount,
              }
            : {}),
      });
      return {
        providerPodIdSha256: stable.providerPodIdSha256,
        providerIdentitySource: stable.providerIdentitySource,
        terminalWorkerRecordCount: endpointInventory.workerRecordCount,
        terminalPodRecordCount: stable.inventory.pods.length,
        terminalScaleZeroConfirmed: true,
      };
    } catch (error) {
      this.#guard.invalidate();
      throw error;
    }
  }

  /**
   * Recover a create mutation whose response was ambiguous. Only a unique, exact-name resource
   * with the complete intended identity may be drained/deleted; unknown or drifted resources are
   * deliberately left untouched and reported as uncertain.
   */
  private async reconcileAmbiguousCreate(): Promise<"ADOPTED" | "CLEANED"> {
    const endpointCreationAttempted = this.#template !== null;
    const resources: RunPodDisposableResourceInventory =
      await this.#options.control.inventoryDisposableResources();
    if (resources.templates.length > 1 || resources.endpoints.length > 1) {
      throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_AMBIGUOUS");
    }
    const template = resources.templates[0];
    const endpoint = resources.endpoints[0];
    if (!endpointCreationAttempted && endpoint) {
      throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_UNEXPECTED_ENDPOINT");
    }
    if (endpointCreationAttempted && !endpoint) {
      throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_ENDPOINT_MISSING");
    }
    if (!template || template.name !== this.#options.templateName) {
      throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_NAME_DRIFT");
    }
    if (!this.templateIdentityMatches(template)) {
      throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_IDENTITY_MISMATCH");
    }
    if (endpoint) {
      if (endpoint.name !== this.#options.endpointName) {
        throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_NAME_DRIFT");
      }
      if (!this.endpointIdentityMatches(endpoint, template.id)) {
        throw new RunPodControlError("RUNPOD_RESOURCE_RECONCILIATION_IDENTITY_MISMATCH");
      }
      this.#template = { id: template.id, idHash: sha256(template.id) };
      this.#endpoint = { id: endpoint.id, idHash: sha256(endpoint.id) };
      this.#guard.markActive();
      this.#jobs = new RunPodServerlessJobClient({
        apiKey: this.#options.apiKey,
        endpointId: endpoint.id,
        guard: this.#guard,
        fetch: this.#options.fetch,
        baseUrl: this.#options.baseUrl,
        sleep: this.#options.sleep,
      });
      await this.#jobs.confirmDrained();
      this.checkAbort();
      await this.#options.control.deleteEndpoint(endpoint.id, this.#guard);
      await this.#options.control.deleteTemplate(template.id);
      this.mark("ambiguous_create_resources_reconciled_and_deleted", {
        endpoint_id_hash: sha256(endpoint.id),
        template_id_hash: sha256(template.id),
      });
    } else {
      this.#template = { id: template.id, idHash: sha256(template.id) };
      await this.#options.control.deleteTemplate(template.id);
      this.mark("ambiguous_template_reconciled_and_deleted", {
        template_id_hash: sha256(template.id),
      });
    }
    this.#template = null;
    this.#endpoint = null;
    this.#jobs = null;
    return "CLEANED";
  }

  /** Bind the provider-allocated endpoint id into the exact worker environment before startup. */
  private async bindEndpointIdentity(): Promise<void> {
    if (!this.#template || !this.#endpoint) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_NOT_CREATED");
    }
    if (!this.#jobs) {
      this.#jobs = new RunPodServerlessJobClient({
        apiKey: this.#options.apiKey,
        endpointId: this.#endpoint.id,
        guard: this.#guard,
        fetch: this.#options.fetch,
        baseUrl: this.#options.baseUrl,
        sleep: this.#options.sleep,
      });
    }
    await this.#options.control.bindV207EndpointIdentity(
      this.#endpoint.id,
      this.#template.id,
      this.#options.initialPolicy,
      this.#options.placement,
      this.#options.templateEnvironment ?? {},
      this.#guard,
    );
    this.#endpointIdentityBound = true;
    this.mark("endpoint_identity_bound", {
      endpoint_id_hash: this.#endpoint.idHash,
    });
  }

  /** Establish the endpoint health baseline and immutable initial configuration hash. */
  private async initializeEndpointAfterCreate(): Promise<void> {
    if (!this.#template || !this.#endpoint) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_NOT_CREATED");
    }
    if (!this.#endpointIdentityBound) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_ID_BINDING_REQUIRED");
    }
    if (!this.#jobs) {
      this.#jobs = new RunPodServerlessJobClient({
        apiKey: this.#options.apiKey,
        endpointId: this.#endpoint!.id,
        guard: this.#guard,
        fetch: this.#options.fetch,
        baseUrl: this.#options.baseUrl,
        sleep: this.#options.sleep,
      });
    }
    // Endpoint creation is the first live provider state. Mark it active before accepting
    // the provider's ready-idle baseline; the drain guard otherwise rejects a valid baseline
    // as an impossible transition and waits forever for zero workers. This also reopens the
    // guard from the zero state after a previous exact policy transition.
    this.#guard.markActive();
    this.checkAbort();
    try {
      // RunPod can briefly expose a ready-idle worker at endpoint creation even with
      // workersMin=0. Capture that queue-empty baseline immediately; waiting for strict zero
      // first can let the provider recycle the worker back into throttled startup.
      await this.#jobs.confirmWarmIdle(300, 250);
      this.checkAbort();
      console.error("v207:harness-warm-idle");
      this.mark("provider_warm_idle_baseline");
    } catch (error) {
      if (
        !(error instanceof RunPodControlError) ||
        error.code !== "RUNPOD_WARM_IDLE_NOT_CONFIRMED"
      ) {
        throw error;
      }
      await this.confirmTerminalScaleZeroBaseline(
        this.#options.initialPolicy,
        "provider_terminal_worker_scale_zero_baseline",
        "startup_inventory_only",
      );
      this.checkAbort();
    }
    // Endpoint creation may briefly start a billed warm worker even with workersMin=0.
    // Re-read settled spend after the provider baseline before allowing any dispatch or
    // configuration transition to continue.
    await this.assertSpendWithinCap();
    this.#initialConfigHash = hashRunPodV207EndpointConfiguration(
      jsonValue({
        region: "EU-RO-1",
        computeType: "GPU",
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        gpuCount: 1,
        minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
        allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
        networkVolumeIdHash: sha256(this.#options.placement.networkVolumeId),
        networkVolumeSizeGb: V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
        networkVolumeRegion: V207_RUNPOD_REGION,
        workersMin: this.#options.initialPolicy.workersMin,
        workersMax: this.#options.initialPolicy.workersMax,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
        flashboot: V207_RUNPOD_FLASHBOOT,
        volumeMount: "/runpod-volume",
        idleTimeout: this.#options.initialPolicy.idleTimeout,
        executionTimeoutMs: this.#options.initialPolicy.executionTimeoutMs,
        containerDiskInGb: this.#options.containerDiskInGb,
        handlerConcurrency: V207_RUNPOD_HANDLER_CONCURRENCY,
        runpodInitTimeoutSeconds: V207_RUNPOD_INIT_TIMEOUT_SECONDS,
        requestAuthorityTtlSeconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
        templateEnvironment: this.#options.templateEnvironment ?? {},
        templateIdHash: this.#template!.idHash,
        endpointIdHash: this.#endpoint!.idHash,
        image: this.#options.imageName,
      }),
    );
    this.mark("endpoint_created_and_zero_confirmed", {
      endpoint_id_hash: this.#endpoint!.idHash,
      endpoint_config_sha256: this.#initialConfigHash,
    });
  }

  private async cleanupFailedCreate(error: unknown): Promise<never> {
    // A failed endpoint create can leave disposable resources. Never delete the retained model
    // volume here: it is intentionally outside this harness's mutation surface.
    let endpointCleanupComplete = this.#endpoint === null;
    if (this.#endpoint) {
      try {
        if (!this.#jobs) throw new RunPodControlError("RUNPOD_CLEANUP_UNCERTAIN");
        try {
          await this.#jobs.confirmDrained();
        } catch {
          await this.confirmTerminalScaleZeroBaseline(
            this.#options.initialPolicy,
            "failed_create_terminal_worker_scale_zero",
          );
        }
        await this.#options.control.deleteEndpoint(this.#endpoint.id, this.#guard);
        endpointCleanupComplete = true;
      } catch {
        endpointCleanupComplete = false;
        this.mark("endpoint_cleanup_uncertain");
      }
    }
    if (this.#template && endpointCleanupComplete) {
      try {
        await this.#options.control.deleteTemplate(this.#template.id);
      } catch {
        this.mark("template_cleanup_uncertain");
      }
    } else if (this.#template) {
      this.mark("template_cleanup_deferred_endpoint_uncertain");
    }
    throw error;
  }

  async create(): Promise<void> {
    if (this.#endpoint || this.#template) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_ALREADY_CREATED");
    }
    this.checkAbort();
    console.error("v207:harness-inventory");
    const inventory = await this.#options.control.inventory();
    this.assertRetainedMageVolume(inventory);
    if (
      inventory.runningPodCount !== 0 ||
      inventory.activeServerlessWorkerCount !== 0 ||
      inventory.pods.length !== 0 ||
      inventory.endpoints.length !== 0 ||
      inventory.privateTemplateCount !== 0
    ) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_ACCOUNT_NOT_ZERO");
    }
    this.#guard.confirmZero(0, 0);
    await this.assertSpendWithinCap();
    this.checkAbort();
    let mutationPhase: "template" | "endpoint" | "endpoint_identity" | "endpoint_health" =
      "template";
    try {
      mutationPhase = "template";
      this.#template = await this.#options.control.createServerlessTemplate(
        this.#options.templateName,
        this.#options.imageName,
        this.#options.containerDiskInGb,
        this.#options.templateEnvironment,
        true,
      );
      this.checkAbort();
      console.error("v207:harness-template-created");
      this.mark("template_created", { template_id_hash: this.#template!.idHash });
      mutationPhase = "endpoint";
      const endpointCreationLiability = this.infrastructureLiabilityUsd(1);
      await this.reservePaidLiability(endpointCreationLiability);
      this.#endpoint = await this.#options.control.createScaleZeroEndpoint(
        this.#options.endpointName,
        this.#template!.id,
        ["NVIDIA GeForce RTX 4090"],
        this.#options.initialPolicy,
        this.#options.placement,
        true,
      );
      this.#projectedSettledLiabilityUsd += endpointCreationLiability;
      this.#reservedInitCredits += 1;
      console.error("v207:harness-endpoint-created");
      mutationPhase = "endpoint_identity";
      await this.bindEndpointIdentity();
      this.checkAbort();
      mutationPhase = "endpoint_health";
      await this.initializeEndpointAfterCreate();
      this.checkAbort();
    } catch (error) {
      const needsResourceReconciliation =
        error instanceof RunPodControlError &&
        mutationPhase !== "endpoint_identity" &&
        mutationPhase !== "endpoint_health" &&
        [
          "RUNPOD_MUTATION_AMBIGUOUS",
          "RUNPOD_RESPONSE_INVALID",
          "RUNPOD_SCALE_ZERO_UNCONFIRMED",
        ].includes(error.code);
      if (needsResourceReconciliation) {
        try {
          const outcome = await this.reconcileAmbiguousCreate();
          if (outcome === "ADOPTED") {
            mutationPhase = "endpoint_identity";
            await this.bindEndpointIdentity();
            mutationPhase = "endpoint_health";
            await this.initializeEndpointAfterCreate();
            return;
          }
        } catch (reconciliationError) {
          if (
            reconciliationError instanceof RunPodControlError &&
            reconciliationError.code.startsWith("RUNPOD_ENDPOINT_ID_BINDING_")
          ) {
            return await this.cleanupFailedCreate(reconciliationError);
          }
          // A normalization/readback failure leaves #endpoint/#template populated so the caller's
          // failure cleanup can drain and delete exactly the attributable resources.
          this.mark("ambiguous_create_reconciliation_uncertain", {
            error_code:
              reconciliationError instanceof RunPodControlError
                ? reconciliationError.code
                : "RUNPOD_RESOURCE_RECONCILIATION_FAILED",
          });
          throw reconciliationError;
        }
        throw error;
      }
      return await this.cleanupFailedCreate(error);
    }
  }

  markInitialQualificationComplete(): void {
    this.assertCreated();
    if (this.#guard.snapshot() !== "warm_idle" && this.#guard.snapshot() !== "zero") {
      throw new RunPodControlError("RUNPOD_INITIAL_QUALIFICATION_NOT_DRAINED");
    }
    this.#initialQualificationComplete = true;
    this.mark("initial_max_one_qualification_complete");
  }

  async dispatchBatch(input: RunPodV207DispatchBatchInput): Promise<RunPodJobResult> {
    return this.dispatchBatchWithPolicy(input);
  }

  /**
   * The only bounded per-request policy path. RunPod accepts this top-level override for one job;
   * keep it out of ordinary dispatches so the approved endpoint's 2,400,000ms policy remains the
   * normal runtime and so the request-key replay hash includes the exact timeout policy.
   */
  async dispatchTimeoutBatch(input: RunPodV207DispatchBatchInput): Promise<RunPodJobResult> {
    return this.dispatchBatchWithPolicy(input, {
      executionTimeout: V207_TIMEOUT_EXECUTION_TIMEOUT_MS,
      ttl: V207_TIMEOUT_TTL_MS,
    });
  }

  private trackDispatchedJob(
    input: RunPodV207DispatchBatchInput,
    job: RunPodJobResult,
    client: RunPodServerlessJobClient,
    postJobWarmIdle = false,
  ): void {
    const previousRequest = this.#requestJobIds.get(input.requestKey);
    const previousJobId = previousRequest?.id;
    const previousRequestKey = this.#jobRequestKeys.get(job.id);
    if (
      previousRequest?.client === client &&
      previousJobId !== undefined &&
      previousJobId !== job.id
    ) {
      throw new RunPodControlError("RUNPOD_REQUEST_REPLAY_ID_DRIFT");
    }
    if (previousRequestKey !== undefined && previousRequestKey !== input.requestKey) {
      throw new RunPodControlError("RUNPOD_JOB_ID_REUSE");
    }
    this.#requestJobIds.set(input.requestKey, { id: job.id, client });
    this.#jobRequestKeys.set(job.id, input.requestKey);
    const replayedTerminalJob =
      previousRequest?.client === client &&
      previousJobId === job.id &&
      this.#terminalJobIds.has(job.id) &&
      !TERMINAL_STATUSES.has(job.status);
    if (TERMINAL_STATUSES.has(job.status)) {
      this.settleJobSpendLiability(job);
      this.#terminalJobIds.add(job.id);
      this.#ownedJobs.delete(job.id);
      if (this.#readerJobIds.has(job.id)) this.#terminalReaderResults.set(job.id, job);
      if (postJobWarmIdle) this.#postJobWarmIdlePending = true;
    } else if (replayedTerminalJob) {
      // The idempotent client returns the original /run result for an exact request-key replay.
      // The original job was already reconciled terminal, so do not resurrect it as owned work.
      this.#ownedJobs.delete(job.id);
      this.mark("duplicate_delivery_reconciled", {
        job_id_hash: job.idHash,
        replay_same_job: true,
        no_new_provider_dispatch: true,
        duplicate_compute: false,
      });
    } else {
      this.#ownedJobs.set(job.id, client);
    }
  }

  private async dispatchBatchWithPolicy(
    input: RunPodV207DispatchBatchInput,
    policy?: RunPodV207TimeoutPolicy,
  ): Promise<RunPodJobResult> {
    this.assertCreated();
    this.checkAbort();
    this.assertPrimaryDispatchAllowed();
    const request = buildDispatchRequest(input);
    const previousRequest = this.#requestJobIds.get(input.requestKey);
    if (previousRequest?.client === this.#jobs) {
      // The job client validates the exact request hash and returns its cached /run response.
      // This path cannot issue provider work, so charging it a second liability would make the
      // cost fence contradict the at-most-one delivery proof.
      const replay =
        policy === undefined
          ? await this.#jobs!.dispatch(input.requestKey, request)
          : await this.#jobs!.dispatchWithPolicy(input.requestKey, request, policy);
      this.trackDispatchedJob(input, replay, this.#jobs!, true);
      this.mark("job_dispatch_replay", {
        job_id_hash: replay.idHash,
        attempt_id: input.attemptId,
        no_new_provider_dispatch: true,
        no_new_spend_liability: true,
      });
      return replay;
    }
    const executionTimeoutMs = policy?.executionTimeout ?? V207_RUNPOD_EXECUTION_TIMEOUT_MS;
    const consumesInitCredit = this.#reservedInitCredits > 0;
    // `warm_idle` proves queue quiescence, not positive idle-worker capacity: RunPod may report
    // zero idle workers. Only an explicit initialization credit can waive startup liability.
    const initIncluded = !consumesInitCredit;
    const liability = this.workerLiabilityUsd(executionTimeoutMs, initIncluded);
    await this.reservePaidLiability(liability);
    if (consumesInitCredit) this.#reservedInitCredits -= 1;
    this.#pendingDispatchLiabilityUsd += liability;
    const dispatchStartedAtMs = this.monotonicNowMs();
    let job: RunPodJobResult;
    try {
      job =
        policy === undefined
          ? await this.#jobs!.dispatch(input.requestKey, request)
          : await this.#jobs!.dispatchWithPolicy(input.requestKey, request, policy);
    } catch (error) {
      this.#pendingDispatchLiabilityUsd -= liability;
      this.#projectedSettledLiabilityUsd += liability;
      this.#newPaidWorkFenced = true;
      throw error;
    }
    this.#pendingDispatchLiabilityUsd -= liability;
    this.#activeSpendLiabilitiesUsd.set(job.id, { usd: liability, initIncluded });
    if (dispatchStartedAtMs !== null && !this.#dispatchStartedAtMs.has(job.id)) {
      this.#dispatchStartedAtMs.set(job.id, dispatchStartedAtMs);
    }
    this.trackDispatchedJob(input, job, this.#jobs!, true);
    this.checkAbort();
    await this.assertSpendWithinCap();
    this.mark("job_dispatched", { job_id_hash: job.idHash, attempt_id: input.attemptId });
    return job;
  }

  async reconcile(jobId: string): Promise<RunPodJobResult> {
    this.assertCreated();
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const maxPolls = this.#options.maxPolls ?? 120;
    const sleep =
      this.#options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    let latest: RunPodJobResult | null = null;
    for (let poll = 0; poll < maxPolls; poll += 1) {
      this.checkAbort();
      await this.assertSpendWithinCap();
      latest = await this.#jobs!.status(jobId);
      this.mark("job_status", {
        job_id_hash: latest.idHash,
        status: latest.status,
        delay_time_ms: latest.delayTimeMs,
        execution_time_ms: latest.executionTimeMs,
        ...(latest.error === undefined ? {} : { provider_error_present: true }),
      });
      this.checkAbort();
      await this.#options.onStatusCheckpoint?.({
        idHash: latest.idHash,
        status: latest.status,
        delayTimeMs: latest.delayTimeMs,
        executionTimeMs: latest.executionTimeMs,
      });
      if (TERMINAL_STATUSES.has(latest.status)) {
        this.settleJobSpendLiability(latest);
        this.#ownedJobs.delete(jobId);
        this.#terminalJobIds.add(jobId);
        if (this.#readerJobIds.has(jobId)) this.#terminalReaderResults.set(jobId, latest);
        this.#postJobWarmIdlePending = true;
        return latest;
      }
      if (poll + 1 < maxPolls) await sleep(this.#options.pollIntervalMs ?? 15_000);
    }
    throw new RunPodControlError("RUNPOD_QUALIFICATION_RECONCILIATION_TIMEOUT");
  }

  /** Capture only the provider's bounded status tuple after a terminal failure. */
  async diagnostic(jobId: string): Promise<RunPodJobDiagnostic> {
    this.assertCreated();
    this.checkAbort();
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.#jobs!.diagnostic(jobId);
    this.mark("job_diagnostic", { job_id_hash: sha256(jobId), ...value });
    return value;
  }

  async confirmWarmIdle(): Promise<void> {
    this.assertCreated();
    this.checkAbort();
    if (this.#guard.snapshot() !== "active" && this.#guard.snapshot() !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_WARM_IDLE_NOT_ALLOWED");
    }
    try {
      await this.#jobs!.confirmWarmIdle(POST_JOB_WARM_IDLE_MAX_ATTEMPTS, 250);
    } catch (error) {
      if (
        !(error instanceof RunPodControlError) ||
        error.code !== "RUNPOD_WARM_IDLE_NOT_CONFIRMED"
      ) {
        throw error;
      }
      if (!this.#postJobWarmIdlePending) {
        throw error;
      }
      // After a completed owned job, RunPod can leave a stale throttled counter even when the
      // attributable worker and Pod are terminal.  Health-first quiescence plus the existing
      // exact two-snapshot terminal inventory proof may promote that state to zero.  A nonterminal,
      // mismatched, or unstable inventory remains fail-closed and invalidates dispatch.
      this.mark("post_job_warm_idle_fallback", {
        direct_error: error.code,
        fallback_reason: "post_job_direct_warm_idle_unconfirmed",
      });
      await this.confirmTerminalScaleZeroBaseline(
        this.#options.initialPolicy,
        "post_job_terminal_worker_scale_zero",
        "post_job_queue_only",
      );
      this.checkAbort();
      this.#postJobWarmIdlePending = false;
      return;
    }
    this.checkAbort();
    this.#postJobWarmIdlePending = false;
    this.mark("warm_idle_confirmed");
  }

  /**
   * Read-only queue proof for final success reconciliation. Unlike drain(), this does not
   * transition the endpoint guard or apply a provider policy; it only asks the owned job client
   * for the provider's bounded zero queued/in-progress counters.
   */
  async confirmQueueEmptyReadOnly(maxAttempts = 1, pollIntervalMs = 100): Promise<void> {
    this.assertCreated();
    this.checkAbort();
    await this.#jobs!.confirmQueueEmptyReadOnly(maxAttempts, pollIntervalMs);
  }

  /**
   * Fence a seed process before a replacement request can be submitted.  This is deliberately
   * stricter than the ordinary warm-idle transition: the seed job must already be terminal,
   * the queue must be independently empty, and the exact signed RUNPOD_POD_ID must appear once
   * among the terminal Pod records in two stable snapshots. Endpoint workers[].id belongs to a
   * different provider namespace, so stale, null, or mismatched worker IDs are retained as
   * inventory facts but never treated as receipt identity. Missing or ambiguous signed Pod
   * identity still fails before another request can be submitted.
   */
  async prepareProcessReplacement(
    seedJobId: string,
    seedIdentity: RunPodV207WorkerProcessIdentity,
  ): Promise<RunPodV207ProcessReplacementBoundary> {
    this.assertCreated();
    this.checkAbort();
    if (!ID.test(seedJobId) || !this.#terminalJobIds.has(seedJobId)) {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_SEED_NOT_TERMINAL");
    }
    if (
      seedIdentity.schema_version !== "videoforge-v207-worker-process-identity/v1" ||
      !SHA256.test(seedIdentity.worker_id_sha256) ||
      !SHA256.test(seedIdentity.pod_id_sha256) ||
      seedIdentity.worker_id_sha256 !== seedIdentity.pod_id_sha256
    ) {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
    }
    if (this.#ownedJobs.size !== 0 || this.#concurrentReaderFence) {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_SEED_NOT_TERMINAL");
    }
    if (this.#guard.snapshot() === "active" || this.#guard.snapshot() === "warm_idle") {
      this.#guard.beginDrain();
    } else {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_DRAIN_STATE_INVALID");
    }
    await this.assertSpendWithinCap();
    const terminal = await this.confirmTerminalScaleZeroBaseline(
      this.#options.initialPolicy,
      "process_replacement_seed_terminal_worker_scale_zero",
      "post_job_queue_only",
      {
        requireProviderPodIdentity: true,
        expectedProviderPodIdSha256: seedIdentity.pod_id_sha256,
      },
    );
    if (
      terminal.providerPodIdSha256 === null ||
      terminal.providerIdentitySource === null ||
      terminal.providerPodIdSha256 !== seedIdentity.pod_id_sha256 ||
      terminal.terminalWorkerRecordCount !== 1 ||
      terminal.terminalPodRecordCount !== 1
    ) {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE");
    }
    this.#postJobWarmIdlePending = false;
    const boundary: RunPodV207ProcessReplacementBoundary = {
      schema_version: "videoforge-v207-process-replacement-boundary/v1",
      seed_job_id_sha256: sha256(seedJobId),
      seed_worker_id_sha256: seedIdentity.worker_id_sha256,
      seed_pod_id_sha256: seedIdentity.pod_id_sha256,
      terminal_provider_pod_id_sha256: terminal.providerPodIdSha256,
      terminal_provider_identity_source: terminal.providerIdentitySource,
      terminal_worker_record_count: terminal.terminalWorkerRecordCount,
      terminal_pod_record_count: terminal.terminalPodRecordCount,
      terminal_scale_zero_confirmed: true,
    };
    this.mark("process_replacement_seed_drained", {
      seed_job_id_hash: boundary.seed_job_id_sha256,
      seed_worker_id_sha256: boundary.seed_worker_id_sha256,
      seed_pod_id_sha256: boundary.seed_pod_id_sha256,
      terminal_provider_pod_id_sha256: boundary.terminal_provider_pod_id_sha256,
      terminal_provider_identity_source: boundary.terminal_provider_identity_source,
      terminal_worker_record_count: boundary.terminal_worker_record_count,
      terminal_pod_record_count: boundary.terminal_pod_record_count,
      terminal_scale_zero_confirmed: true,
    });
    return boundary;
  }

  /** Require the replacement's signed runtime identity to differ on both worker and pod axes. */
  assertProcessReplacementIdentity(
    boundary: RunPodV207ProcessReplacementBoundary,
    replacementIdentity: RunPodV207WorkerProcessIdentity,
  ): void {
    if (
      boundary.schema_version !== "videoforge-v207-process-replacement-boundary/v1" ||
      boundary.terminal_scale_zero_confirmed !== true ||
      !SHA256.test(boundary.seed_worker_id_sha256) ||
      !SHA256.test(boundary.seed_pod_id_sha256) ||
      !SHA256.test(boundary.terminal_provider_pod_id_sha256) ||
      boundary.seed_worker_id_sha256 !== boundary.seed_pod_id_sha256 ||
      boundary.terminal_provider_pod_id_sha256 !== boundary.seed_pod_id_sha256 ||
      boundary.terminal_provider_identity_source !== "terminal_pod_record" ||
      !Number.isSafeInteger(boundary.terminal_worker_record_count) ||
      boundary.terminal_worker_record_count !== 1 ||
      !Number.isSafeInteger(boundary.terminal_pod_record_count) ||
      boundary.terminal_pod_record_count !== 1 ||
      replacementIdentity.schema_version !== "videoforge-v207-worker-process-identity/v1" ||
      !SHA256.test(replacementIdentity.worker_id_sha256) ||
      !SHA256.test(replacementIdentity.pod_id_sha256) ||
      replacementIdentity.worker_id_sha256 !== replacementIdentity.pod_id_sha256 ||
      replacementIdentity.worker_id_sha256 === boundary.seed_worker_id_sha256 ||
      replacementIdentity.pod_id_sha256 === boundary.seed_pod_id_sha256
    ) {
      throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT");
    }
    this.mark("process_replacement_identity_distinct", {
      seed_worker_id_sha256: boundary.seed_worker_id_sha256,
      seed_pod_id_sha256: boundary.seed_pod_id_sha256,
      replacement_worker_id_sha256: replacementIdentity.worker_id_sha256,
      replacement_pod_id_sha256: replacementIdentity.pod_id_sha256,
      distinct_worker_identity: true,
      distinct_process_identity: true,
    });
  }

  async cancel(jobId: string): Promise<RunPodJobResult> {
    this.assertCreated();
    this.checkAbort();
    if (this.#concurrentReaderFence) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    }
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    if (this.#guard.snapshot() === "active" || this.#guard.snapshot() === "warm_idle") {
      this.#guard.beginDrain();
    }
    const result = await this.#jobs!.cancel(jobId);
    if (result.status === "CANCELLED") {
      this.settleJobSpendLiability(result);
      this.#ownedJobs.delete(jobId);
      this.#terminalJobIds.add(jobId);
      if (this.#readerJobIds.has(jobId)) this.#terminalReaderResults.set(jobId, result);
    }
    this.mark("job_cancelled", { job_id_hash: result.idHash });
    return result;
  }

  async applyConcurrentReaderPolicy(): Promise<string> {
    this.assertCreated();
    this.checkAbort();
    if (
      this.#concurrentReaderFence ||
      this.#concurrentReaderDispatchClaimed ||
      this.#readerJobs.length > 0
    ) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    }
    if (!this.#initialQualificationComplete) {
      throw new RunPodControlError("RUNPOD_INITIAL_QUALIFICATION_REQUIRED");
    }
    // The max-two endpoint is a distinct proof phase. Claim the primary fence before the first
    // asynchronous health/cap read and keep it until drain proves both reader clients are gone.
    this.#concurrentReaderFence = true;
    if (this.#guard.snapshot() === "active") {
      try {
        await this.#jobs!.confirmWarmIdle();
      } catch (error) {
        if (
          !(error instanceof RunPodControlError) ||
          error.code !== "RUNPOD_WARM_IDLE_NOT_CONFIRMED"
        ) {
          throw error;
        }
        try {
          await this.confirmTerminalScaleZeroBaseline(
            this.#options.initialPolicy,
            "pre_concurrent_policy_terminal_worker_scale_zero",
          );
        } catch {
          throw new RunPodControlError("RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED");
        }
      }
    }
    if (this.#guard.snapshot() !== "warm_idle" && this.#guard.snapshot() !== "zero") {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED");
    }
    const policyLiability = this.infrastructureLiabilityUsd(2);
    await this.reservePaidLiability(policyLiability);
    await this.#options.control.enforceV207EndpointPolicy(
      this.#endpoint!.id,
      this.#template!.id,
      this.#options.concurrentReaderPolicy,
      this.#options.placement,
      this.#guard,
    );
    this.#projectedSettledLiabilityUsd += policyLiability;
    this.#reservedInitCredits += 2;
    this.checkAbort();
    await this.assertSpendWithinCap();
    this.#guard.markActive();
    try {
      await this.#jobs!.confirmWarmIdle();
    } catch (error) {
      if (
        !(error instanceof RunPodControlError) ||
        error.code !== "RUNPOD_WARM_IDLE_NOT_CONFIRMED"
      ) {
        throw error;
      }
      try {
        await this.confirmTerminalScaleZeroBaseline(
          this.#options.concurrentReaderPolicy,
          "concurrent_reader_terminal_worker_scale_zero_baseline",
          "post_job_queue_only",
        );
      } catch {
        throw new RunPodControlError("RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED");
      }
    }
    this.checkAbort();
    this.mark("concurrent_reader_warm_idle_baseline");
    this.#concurrentReaderConfigHash = hashRunPodV207EndpointConfiguration(
      jsonValue({
        region: "EU-RO-1",
        computeType: "GPU",
        gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
        gpuCount: 1,
        minCudaVersion: V207_RUNPOD_MIN_CUDA_VERSION,
        allowedCudaVersions: [V207_RUNPOD_MIN_CUDA_VERSION],
        networkVolumeIdHash: sha256(this.#options.placement.networkVolumeId),
        networkVolumeSizeGb: V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
        networkVolumeRegion: V207_RUNPOD_REGION,
        workersMin: this.#options.concurrentReaderPolicy.workersMin,
        workersMax: this.#options.concurrentReaderPolicy.workersMax,
        scalerType: "REQUEST_COUNT",
        scalerValue: 1,
        flashboot: V207_RUNPOD_FLASHBOOT,
        volumeMount: "/runpod-volume",
        idleTimeout: this.#options.concurrentReaderPolicy.idleTimeout,
        executionTimeoutMs: this.#options.concurrentReaderPolicy.executionTimeoutMs,
        containerDiskInGb: this.#options.containerDiskInGb,
        handlerConcurrency: V207_RUNPOD_HANDLER_CONCURRENCY,
        runpodInitTimeoutSeconds: V207_RUNPOD_INIT_TIMEOUT_SECONDS,
        requestAuthorityTtlSeconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
        templateEnvironment: this.#options.templateEnvironment ?? {},
        templateIdHash: this.#template!.idHash,
        image: this.#options.imageName,
        endpointIdHash: this.#endpoint!.idHash,
      }),
    );
    this.mark("concurrent_reader_max_two_policy_applied", {
      endpoint_id_hash: this.#endpoint!.idHash,
      endpoint_config_sha256: this.#concurrentReaderConfigHash,
    });
    return this.#concurrentReaderConfigHash;
  }

  /**
   * Dispatches two independently guarded jobs. The separate guards are intentional: the normal
   * one-reader guard must continue to reject a second delivery, while this method is reachable
   * only after the separately hashed max-two endpoint policy has been applied.
   */
  async dispatchConcurrentReaders(
    inputs: readonly [RunPodV207DispatchBatchInput, RunPodV207DispatchBatchInput],
  ): Promise<readonly [RunPodJobResult, RunPodJobResult]> {
    this.assertCreated();
    this.checkAbort();
    if (inputs.length !== 2) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_INPUT_INVALID");
    }
    if (!this.#concurrentReaderConfigHash) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_POLICY_REQUIRED");
    }
    if (this.#concurrentReaderDispatchClaimed || this.#readerJobs.length > 0) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    }
    if (!this.#concurrentReaderFence) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_POLICY_REQUIRED");
    }
    if (this.#guard.snapshot() !== "warm_idle" && this.#guard.snapshot() !== "zero") {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED");
    }
    // Fully validate both inputs before claiming the dispatch or constructing either client. This
    // prevents one malformed reader from allowing its sibling to reach /run first.
    const requests: readonly [JsonValue, JsonValue] = [
      buildDispatchRequest(inputs[0]),
      buildDispatchRequest(inputs[1]),
    ];
    this.checkAbort();
    // Claim the one allowed reader dispatch before the first asynchronous cap read. This keeps a
    // third caller out during preflight; the primary fence remains until drain proves zero.
    this.#concurrentReaderDispatchClaimed = true;
    // Reserve both workers atomically before either /run request. Exact max-two policy init
    // credits are consumed once; any missing credit is charged here along with both execution,
    // idle, and asynchronous-metering margins.
    const availableInitCredits = Math.min(this.#reservedInitCredits, 2);
    const uncertainInitCount = 2 - availableInitCredits;
    const perReaderRuntimeLiability = this.workerLiabilityUsd(
      V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      false,
    );
    const readerLiability =
      perReaderRuntimeLiability * 2 + this.infrastructureLiabilityUsd(uncertainInitCount);
    try {
      await this.reservePaidLiability(readerLiability);
      this.#reservedInitCredits -= availableInitCredits;
      this.#pendingDispatchLiabilityUsd += readerLiability;
    } catch (error) {
      this.#concurrentReaderDispatchClaimed = false;
      throw error;
    }
    const clients = inputs.map(() => {
      const guard = new RunPodDrainGuard();
      guard.confirmZero(0, 0);
      const client = new RunPodServerlessJobClient({
        apiKey: this.#options.apiKey,
        endpointId: this.#endpoint!.id,
        guard,
        fetch: this.#options.fetch,
        baseUrl: this.#options.baseUrl,
        sleep: this.#options.sleep,
      });
      this.#readerJobs.push(client);
      return client;
    }) as [RunPodServerlessJobClient, RunPodServerlessJobClient];
    let results: [RunPodJobResult, RunPodJobResult];
    try {
      results = (await Promise.all(
        inputs.map((input, index) => {
          const request = requests[index]!;
          return clients[index]!.dispatch(input.requestKey, request).then((job) => {
            const includesInit = index >= availableInitCredits && uncertainInitCount > 0;
            const perReaderLiability =
              perReaderRuntimeLiability + (includesInit ? this.infrastructureLiabilityUsd(1) : 0);
            this.#pendingDispatchLiabilityUsd -= perReaderLiability;
            this.#activeSpendLiabilitiesUsd.set(job.id, {
              usd: perReaderLiability,
              initIncluded: includesInit,
            });
            this.#readerJobIds.add(job.id);
            this.#readerJobOrder[index] = job.id;
            this.#readerInputs.set(job.id, input);
            this.trackDispatchedJob(input, job, clients[index]!);
            return job;
          });
        }),
      )) as [RunPodJobResult, RunPodJobResult];
      this.#pendingDispatchLiabilityUsd = 0;
    } catch (error) {
      // Preserve any unassigned half of the reservation: a failed /run response is ambiguous.
      this.#projectedSettledLiabilityUsd += this.#pendingDispatchLiabilityUsd;
      this.#pendingDispatchLiabilityUsd = 0;
      this.#newPaidWorkFenced = true;
      throw error;
    }
    this.checkAbort();
    await this.assertSpendWithinCap();
    const first = results[0]!;
    const second = results[1]!;
    this.#guard.markActive();
    this.mark("two_concurrent_readers_dispatched", {
      job_id_hashes: [first.idHash, second.idHash],
    });
    return [first, second];
  }

  async reconcileConcurrentReaders(
    jobIds: readonly [string, string],
    verify?: RunPodV207ConcurrentReaderVerifier,
  ): Promise<readonly [RunPodJobResult, RunPodJobResult]> {
    this.assertCreated();
    if (
      !this.#concurrentReaderConfigHash ||
      !this.#concurrentReaderFence ||
      this.#readerJobs.length < 2
    ) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_POLICY_REQUIRED");
    }
    if (jobIds.some((jobId) => !ID.test(jobId))) {
      throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    }
    this.assertExactConcurrentReaderJobs(jobIds);
    await this.assertSpendWithinCap();
    await this.assertSpendWithinCap();
    const maxPolls = this.#options.maxPolls ?? 120;
    const sleep =
      this.#options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const reconcile = async (client: RunPodServerlessJobClient, jobId: string) => {
      let latest: RunPodJobResult | null = null;
      for (let poll = 0; poll < maxPolls; poll += 1) {
        this.checkAbort();
        await this.assertSpendWithinCap();
        latest = await client.status(jobId);
        this.mark("concurrent_reader_job_status", {
          job_id_hash: latest.idHash,
          status: latest.status,
          delay_time_ms: latest.delayTimeMs,
          execution_time_ms: latest.executionTimeMs,
          ...(latest.error === undefined ? {} : { provider_error_present: true }),
        });
        this.checkAbort();
        await this.#options.onStatusCheckpoint?.({
          idHash: latest.idHash,
          status: latest.status,
          delayTimeMs: latest.delayTimeMs,
          executionTimeMs: latest.executionTimeMs,
        });
        if (TERMINAL_STATUSES.has(latest.status)) {
          this.settleJobSpendLiability(latest);
          this.#ownedJobs.delete(jobId);
          this.#terminalJobIds.add(jobId);
          this.#terminalReaderResults.set(jobId, latest);
          return latest;
        }
        if (poll + 1 < maxPolls) await sleep(this.#options.pollIntervalMs ?? 15_000);
      }
      throw new RunPodControlError("RUNPOD_QUALIFICATION_RECONCILIATION_TIMEOUT");
    };
    // Join both ordinary pollers before deciding whether recovery is needed. Promise.all would
    // reject on the first timeout and leave the sibling poller running concurrently with recovery,
    // allowing late status/checkpoint writes after the one-shot recovery phase had started.
    const settled = await Promise.allSettled([
      reconcile(this.#readerJobs[0]!, jobIds[0]),
      reconcile(this.#readerJobs[1]!, jobIds[1]),
    ]);
    const failures = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      const nonTimeout = failures.find(
        ({ reason }) =>
          !(reason instanceof RunPodControlError) ||
          reason.code !== "RUNPOD_QUALIFICATION_RECONCILIATION_TIMEOUT",
      );
      if (nonTimeout !== undefined) throw nonTimeout.reason;
      this.#concurrentReaderRecoveryArmed = true;
      this.mark("concurrent_reader_terminal_recovery_armed", {
        reason: "ordinary_reconciliation_timeout",
        job_id_hashes: this.#readerJobOrder.map((jobId) => sha256(jobId)),
      });
      try {
        // The qualification runner intentionally has one reconciliation call site. A timeout
        // therefore enters this one bounded exact-ID recovery automatically; it cannot issue a
        // new /run and returns completed results for the caller's full output/readback/receipt
        // verifier when the provider settles just after the ordinary window.
        return await this.recoverConcurrentReadersAfterTimeout(jobIds, verify);
      } catch (recoveryError) {
        this.mark("concurrent_reader_terminal_recovery_failed", {
          error:
            recoveryError instanceof RunPodControlError
              ? recoveryError.code
              : "RUNPOD_CONCURRENT_READER_RECOVERY_FAILED",
        });
        throw recoveryError;
      }
    }
    if (settled[0].status !== "fulfilled" || settled[1].status !== "fulfilled") {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_RECONCILIATION_INVALID");
    }
    const results = [settled[0].value, settled[1].value] as const;
    await this.assertSpendWithinCap();
    return [results[0]!, results[1]!];
  }

  /**
   * Bounded recovery for a reader pair whose ordinary reconciliation timed out.  This method is
   * intentionally status-only: it accepts only the exact dispatch-order job tuple, never calls
   * `/run`, and returns the same ordered results the caller uses for output/readback/receipt
   * verification.  If both jobs do not become COMPLETED within the bounded window, owned work is
   * cancelled and the method fails closed.
   */
  async recoverConcurrentReadersAfterTimeout(
    jobIds: readonly [string, string],
    verify?: RunPodV207ConcurrentReaderVerifier,
  ): Promise<readonly [RunPodJobResult, RunPodJobResult]> {
    this.assertCreated();
    if (
      !this.#concurrentReaderConfigHash ||
      !this.#concurrentReaderFence ||
      this.#readerJobs.length < 2
    ) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_POLICY_REQUIRED");
    }
    if (jobIds.some((jobId) => !ID.test(jobId))) {
      throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    }
    this.assertExactConcurrentReaderJobs(jobIds);
    if (!this.#concurrentReaderRecoveryArmed) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_RECOVERY_NOT_ARMED");
    }
    // Consume the one recovery phase before any status read. A caller cannot extend the window
    // or replay it with a different tuple after a cancellation/verification failure.
    this.#concurrentReaderRecoveryArmed = false;
    const maxPolls = this.#options.maxPolls ?? 120;
    const sleep =
      this.#options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const recovered = new Map<string, RunPodJobResult>();
    for (const jobId of this.#readerJobOrder) {
      const terminal = this.#terminalReaderResults.get(jobId);
      if (terminal !== undefined) recovered.set(jobId, terminal);
    }
    const readReader = async (index: 0 | 1, jobId: string): Promise<RunPodJobResult> => {
      const existing = recovered.get(jobId);
      if (existing !== undefined) return existing;
      const latest = await this.#readerJobs[index]!.status(jobId);
      this.mark("concurrent_reader_terminal_recovery_status", {
        job_id_hash: latest.idHash,
        status: latest.status,
        delay_time_ms: latest.delayTimeMs,
        execution_time_ms: latest.executionTimeMs,
        ...(latest.error === undefined ? {} : { provider_error_present: true }),
      });
      await this.#options.onStatusCheckpoint?.({
        idHash: latest.idHash,
        status: latest.status,
        delayTimeMs: latest.delayTimeMs,
        executionTimeMs: latest.executionTimeMs,
      });
      if (TERMINAL_STATUSES.has(latest.status)) {
        this.settleJobSpendLiability(latest);
        this.#ownedJobs.delete(jobId);
        this.#terminalJobIds.add(jobId);
        this.#terminalReaderResults.set(jobId, latest);
        recovered.set(jobId, latest);
      }
      return latest;
    };
    try {
      for (let poll = 0; poll < maxPolls; poll += 1) {
        this.checkAbort();
        await this.assertSpendWithinCap();
        const first = await readReader(0, jobIds[0]);
        const second = await readReader(1, jobIds[1]);
        if (first.status === "COMPLETED" && second.status === "COMPLETED") {
          const results = [first, second] as const;
          if (
            results[0].id !== this.#readerJobOrder[0] ||
            results[1].id !== this.#readerJobOrder[1]
          ) {
            throw new RunPodControlError("RUNPOD_CONCURRENT_READER_OUTPUT_ORDER_INVALID");
          }
          const inputs = [
            this.#readerInputs.get(this.#readerJobOrder[0]),
            this.#readerInputs.get(this.#readerJobOrder[1]),
          ] as const;
          if (!inputs[0] || !inputs[1]) {
            throw new RunPodControlError("RUNPOD_CONCURRENT_READER_INPUT_LEDGER_INVALID");
          }
          // The live runner verifies output bytes/readbacks/receipts immediately after this
          // method returns.  Direct callers may opt into the harness-level ordering fence by
          // supplying a verifier; the status-only automatic recovery must still return the exact
          // completed results so the runner can perform its full application check.
          if (verify) {
            assertConcurrentReaderOutputOrder(results[0], inputs[0]);
            assertConcurrentReaderOutputOrder(results[1], inputs[1]);
          }
          if (verify) await verify(results, [inputs[0], inputs[1]]);
          await this.assertSpendWithinCap();
          this.mark("concurrent_reader_terminal_recovery_completed", {
            job_id_hashes: results.map((result) => result.idHash),
            output_verifier_run: verify !== undefined,
          });
          return results;
        }
        if (TERMINAL_STATUSES.has(first.status) || TERMINAL_STATUSES.has(second.status)) {
          throw new RunPodControlError("RUNPOD_CONCURRENT_READER_COMPLETION_UNCONFIRMED");
        }
        if (poll + 1 < maxPolls) await sleep(this.#options.pollIntervalMs ?? 15_000);
      }
    } catch (error) {
      if (
        error instanceof RunPodControlError &&
        error.code === "RUNPOD_CONCURRENT_READER_COMPLETION_UNCONFIRMED"
      ) {
        try {
          await this.cancelOwnedJobs();
        } catch {
          throw new RunPodControlError("RUNPOD_CONCURRENT_READER_RECOVERY_CLEANUP_UNCERTAIN");
        }
      }
      throw error;
    }
    try {
      await this.cancelOwnedJobs();
    } catch {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_RECOVERY_CLEANUP_UNCERTAIN");
    }
    throw new RunPodControlError("RUNPOD_CONCURRENT_READER_RECOVERY_UNCONFIRMED");
  }

  private assertExactConcurrentReaderJobs(jobIds: readonly [string, string]): void {
    if (
      this.#readerJobIds.size !== 2 ||
      this.#readerJobOrder.length !== 2 ||
      jobIds[0] !== this.#readerJobOrder[0] ||
      jobIds[1] !== this.#readerJobOrder[1] ||
      !this.#readerJobIds.has(jobIds[0]) ||
      !this.#readerJobIds.has(jobIds[1])
    ) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_JOB_ID_MISMATCH");
    }
  }

  async drain(): Promise<void> {
    this.assertCreated();
    if (this.#guard.snapshot() === "active" || this.#guard.snapshot() === "warm_idle") {
      this.#guard.beginDrain();
      await this.#jobs!.confirmQueueEmpty();
    }
    for (const reader of this.#readerJobs) {
      try {
        await reader.confirmDrained();
      } catch {
        this.mark("concurrent_reader_drain_uncertain");
        try {
          if (
            this.#readerJobIds.size !== 2 ||
            this.#ownedJobs.size !== 0 ||
            [...this.#readerJobIds].some((jobId) => !this.#terminalJobIds.has(jobId))
          ) {
            throw new RunPodControlError("RUNPOD_CONCURRENT_READER_TERMINAL_STATUS_UNCONFIRMED");
          }
          // Max-two FlashBoot health may retain throttled=2 after both reader jobs are terminal.
          // Do not apply the one-worker quiescence limit here. Instead require independently
          // empty queue reads around two matching exact terminal endpoint/worker/Pod snapshots.
          await this.confirmTerminalScaleZeroBaseline(
            this.#options.concurrentReaderPolicy,
            "concurrent_reader_terminal_worker_drain_confirmed",
            "post_job_queue_only",
          );
          break;
        } catch {
          throw new RunPodControlError("RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN");
        }
      }
    }
    if (this.#pendingCancelledLiabilities.size > 0) {
      try {
        // A terminal CANCELLED status can precede actual worker shutdown. Require two separate,
        // exact endpoint health reads with both queue and every worker counter at zero before
        // using elapsed time to narrow its reservation.
        await this.#jobs!.confirmDrained(1);
        const stableReadSleep =
          this.#options.sleep ??
          ((milliseconds: number) =>
            new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
        await stableReadSleep(100);
        await this.#jobs!.confirmDrained(1);
        this.settleCancelledLiabilitiesAfterStableZero();
      } catch (error) {
        this.#newPaidWorkFenced = true;
        this.mark("cancel_liability_retained_drain_uncertain", {
          pending_cancel_count: this.#pendingCancelledLiabilities.size,
          no_new_paid_action: true,
        });
        throw error;
      }
    }
    if (this.#guard.snapshot() !== "zero") {
      try {
        await this.#jobs!.confirmDrained();
      } catch {
        const expectedPolicy = this.#concurrentReaderConfigHash
          ? this.#options.concurrentReaderPolicy
          : this.#options.initialPolicy;
        await this.confirmTerminalScaleZeroBaseline(
          expectedPolicy,
          "provider_terminal_worker_drain_confirmed",
        );
      }
    }
    this.#readerJobs.length = 0;
    this.#readerJobIds.clear();
    this.#readerJobOrder.length = 0;
    this.#readerInputs.clear();
    this.#terminalReaderResults.clear();
    this.#concurrentReaderRecoveryArmed = false;
    this.#concurrentReaderDispatchClaimed = false;
    this.#concurrentReaderFence = false;
    this.mark("workers_zero_confirmed");
  }

  async scaleDownToInitial(): Promise<void> {
    this.assertCreated();
    this.checkAbort();
    await this.drain();
    await this.assertSpendWithinCap();
    await this.#options.control.enforceV207EndpointPolicy(
      this.#endpoint!.id,
      this.#template!.id,
      this.#options.initialPolicy,
      this.#options.placement,
      this.#guard,
    );
    this.checkAbort();
    this.mark("scaled_down_to_max_one");
  }

  /** Retains endpoint/template/volumes by default; deletes only disposable resources on failure. */
  async cleanup(options: {
    readonly deleteIfFailed: boolean;
    readonly failed: boolean;
  }): Promise<void> {
    if (!this.#endpoint || !this.#jobs || !this.#template) return;
    try {
      await this.cancelOwnedJobs();
    } catch {
      this.mark("cleanup_owned_job_uncertain");
      return;
    }
    if (
      this.#readerJobs.length > 0 ||
      this.#ownedJobs.size > 0 ||
      ["unknown", "active", "warm_idle", "draining", "queue_empty"].includes(this.#guard.snapshot())
    ) {
      try {
        await this.drain();
      } catch {
        this.mark("cleanup_drain_uncertain");
        return;
      }
    }
    if (!options.deleteIfFailed || !options.failed) {
      this.mark("resources_retained_after_drain", { endpoint_id_hash: this.#endpoint!.idHash });
      return;
    }
    try {
      await this.#options.control.deleteEndpoint(this.#endpoint!.id, this.#guard);
      await this.#options.control.deleteTemplate(this.#template!.id);
      this.mark("disposable_endpoint_and_template_deleted");
    } catch {
      this.mark("cleanup_delete_uncertain");
      throw new RunPodControlError("RUNPOD_CLEANUP_UNCERTAIN");
    }
  }

  async evidence(): Promise<RunPodV207HarnessEvidence> {
    let spend: number | null = null;
    try {
      spend = await this.#options.spendSnapshotUsd();
    } catch {
      spend = null;
    }
    return Object.freeze({
      schemaVersion: "videoforge.v2-07-qualification-harness/v1",
      templateIdHash: this.#template?.idHash ?? null,
      endpointIdHash: this.#endpoint?.idHash ?? null,
      initialConfigHash: this.#initialConfigHash,
      concurrentReaderConfigHash: this.#concurrentReaderConfigHash,
      retainedVolumeIdHash: sha256(this.#options.placement.networkVolumeId),
      imageDigest: this.#options.imageName.slice(this.#options.imageName.indexOf("@") + 1),
      events: Object.freeze(this.#events.map((event) => redactRunPodEvidence(event))),
      measuredSpendUsd: spend,
      projectedSpendUsd:
        spend === null
          ? null
          : Math.max(spend, this.#projectedSettledLiabilityUsd) +
            this.activeSpendLiabilityUsd() +
            this.#pendingDispatchLiabilityUsd,
      activeWorstCaseLiabilityUsd:
        this.activeSpendLiabilityUsd() + this.#pendingDispatchLiabilityUsd,
      newPaidWorkFenced: this.#newPaidWorkFenced,
      gpuHourlyRateUsd: V207_RUNPOD_GPU_HOURLY_RATE_USD,
      billingLagMarginSeconds: V207_RUNPOD_BILLING_LAG_MARGIN_SECONDS,
    });
  }
}

/** Redacts credentials, capability handles, signed URLs, and raw provider IDs from evidence. */
export function redactRunPodEvidence(value: unknown): RecordValue {
  const visit = (candidate: unknown, depth: number): unknown => {
    if (depth > 8) return "[REDACTED_DEPTH]";
    if (typeof candidate === "string") {
      if (/^https?:\/\//u.test(candidate)) return "[REDACTED_URL]";
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map((entry) => visit(entry, depth + 1));
    const object = asRecord(candidate);
    if (!object) return candidate;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(object)) {
      if (
        /(?:api[_-]?key|authorization|password|secret|cookie|capability|signature|token)/iu.test(
          key,
        )
      ) {
        output[key] = "[REDACTED]";
      } else if (/(?:^|_)(?:id|job|endpoint|template|volume|reservation)_hash$/iu.test(key)) {
        output[key] = entry;
      } else {
        output[key] = visit(entry, depth + 1);
      }
    }
    return output;
  };
  const result = visit(value, 0);
  return (asRecord(result) ?? { value: result }) as RecordValue;
}
