import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSujalRunPodApiKeyFromKeychain, SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import {
  RunPodControlClient,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_FLASHBOOT,
  V207_RUNPOD_GPU,
  V207_RUNPOD_IDLE_TIMEOUT_SECONDS,
  V207_RUNPOD_MIN_CUDA_VERSION,
  V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
  V207_RUNPOD_REGION,
  V207_RUNPOD_SCALER,
  V207_RUNPOD_SCALER_VALUE,
  V207_RUNPOD_VOLUME_MOUNT,
  type RunPodDisposableResourceInventory,
  type RunPodInventory,
} from "./runpod-control";
import {
  V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";

const BILLING_START = "2026-08-20T00:00:00.000Z" as const;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const endpointBillingAmount = async (apiKey: string, fetchPort: FetchPort): Promise<number> => {
  const query = new URLSearchParams({
    bucketSize: "hour",
    grouping: "endpointId",
    startTime: BILLING_START,
    endTime: new Date().toISOString(),
  });
  const response = await fetchPort(`https://rest.runpod.io/v1/billing/endpoints?${query}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("V207_RECONCILIATION_BILLING_READ_FAILED");
  const value = (await response.json()) as unknown;
  if (!Array.isArray(value)) throw new Error("V207_RECONCILIATION_BILLING_RESPONSE_INVALID");
  let amount = 0;
  for (const row of value) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("V207_RECONCILIATION_BILLING_ROW_INVALID");
    }
    const candidate = Number((row as Record<string, unknown>).amount);
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new Error("V207_RECONCILIATION_BILLING_AMOUNT_INVALID");
    }
    amount += candidate;
  }
  return amount;
};

const validateZeroComputeAndVolumes = (inventory: RunPodInventory): void => {
  const expectedVolumeHashes = [
    V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
    V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  ].sort();
  const actualVolumeHashes = inventory.networkVolumes.map((volume) => volume.idHash).sort();
  if (
    inventory.pods.length !== 0 ||
    inventory.endpoints.length !== 0 ||
    inventory.privateTemplateCount !== 0 ||
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    inventory.networkVolumes.length !== 2 ||
    actualVolumeHashes.some((hash, index) => hash !== expectedVolumeHashes[index]) ||
    inventory.networkVolumes.some(
      (volume) =>
        volume.sizeGb !== V207_RUNPOD_MAGE_VOLUME_SIZE_GB ||
        volume.dataCenterId !== V207_RUNPOD_REGION,
    )
  ) {
    throw new Error("V207_RECONCILIATION_INVENTORY_MISMATCH");
  }
};

const SUCCESS_TERMINAL_STATUSES = new Set(["EXITED", "TERMINATED"]);
const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const hashResourceId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const assertSuccessIdentityHash = (value: string, code: string): void => {
  if (!SHA256_ID.test(value)) throw new Error(code);
};

export interface V207SuccessRetainedConfiguration {
  readonly endpointName: string;
  readonly templateName: string;
  readonly imageName: string;
  readonly containerDiskInGb: 120;
  readonly networkVolumeId: string;
  readonly environment: Readonly<Record<string, string>>;
}

const exactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((candidate, index) => candidate === expected[index]);

const exactEnvironment = (value: unknown, expected: Readonly<Record<string, string>>): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, expectedValue]) => actual[key] === expectedValue)
  );
};

/** Validate the exact retained raw provider configuration on every terminal read. */
const validateSuccessRawConfiguration = (
  endpoint: RunPodDisposableResourceInventory["endpoints"][number],
  template: RunPodDisposableResourceInventory["templates"][number],
  expected: V207SuccessRetainedConfiguration,
): void => {
  const endpointRaw = endpoint.raw;
  const templateRaw = template.raw;
  const endpointVolumeIds = endpointRaw.networkVolumeIds;
  const volumeBindingMatches =
    endpointRaw.networkVolumeId === expected.networkVolumeId &&
    (endpointVolumeIds === undefined ||
      exactStringArray(endpointVolumeIds, [expected.networkVolumeId]));
  const templateMountMatches =
    templateRaw.volumeMountPath === "/workspace" ||
    templateRaw.volumeMountPath === V207_RUNPOD_VOLUME_MOUNT;
  if (
    endpoint.name !== expected.endpointName ||
    template.name !== expected.templateName ||
    endpointRaw.id !== endpoint.id ||
    endpointRaw.name !== expected.endpointName ||
    endpointRaw.templateId !== template.id ||
    endpointRaw.computeType !== "GPU" ||
    endpointRaw.gpuCount !== 1 ||
    !exactStringArray(endpointRaw.gpuTypeIds, [V207_RUNPOD_GPU]) ||
    endpointRaw.workersMin !== 0 ||
    endpointRaw.workersMax !== 1 ||
    !exactStringArray(endpointRaw.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
    endpointRaw.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION ||
    endpointRaw.flashboot !== V207_RUNPOD_FLASHBOOT ||
    !volumeBindingMatches ||
    !exactStringArray(endpointRaw.dataCenterIds, [V207_RUNPOD_REGION]) ||
    endpointRaw.idleTimeout !== V207_RUNPOD_IDLE_TIMEOUT_SECONDS ||
    endpointRaw.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS ||
    endpointRaw.scalerType !== V207_RUNPOD_SCALER ||
    endpointRaw.scalerValue !== V207_RUNPOD_SCALER_VALUE ||
    (endpointRaw.env !== undefined && !exactEnvironment(endpointRaw.env, expected.environment)) ||
    templateRaw.id !== template.id ||
    templateRaw.name !== expected.templateName ||
    templateRaw.imageName !== expected.imageName ||
    templateRaw.containerDiskInGb !== expected.containerDiskInGb ||
    !exactStringArray(templateRaw.dockerEntrypoint, []) ||
    !exactStringArray(templateRaw.dockerStartCmd, []) ||
    !exactEnvironment(templateRaw.env, expected.environment) ||
    templateRaw.isPublic !== false ||
    templateRaw.isServerless !== true ||
    !exactStringArray(templateRaw.ports, []) ||
    templateRaw.volumeInGb !== 0 ||
    !templateMountMatches
  ) {
    throw new Error("V207_SUCCESS_RECONCILIATION_CONFIGURATION_MISMATCH");
  }
};

/**
 * Validate the retained-resource side of a successful qualification.  Failure cleanup is
 * intentionally stricter and requires zero disposable resources; success retains exactly the
 * one endpoint/template so a later operator can inspect the qualified route without recreating
 * it.  Terminal Pod records are allowed, but no running Pod or worker may remain.
 */
const validateSuccessInventory = (
  inventory: RunPodInventory,
  resources: RunPodDisposableResourceInventory,
  expectedEndpointIdHash: string,
  expectedTemplateIdHash: string,
  expectedConfiguration: V207SuccessRetainedConfiguration,
): void => {
  const endpoint = inventory.endpoints.find(
    (candidate) => candidate.idHash === expectedEndpointIdHash,
  );
  const resourceEndpoint = resources.endpoints.find(
    (candidate) => hashResourceId(candidate.id) === expectedEndpointIdHash,
  );
  const resourceTemplate = resources.templates.find(
    (candidate) => hashResourceId(candidate.id) === expectedTemplateIdHash,
  );
  if (resourceEndpoint !== undefined && resourceTemplate !== undefined) {
    validateSuccessRawConfiguration(resourceEndpoint, resourceTemplate, expectedConfiguration);
  }
  const expectedVolumeHashes = [
    V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
    V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  ].sort();
  const retainedVolumes = [...inventory.networkVolumes].sort((left, right) =>
    left.idHash.localeCompare(right.idHash),
  );
  const terminalPodStatuses = inventory.pods.every(
    (pod) =>
      pod.endpointWorker &&
      pod.endpointIdHash === expectedEndpointIdHash &&
      SUCCESS_TERMINAL_STATUSES.has(pod.desiredStatus) &&
      pod.observedStatuses.length > 0 &&
      pod.observedStatuses.every((status) => SUCCESS_TERMINAL_STATUSES.has(status)),
  );
  if (
    inventory.endpoints.length !== 1 ||
    endpoint === undefined ||
    endpoint.workersMin !== 0 ||
    endpoint.workersMax !== 1 ||
    !endpoint.workerRecordsReported ||
    endpoint.activeWorkerCount !== 0 ||
    endpoint.workerRecordCount !== endpoint.exitedWorkerCount ||
    endpoint.workerStatuses.some((status) => !SUCCESS_TERMINAL_STATUSES.has(status)) ||
    resources.endpoints.length !== 1 ||
    resourceEndpoint === undefined ||
    resources.templates.length !== 1 ||
    resourceTemplate === undefined ||
    inventory.privateTemplateCount !== 1 ||
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    !terminalPodStatuses ||
    retainedVolumes.length !== 2 ||
    JSON.stringify(retainedVolumes.map((volume) => volume.idHash)) !==
      JSON.stringify(expectedVolumeHashes) ||
    retainedVolumes.some(
      (volume) =>
        volume.sizeGb !== V207_RUNPOD_MAGE_VOLUME_SIZE_GB ||
        volume.dataCenterId !== V207_RUNPOD_REGION,
    )
  ) {
    throw new Error("V207_SUCCESS_RECONCILIATION_INVENTORY_MISMATCH");
  }
};

const successReadFingerprint = (
  inventory: RunPodInventory,
  resources: RunPodDisposableResourceInventory,
): string =>
  JSON.stringify({
    pods: [...inventory.pods]
      .map((pod) => ({
        id_hash: pod.idHash,
        desired_status: pod.desiredStatus,
        observed_statuses: [...pod.observedStatuses].sort(),
        endpoint_worker: pod.endpointWorker,
        endpoint_id_hash: pod.endpointIdHash,
      }))
      .sort((left, right) => left.id_hash.localeCompare(right.id_hash)),
    endpoints: [...inventory.endpoints]
      .map((endpoint) => ({
        id_hash: endpoint.idHash,
        workers_min: endpoint.workersMin,
        workers_max: endpoint.workersMax,
        worker_records_reported: endpoint.workerRecordsReported,
        worker_record_count: endpoint.workerRecordCount,
        active_worker_count: endpoint.activeWorkerCount,
        exited_worker_count: endpoint.exitedWorkerCount,
        worker_statuses: [...endpoint.workerStatuses].sort(),
      }))
      .sort((left, right) => left.id_hash.localeCompare(right.id_hash)),
    private_template_count: inventory.privateTemplateCount,
    running_pod_count: inventory.runningPodCount,
    active_serverless_worker_count: inventory.activeServerlessWorkerCount,
    network_volumes: [...inventory.networkVolumes]
      .map((volume) => ({
        id_hash: volume.idHash,
        size_gb: volume.sizeGb,
        data_center_id: volume.dataCenterId,
      }))
      .sort((left, right) => left.id_hash.localeCompare(right.id_hash)),
    resources: {
      endpoints: [...resources.endpoints]
        .map((resource) => ({ id_hash: hashResourceId(resource.id), name: resource.name }))
        .sort((left, right) => left.id_hash.localeCompare(right.id_hash)),
      templates: [...resources.templates]
        .map((resource) => ({ id_hash: hashResourceId(resource.id), name: resource.name }))
        .sort((left, right) => left.id_hash.localeCompare(right.id_hash)),
    },
  });

export interface V207ReadonlyReconciliationResult {
  readonly schema_version: "videoforge.v2-07-readonly-reconciliation/v2";
  readonly checked_at: string;
  readonly account_id_sha256: typeof SUJAL_RUNPOD_ACCOUNT_ID_SHA256;
  readonly provider_mutations: 0;
  readonly gpu_jobs_submitted: 0;
  readonly inventory: {
    readonly pods: 0;
    readonly endpoints: 0;
    readonly private_templates: 0;
    readonly active_serverless_workers: 0;
    readonly running_pods: 0;
    readonly retained_volumes: RunPodInventory["networkVolumes"];
  };
  readonly billing: {
    readonly baseline_endpoint_spend_usd: number;
    readonly final_endpoint_spend_usd: number;
    readonly incremental_spend_usd: number;
    readonly maximum_cumulative_finite_spend_usd: number;
    readonly within_approved_cap: true;
    readonly settlement: "THREE_STABLE_READS";
  };
}

export interface V207SuccessReadonlyReconciliationResult {
  readonly schema_version: "videoforge.v2-07-success-readonly-reconciliation/v2";
  readonly checked_at: string;
  readonly stable_read_count: 3;
  readonly account_id_sha256: typeof SUJAL_RUNPOD_ACCOUNT_ID_SHA256;
  readonly provider_mutations: 0;
  readonly gpu_jobs_submitted: 0;
  readonly inventory: {
    readonly checked_at: string;
    readonly pod_count: number;
    readonly endpoint_count: 1;
    readonly endpoint_id_hash: string;
    readonly workers_min: 0;
    readonly workers_max: 1;
    readonly active_workers: 0;
    readonly running_pods: 0;
    readonly active_serverless_workers: 0;
    readonly endpoint_worker_statuses: readonly string[];
    readonly terminal_pod_statuses: readonly (readonly string[])[];
    readonly private_template_count: 1;
    readonly volume_id_hashes: readonly string[];
    readonly volume_sizes_gb: readonly (number | null)[];
    readonly volume_regions: readonly (string | null)[];
  };
  readonly retained_resources: {
    readonly endpoint_count: 1;
    readonly template_count: 1;
    readonly endpoint_id_hash: string;
    readonly template_id_hash: string;
    readonly exact_raw_configuration_validated_each_read: true;
  };
  readonly billing: {
    readonly baseline_endpoint_spend_usd: number;
    readonly final_endpoint_spend_usd: number;
    readonly incremental_spend_usd: number;
    readonly maximum_cumulative_finite_spend_usd: number;
    readonly within_approved_cap: true;
    readonly settlement: "THREE_STABLE_READS";
  };
}

/**
 * Return the approved-cap threshold in provider billing space.
 *
 * RunPod's billing endpoint returns the account's cumulative endpoint total and
 * the approved finite cap is an absolute ceiling in that same billing space.
 * Keep this arithmetic in one small, exported helper so the live runner and the
 * final read-only reconciliation cannot drift or accidentally add the baseline
 * to the approved ceiling.
 */
export function v207IncrementalSpendThreshold(
  baselineEndpointSpendUsd: number,
  maximumCumulativeFiniteSpendUsd: number,
): number {
  if (
    !Number.isFinite(baselineEndpointSpendUsd) ||
    baselineEndpointSpendUsd < 0 ||
    !Number.isFinite(maximumCumulativeFiniteSpendUsd) ||
    maximumCumulativeFiniteSpendUsd <= 0 ||
    baselineEndpointSpendUsd > maximumCumulativeFiniteSpendUsd
  ) {
    throw new Error("V207_RECONCILIATION_FINITE_CAP_INVALID");
  }
  return maximumCumulativeFiniteSpendUsd;
}

/**
 * Validate a cumulative provider billing reading and return its fresh-attempt
 * increment.  A downward billing read is not treated as zero spend: it means
 * the provider read is inconsistent with the captured baseline and must stop
 * the run before any further work is accepted.
 */
export function v207IncrementalSpendFromBilling(
  baselineEndpointSpendUsd: number,
  currentEndpointSpendUsd: number,
  maximumCumulativeFiniteSpendUsd: number,
  exceededCode = "V207_RECONCILIATION_FINITE_CAP_EXCEEDED",
): number {
  const threshold = v207IncrementalSpendThreshold(
    baselineEndpointSpendUsd,
    maximumCumulativeFiniteSpendUsd,
  );
  if (!Number.isFinite(currentEndpointSpendUsd) || currentEndpointSpendUsd < 0) {
    throw new Error("V207_RECONCILIATION_BILLING_INVALID");
  }
  if (currentEndpointSpendUsd < baselineEndpointSpendUsd) {
    throw new Error("V207_RECONCILIATION_BILLING_INVALID");
  }
  const incrementalSpendUsd = currentEndpointSpendUsd - baselineEndpointSpendUsd;
  // Compare in cumulative billing space so a boundary value produced by the
  // same baseline+cap arithmetic is not rejected by a floating-point roundoff
  // in the separately-subtracted delta.
  if (currentEndpointSpendUsd > threshold) {
    throw new Error(exceededCode);
  }
  return incrementalSpendUsd;
}

export async function reconcileV207Readonly(input: {
  readonly accountIdHash: string;
  readonly baselineEndpointSpendUsd: number;
  readonly maximumCumulativeFiniteSpendUsd: number;
  readonly inventory: () => Promise<RunPodInventory>;
  readonly billingAmount: () => Promise<number>;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): Promise<V207ReadonlyReconciliationResult> {
  if (input.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Error("V207_RECONCILIATION_ACCOUNT_MISMATCH");
  }
  if (!Number.isFinite(input.baselineEndpointSpendUsd) || input.baselineEndpointSpendUsd < 0) {
    throw new Error("V207_RECONCILIATION_BASELINE_INVALID");
  }
  const billingThreshold = v207IncrementalSpendThreshold(
    input.baselineEndpointSpendUsd,
    input.maximumCumulativeFiniteSpendUsd,
  );
  const wait = input.wait ?? sleep;
  let finalInventory: RunPodInventory | null = null;
  let priorBilling: number | null = null;
  let finalBilling = Number.NaN;
  for (let read = 0; read < 3; read += 1) {
    const [inventory, billing] = await Promise.all([input.inventory(), input.billingAmount()]);
    validateZeroComputeAndVolumes(inventory);
    v207IncrementalSpendFromBilling(
      input.baselineEndpointSpendUsd,
      billing,
      input.maximumCumulativeFiniteSpendUsd,
    );
    if (priorBilling !== null && Math.abs(billing - priorBilling) >= 0.000_001) {
      throw new Error("V207_RECONCILIATION_BILLING_UNSETTLED");
    }
    finalInventory = inventory;
    finalBilling = billing;
    priorBilling = billing;
    if (read < 2) await wait(10_000);
  }
  if (finalInventory === null) throw new Error("V207_RECONCILIATION_INVENTORY_MISSING");
  if (finalBilling > billingThreshold) {
    throw new Error("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  }
  const result: V207ReadonlyReconciliationResult = {
    schema_version: "videoforge.v2-07-readonly-reconciliation/v2",
    checked_at: finalInventory.checkedAt,
    account_id_sha256: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
    provider_mutations: 0,
    gpu_jobs_submitted: 0,
    inventory: {
      pods: 0,
      endpoints: 0,
      private_templates: 0,
      active_serverless_workers: 0,
      running_pods: 0,
      retained_volumes: finalInventory.networkVolumes,
    },
    billing: {
      baseline_endpoint_spend_usd: input.baselineEndpointSpendUsd,
      final_endpoint_spend_usd: finalBilling,
      incremental_spend_usd: Math.max(0, finalBilling - input.baselineEndpointSpendUsd),
      maximum_cumulative_finite_spend_usd: input.maximumCumulativeFiniteSpendUsd,
      within_approved_cap: true,
      settlement: "THREE_STABLE_READS",
    },
  };
  return Object.freeze(result);
}

/**
 * Reconcile a successful run without deleting its qualified endpoint/template.  This is a
 * separate contract from reconcileV207Readonly: success must retain exactly the two disposable
 * identities that were qualified, while still proving three stable read-only snapshots with no
 * queued jobs, active workers, or running Pods.
 */
export async function reconcileV207SuccessReadonly(input: {
  readonly accountIdHash: string;
  readonly baselineEndpointSpendUsd: number;
  readonly maximumCumulativeFiniteSpendUsd: number;
  readonly expectedEndpointIdHash: string;
  readonly expectedTemplateIdHash: string;
  readonly expectedConfiguration: V207SuccessRetainedConfiguration;
  readonly inventory: () => Promise<RunPodInventory>;
  readonly resources: () => Promise<RunPodDisposableResourceInventory>;
  /** A read-only provider health check that fails closed if queued/in-progress jobs remain. */
  readonly queueEmpty: () => Promise<void>;
  readonly billingAmount: () => Promise<number>;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): Promise<V207SuccessReadonlyReconciliationResult> {
  if (input.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Error("V207_RECONCILIATION_ACCOUNT_MISMATCH");
  }
  assertSuccessIdentityHash(input.expectedEndpointIdHash, "V207_SUCCESS_ENDPOINT_ID_HASH_INVALID");
  assertSuccessIdentityHash(input.expectedTemplateIdHash, "V207_SUCCESS_TEMPLATE_ID_HASH_INVALID");
  if (!Number.isFinite(input.baselineEndpointSpendUsd) || input.baselineEndpointSpendUsd < 0) {
    throw new Error("V207_RECONCILIATION_BASELINE_INVALID");
  }
  const billingThreshold = v207IncrementalSpendThreshold(
    input.baselineEndpointSpendUsd,
    input.maximumCumulativeFiniteSpendUsd,
  );
  const wait = input.wait ?? sleep;
  let finalInventory: RunPodInventory | null = null;
  let finalResources: RunPodDisposableResourceInventory | null = null;
  let finalBilling = Number.NaN;
  let priorBilling: number | null = null;
  let priorFingerprint: string | null = null;
  for (let read = 0; read < 3; read += 1) {
    try {
      await input.queueEmpty();
    } catch {
      throw new Error("V207_SUCCESS_RECONCILIATION_QUEUE_NOT_EMPTY");
    }
    const [inventory, resources, billing] = await Promise.all([
      input.inventory(),
      input.resources(),
      input.billingAmount(),
    ]);
    validateSuccessInventory(
      inventory,
      resources,
      input.expectedEndpointIdHash,
      input.expectedTemplateIdHash,
      input.expectedConfiguration,
    );
    const fingerprint = successReadFingerprint(inventory, resources);
    if (priorFingerprint !== null && fingerprint !== priorFingerprint) {
      throw new Error("V207_SUCCESS_RECONCILIATION_INVENTORY_UNSETTLED");
    }
    v207IncrementalSpendFromBilling(
      input.baselineEndpointSpendUsd,
      billing,
      input.maximumCumulativeFiniteSpendUsd,
    );
    if (priorBilling !== null && Math.abs(billing - priorBilling) >= 0.000_001) {
      throw new Error("V207_RECONCILIATION_BILLING_UNSETTLED");
    }
    try {
      await input.queueEmpty();
    } catch {
      throw new Error("V207_SUCCESS_RECONCILIATION_QUEUE_NOT_EMPTY");
    }
    finalInventory = inventory;
    finalResources = resources;
    finalBilling = billing;
    priorBilling = billing;
    priorFingerprint = fingerprint;
    if (read < 2) await wait(10_000);
  }
  if (finalInventory === null || finalResources === null) {
    throw new Error("V207_SUCCESS_RECONCILIATION_INVENTORY_MISSING");
  }
  if (finalBilling > billingThreshold) {
    throw new Error("V207_RECONCILIATION_FINITE_CAP_EXCEEDED");
  }
  const endpoint = finalInventory.endpoints[0];
  const retainedEndpoint = finalResources.endpoints[0];
  const retainedTemplate = finalResources.templates[0];
  if (endpoint === undefined || retainedEndpoint === undefined || retainedTemplate === undefined) {
    throw new Error("V207_SUCCESS_RECONCILIATION_INVENTORY_MISSING");
  }
  const retainedVolumes = [...finalInventory.networkVolumes].sort((left, right) =>
    left.idHash.localeCompare(right.idHash),
  );
  const result: V207SuccessReadonlyReconciliationResult = {
    schema_version: "videoforge.v2-07-success-readonly-reconciliation/v2",
    checked_at: finalInventory.checkedAt,
    stable_read_count: 3,
    account_id_sha256: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
    provider_mutations: 0,
    gpu_jobs_submitted: 0,
    inventory: {
      checked_at: finalInventory.checkedAt,
      pod_count: finalInventory.pods.length,
      endpoint_count: 1,
      endpoint_id_hash: endpoint.idHash,
      workers_min: 0,
      workers_max: 1,
      active_workers: 0,
      running_pods: 0,
      active_serverless_workers: 0,
      endpoint_worker_statuses: endpoint.workerStatuses,
      terminal_pod_statuses: finalInventory.pods.map((pod) => pod.observedStatuses),
      private_template_count: 1,
      volume_id_hashes: retainedVolumes.map((volume) => volume.idHash),
      volume_sizes_gb: retainedVolumes.map((volume) => volume.sizeGb),
      volume_regions: retainedVolumes.map((volume) => volume.dataCenterId),
    },
    retained_resources: {
      endpoint_count: 1,
      template_count: 1,
      endpoint_id_hash: hashResourceId(retainedEndpoint.id),
      template_id_hash: hashResourceId(retainedTemplate.id),
      exact_raw_configuration_validated_each_read: true,
    },
    billing: {
      baseline_endpoint_spend_usd: input.baselineEndpointSpendUsd,
      final_endpoint_spend_usd: finalBilling,
      incremental_spend_usd: Math.max(0, finalBilling - input.baselineEndpointSpendUsd),
      maximum_cumulative_finite_spend_usd: input.maximumCumulativeFiniteSpendUsd,
      within_approved_cap: true,
      settlement: "THREE_STABLE_READS",
    },
  };
  return Object.freeze(result);
}

export async function runConfiguredV207ReadonlyReconciliation(input: {
  readonly baselineEndpointSpendUsd: number;
  readonly maximumCumulativeFiniteSpendUsd: number;
}): Promise<V207ReadonlyReconciliationResult> {
  const apiKey = await loadSujalRunPodApiKeyFromKeychain();
  const account = await assertSujalRunPodAccount(apiKey);
  const control = new RunPodControlClient({ apiKey });
  return reconcileV207Readonly({
    accountIdHash: account.accountIdHash,
    baselineEndpointSpendUsd: input.baselineEndpointSpendUsd,
    maximumCumulativeFiniteSpendUsd: input.maximumCumulativeFiniteSpendUsd,
    inventory: () => control.inventory(),
    billingAmount: () => endpointBillingAmount(apiKey, globalThis.fetch),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const baseline = Number(process.env.V207_RECONCILIATION_BASELINE_ENDPOINT_SPEND_USD);
  const cap = Number(process.env.V207_FINITE_CAP_USD);
  void runConfiguredV207ReadonlyReconciliation({
    baselineEndpointSpendUsd: baseline,
    maximumCumulativeFiniteSpendUsd: cap,
  })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      const code = error instanceof Error ? error.message : "V207_RECONCILIATION_FAILED";
      process.stderr.write(
        `${/^V207_[A-Z0-9_]+$/u.test(code) ? code : "V207_RECONCILIATION_FAILED"}\n`,
      );
      process.exitCode = 1;
    });
}
