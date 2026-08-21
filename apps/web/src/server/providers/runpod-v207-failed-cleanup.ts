import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalizeJson } from "@videoforge/contracts";

import {
  RunPodControlClient,
  RunPodControlError,
  RunPodDrainGuard,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_GPU,
  V207_RUNPOD_INIT_TIMEOUT_SECONDS,
  V207_RUNPOD_MIN_CUDA_VERSION,
  V207_RUNPOD_REGION,
  V207_RUNPOD_SCALER,
  V207_RUNPOD_SCALER_VALUE,
  V207_RUNPOD_VOLUME_MOUNT,
  V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
  type RunPodDisposableResourceInventory,
  type RunPodInventory,
  type RunPodNamedResource,
} from "./runpod-control";
import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

/** The exact disposable names used by the bounded V2-07 Mage qualification. */
export const V207_FAILED_CLEANUP_ENDPOINT_NAME = "videoforge_mage_v207_20260820" as const;
export const V207_FAILED_CLEANUP_TEMPLATE_NAME = "videoforge_mage_v207_20260820" as const;

/** The retained Mage volume is an identity fence, never a cleanup target. */
export const V207_FAILED_CLEANUP_VOLUME_ID = "c7kg89brtj" as const;
export const V207_FAILED_CLEANUP_VOLUME_ID_HASH =
  "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619" as const;
export const V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH =
  "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be" as const;
export const V207_FAILED_CLEANUP_MANIFEST_SHA256 =
  "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b" as const;
export const V207_FAILED_CLEANUP_RECEIPT_KEY_ID = "v207-qualification-20260820" as const;

const TERMINAL_WORKER_STATUSES = new Set(["EXITED", "TERMINATED"]);
const HEX_64 = /^[a-f0-9]{64}$/u;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.:-]{2,160}$/u;
const hashText = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const volumeIdHash = hashText(V207_FAILED_CLEANUP_VOLUME_ID);

type JsonRecord = Readonly<Record<string, unknown>>;
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const exactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((candidate, index) => candidate === expected[index]);

const optionalExactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  value === undefined || exactStringArray(value, expected);

const isTerminal = (value: unknown): value is string =>
  typeof value === "string" && TERMINAL_WORKER_STATUSES.has(value);

const sortedKeys = (value: JsonRecord): readonly string[] => Object.keys(value).sort();

const expectedTemplateEnvironmentKeys = [
  "DIFFUSERS_OFFLINE",
  "HF_HUB_OFFLINE",
  "LOG_LEVEL",
  "MAGE_MODEL_ROOT",
  "RUNPOD_INIT_TIMEOUT",
  "TRANSFORMERS_OFFLINE",
  "VIDEOFORGE_MAGE_GPU_OFFERING_ID",
  "VIDEOFORGE_MAGE_MANIFEST_SHA256",
  "VIDEOFORGE_MAGE_VOLUME_ID_HASH",
  "VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST",
  "VIDEOFORGE_MAGE_WORKER_TOKEN",
  "VIDEOFORGE_RECEIPT_KEY_ID",
  "VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX",
] as const;

const throwCleanup = (code: string): never => {
  throw new RunPodControlError(code);
};

function validateTemplate(resource: RunPodNamedResource, endpointId?: string): string | null {
  const raw = resource.raw;
  if (
    resource.name !== V207_FAILED_CLEANUP_TEMPLATE_NAME ||
    raw.imageName !== V207_REPAIRED_IMAGE ||
    raw.containerDiskInGb !== 120 ||
    (raw.isPublic !== undefined && raw.isPublic !== false) ||
    raw.isServerless !== true ||
    (raw.volumeInGb !== undefined && raw.volumeInGb !== 0) ||
    (raw.volumeMountPath !== "/workspace" && raw.volumeMountPath !== V207_RUNPOD_VOLUME_MOUNT)
  ) {
    throwCleanup("V207_CLEANUP_TEMPLATE_IDENTITY_MISMATCH");
  }

  const environment = asRecord(raw.env);
  if (environment === null) {
    throwCleanup("V207_CLEANUP_TEMPLATE_ENVIRONMENT_MISMATCH");
  }
  const validatedEnvironment = environment as JsonRecord;
  const endpointIdentity = validatedEnvironment.VIDEOFORGE_MAGE_ENDPOINT_ID_HASH;
  const expectedKeys =
    endpointIdentity === undefined
      ? [...expectedTemplateEnvironmentKeys]
      : [...expectedTemplateEnvironmentKeys, "VIDEOFORGE_MAGE_ENDPOINT_ID_HASH"];
  if (!exactStringArray(sortedKeys(validatedEnvironment), expectedKeys.sort())) {
    throwCleanup("V207_CLEANUP_TEMPLATE_ENVIRONMENT_MISMATCH");
  }
  if (
    endpointIdentity !== undefined &&
    (endpointId === undefined || endpointIdentity !== hashText(endpointId))
  ) {
    throwCleanup("V207_CLEANUP_TEMPLATE_ENDPOINT_IDENTITY_MISMATCH");
  }
  const expectedEnvironment: Readonly<Record<string, string>> = {
    DIFFUSERS_OFFLINE: "1",
    HF_HUB_OFFLINE: "1",
    LOG_LEVEL: "INFO",
    MAGE_MODEL_ROOT: "/runpod-volume/mage-model",
    RUNPOD_INIT_TIMEOUT: String(V207_RUNPOD_INIT_TIMEOUT_SECONDS),
    TRANSFORMERS_OFFLINE: "1",
    VIDEOFORGE_MAGE_GPU_OFFERING_ID: V207_RUNPOD_GPU,
    VIDEOFORGE_MAGE_MANIFEST_SHA256: V207_FAILED_CLEANUP_MANIFEST_SHA256,
    VIDEOFORGE_MAGE_VOLUME_ID_HASH: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
    VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: V207_REPAIRED_IMAGE,
    VIDEOFORGE_RECEIPT_KEY_ID: V207_FAILED_CLEANUP_RECEIPT_KEY_ID,
  };
  for (const [key, value] of Object.entries(expectedEnvironment)) {
    if (validatedEnvironment[key] !== value)
      throwCleanup("V207_CLEANUP_TEMPLATE_ENVIRONMENT_MISMATCH");
  }
  if (
    typeof validatedEnvironment.VIDEOFORGE_MAGE_WORKER_TOKEN !== "string" ||
    !HEX_64.test(validatedEnvironment.VIDEOFORGE_MAGE_WORKER_TOKEN) ||
    typeof validatedEnvironment.VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX !== "string" ||
    !HEX_64.test(validatedEnvironment.VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX)
  ) {
    throwCleanup("V207_CLEANUP_TEMPLATE_SECRET_SHAPE_MISMATCH");
  }
  return typeof endpointIdentity === "string" ? endpointIdentity : null;
}

function validateEndpoint(resource: RunPodNamedResource, template: RunPodNamedResource): void {
  const raw = resource.raw;
  const networkVolumeIds = raw.networkVolumeIds;
  const networkVolumeMatches =
    (raw.networkVolumeId === undefined || raw.networkVolumeId === V207_FAILED_CLEANUP_VOLUME_ID) &&
    (networkVolumeIds === undefined ||
      exactStringArray(networkVolumeIds, [V207_FAILED_CLEANUP_VOLUME_ID])) &&
    (raw.networkVolumeId === V207_FAILED_CLEANUP_VOLUME_ID ||
      exactStringArray(networkVolumeIds, [V207_FAILED_CLEANUP_VOLUME_ID]));
  if (
    resource.name !== V207_FAILED_CLEANUP_ENDPOINT_NAME ||
    raw.templateId !== template.id ||
    (raw.computeType !== undefined && raw.computeType !== "GPU") ||
    raw.workersMin !== 0 ||
    raw.workersMax !== 1 ||
    raw.gpuCount !== 1 ||
    !exactStringArray(raw.gpuTypeIds, [V207_RUNPOD_GPU]) ||
    !networkVolumeMatches ||
    !optionalExactStringArray(raw.dataCenterIds, [V207_RUNPOD_REGION]) ||
    !exactStringArray(raw.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) ||
    raw.minCudaVersion !== V207_RUNPOD_MIN_CUDA_VERSION ||
    // The qualification path fails closed when RunPod forces flashboot=true despite the staged
    // false policy. Failure cleanup must still be able to delete that exact disposable endpoint;
    // accepting either boolean here authorizes no dispatch or policy update and remains fenced by
    // every other exact identity/config field plus two stable terminal worker/Pod snapshots.
    typeof raw.flashboot !== "boolean" ||
    raw.idleTimeout !== 5 ||
    raw.executionTimeoutMs !== V207_RUNPOD_EXECUTION_TIMEOUT_MS ||
    raw.scalerType !== V207_RUNPOD_SCALER ||
    raw.scalerValue !== V207_RUNPOD_SCALER_VALUE
  ) {
    throwCleanup("V207_CLEANUP_ENDPOINT_IDENTITY_MISMATCH");
  }
}

const rawWorkerStatuses = (resource: RunPodNamedResource): readonly string[] => {
  const workers = resource.raw.workers;
  if (!Array.isArray(workers)) throwCleanup("V207_CLEANUP_WORKER_RECORDS_UNCONFIRMED");
  return Object.freeze(
    (workers as readonly unknown[]).map((worker: unknown) => {
      const value = asRecord(worker);
      const desired = value?.desiredStatus;
      const current = value?.status;
      if (desired !== undefined && !isTerminal(desired)) {
        throwCleanup("V207_CLEANUP_WORKER_STATUS_UNCONFIRMED");
      }
      if (current !== undefined && !isTerminal(current)) {
        throwCleanup("V207_CLEANUP_WORKER_STATUS_UNCONFIRMED");
      }
      if (isTerminal(desired) && isTerminal(current) && desired !== current) {
        throwCleanup("V207_CLEANUP_WORKER_STATUS_UNCONFIRMED");
      }
      const observed = isTerminal(desired) ? desired : isTerminal(current) ? current : null;
      if (observed === null) throwCleanup("V207_CLEANUP_WORKER_STATUS_UNCONFIRMED");
      return observed as string;
    }),
  );
};

function validateVolume(inventory: RunPodInventory): void {
  const expectedHashes = [
    V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
    V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  ].sort();
  const observedHashes = inventory.networkVolumes.map((volume) => volume.idHash).sort();
  if (
    volumeIdHash !== V207_FAILED_CLEANUP_VOLUME_ID_HASH ||
    inventory.networkVolumes.length !== 2 ||
    !exactStringArray(observedHashes, expectedHashes) ||
    inventory.networkVolumes.some(
      (volume) =>
        volume.sizeGb !== V207_RUNPOD_MAGE_VOLUME_SIZE_GB ||
        volume.dataCenterId !== V207_RUNPOD_REGION,
    )
  ) {
    throwCleanup("V207_CLEANUP_VOLUME_IDENTITY_MISMATCH");
  }
}

function validateTerminalInventory(
  inventory: RunPodInventory,
  resources: RunPodDisposableResourceInventory,
): {
  readonly endpoint: RunPodNamedResource;
  readonly template: RunPodNamedResource;
  readonly signature: string;
  readonly templateEndpointIdHash: string | null;
  readonly endpointWorkerRecordCount: number;
  readonly terminalPodRecordCount: number;
} {
  if (
    resources.endpoints.length !== 1 ||
    resources.templates.length !== 1 ||
    inventory.endpoints.length !== 1 ||
    inventory.privateTemplateCount !== 1
  ) {
    throwCleanup("V207_CLEANUP_RESOURCE_COUNT_INVALID");
  }
  const endpoint = resources.endpoints[0]!;
  const template = resources.templates[0]!;
  validateEndpoint(endpoint, template);
  const templateEndpointIdHash = validateTemplate(template, endpoint.id);
  validateVolume(inventory);

  const endpointInventory = inventory.endpoints[0]!;
  const endpointWorkerStatuses = rawWorkerStatuses(endpoint);
  if (
    endpointInventory.idHash !== hashText(endpoint.id) ||
    endpointInventory.workersMin !== 0 ||
    endpointInventory.workersMax !== 1 ||
    !endpointInventory.workerRecordsReported ||
    endpointInventory.workerRecordCount !== endpointWorkerStatuses.length ||
    endpointInventory.workerStatuses.length !== endpointWorkerStatuses.length ||
    endpointInventory.activeWorkerCount !== 0 ||
    endpointInventory.workerRecordCount !== endpointInventory.exitedWorkerCount ||
    endpointInventory.workerStatuses.some((status) => !isTerminal(status)) ||
    endpointWorkerStatuses.some(
      (status, index) => status !== endpointInventory.workerStatuses[index],
    )
  ) {
    throwCleanup("V207_CLEANUP_WORKER_RECORDS_UNCONFIRMED");
  }
  if (
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    inventory.pods.some(
      (pod) =>
        !pod.endpointWorker ||
        pod.endpointIdHash !== hashText(endpoint.id) ||
        !isTerminal(pod.desiredStatus) ||
        pod.observedStatuses.length === 0 ||
        pod.observedStatuses.some((status) => !isTerminal(status)),
    )
  ) {
    throwCleanup("V207_CLEANUP_TERMINAL_INVENTORY_UNCONFIRMED");
  }

  const signature = hashText(
    canonicalizeJson({
      endpoint: {
        idHash: hashText(endpoint.id),
        templateIdHash: hashText(template.id),
        flashboot: endpoint.raw.flashboot,
        workersMin: endpointInventory.workersMin,
        workersMax: endpointInventory.workersMax,
        workerStatuses: endpointInventory.workerStatuses,
        rawWorkerStatuses: endpointWorkerStatuses,
      },
      template: {
        endpointIdHash: templateEndpointIdHash,
      },
      pods: inventory.pods
        .map((pod) => ({
          idHash: pod.idHash,
          endpointIdHash: pod.endpointIdHash,
          desiredStatus: pod.desiredStatus,
          observedStatuses: pod.observedStatuses,
        }))
        .sort((left, right) => left.idHash.localeCompare(right.idHash)),
      volume: inventory.networkVolumes
        .map((volume) => ({
          idHash: volume.idHash,
          sizeGb: volume.sizeGb,
          dataCenterId: volume.dataCenterId,
        }))
        .sort((left, right) => left.idHash.localeCompare(right.idHash)),
    }),
  );
  return {
    endpoint,
    template,
    signature,
    templateEndpointIdHash,
    endpointWorkerRecordCount: endpointInventory.workerRecordCount,
    terminalPodRecordCount: inventory.pods.length,
  };
}

function assertTemplateStillBound(
  resources: RunPodDisposableResourceInventory,
  expectedTemplate: RunPodNamedResource,
  expectedEndpointId: string,
  expectedEndpointIdHash: string | null,
): void {
  if (resources.endpoints.length !== 0 || resources.templates.length !== 1) {
    throwCleanup("V207_CLEANUP_ENDPOINT_ABSENCE_UNCONFIRMED");
  }
  const template = resources.templates[0]!;
  if (template.id !== expectedTemplate.id) {
    throwCleanup("V207_CLEANUP_TEMPLATE_BINDING_UNCONFIRMED");
  }
  if (validateTemplate(template, expectedEndpointId) !== expectedEndpointIdHash) {
    throwCleanup("V207_CLEANUP_TEMPLATE_BINDING_UNCONFIRMED");
  }
}

function assertDisposableResourcesAbsent(resources: RunPodDisposableResourceInventory): void {
  if (resources.endpoints.length !== 0 || resources.templates.length !== 0) {
    throwCleanup("V207_CLEANUP_RESOURCE_ABSENCE_UNCONFIRMED");
  }
}

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof RunPodControlError ? error.code : "V207_CLEANUP_FAILED";
  return SAFE_ERROR_CODE.test(candidate) ? candidate : "V207_CLEANUP_FAILED";
}

export interface V207FailedCleanupOptions {
  readonly apiKey: string;
  readonly control?: RunPodControlClient;
  readonly fetch?: FetchPort;
  readonly controlBaseUrl?: string;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface V207FailedCleanupResult {
  readonly schemaVersion: "videoforge.v2-07-failed-cleanup/v1";
  readonly endpointIdHash: string;
  readonly templateIdHash: string;
  readonly retainedVolumeIdHash: typeof V207_FAILED_CLEANUP_VOLUME_ID_HASH;
  readonly stableTerminalSnapshotCount: 2;
  readonly endpointWorkerRecordCount: number;
  readonly terminalPodRecordCount: number;
  readonly endpointDeleted: true;
  readonly templateDeleted: true;
  readonly finalDisposableResourcesAbsent: true;
}

/**
 * Load the configured credential without ever logging or returning it through a CLI result.
 * Tests may inject a keychain loader; production falls back to the configured macOS keychain item.
 */
export async function loadConfiguredRunPodKey(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  keychainLoader: () => Promise<string> = loadSujalRunPodApiKeyFromKeychain,
): Promise<string> {
  const configured = environment.RUNPOD_KEY;
  if (configured !== undefined) {
    if (configured.trim() !== configured || configured.length < 20 || /\s/u.test(configured)) {
      throw new RunPodControlError("V207_CLEANUP_AUTH_INVALID");
    }
    return configured;
  }
  const key = await keychainLoader();
  if (key.trim() !== key || key.length < 20 || /\s/u.test(key)) {
    throw new RunPodControlError("V207_CLEANUP_AUTH_INVALID");
  }
  return key;
}

/**
 * Validate and delete only the exact failed V2-07 endpoint and its bound template.
 * The retained model volume is read for identity and is never passed to a mutation method.
 */
export async function cleanupFailedV207Resources(
  options: V207FailedCleanupOptions,
): Promise<V207FailedCleanupResult> {
  if (
    options.apiKey.trim() !== options.apiKey ||
    options.apiKey.length < 20 ||
    /\s/u.test(options.apiKey)
  ) {
    throw new RunPodControlError("V207_CLEANUP_AUTH_INVALID");
  }
  const fetch = options.fetch ?? globalThis.fetch;
  const control =
    options.control ??
    new RunPodControlClient({
      apiKey: options.apiKey,
      fetch,
      baseUrl: options.controlBaseUrl,
    });
  const guard = new RunPodDrainGuard();
  const resources = await control.inventoryDisposableResources();
  if (resources.endpoints.length !== 1 || resources.templates.length !== 1) {
    throwCleanup("V207_CLEANUP_RESOURCE_COUNT_INVALID");
  }
  const endpoint = resources.endpoints[0]!;
  const template = resources.templates[0]!;
  validateEndpoint(endpoint, template);
  validateTemplate(template, endpoint.id);
  // Provider health can retain contradictory idle/ready counters after every attributable
  // Pod and worker record is terminal. This cleanup path never dispatches or updates policy;
  // deletion is authorized only by the two exact, stable inventory/resource snapshots below.
  const firstInventory = await control.inventory();
  const firstResources = await control.inventoryDisposableResources();
  const first = validateTerminalInventory(firstInventory, firstResources);
  if (first.endpoint.id !== endpoint.id || first.template.id !== template.id) {
    throwCleanup("V207_CLEANUP_RESOURCE_IDENTITY_CHANGED");
  }
  await (
    options.sleep ??
    ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  )(250);
  const secondInventory = await control.inventory();
  const secondResources = await control.inventoryDisposableResources();
  const second = validateTerminalInventory(secondInventory, secondResources);
  if (
    first.endpoint.id !== second.endpoint.id ||
    first.template.id !== second.template.id ||
    first.signature !== second.signature
  ) {
    throwCleanup("V207_CLEANUP_TERMINAL_INVENTORY_UNSTABLE");
  }
  guard.confirmZero(0, 0);

  await control.deleteEndpoint(endpoint.id, guard);
  const afterEndpointDelete = await control.inventoryDisposableResources();
  assertTemplateStillBound(
    afterEndpointDelete,
    template,
    endpoint.id,
    second.templateEndpointIdHash,
  );

  await control.deleteTemplate(template.id);
  const afterTemplateDelete = await control.inventoryDisposableResources();
  assertDisposableResourcesAbsent(afterTemplateDelete);
  const finalInventory = await control.inventory();
  validateVolume(finalInventory);
  if (
    finalInventory.endpoints.length !== 0 ||
    finalInventory.privateTemplateCount !== 0 ||
    finalInventory.runningPodCount !== 0 ||
    finalInventory.activeServerlessWorkerCount !== 0 ||
    finalInventory.pods.length !== 0
  ) {
    throwCleanup("V207_CLEANUP_FINAL_RESOURCE_STATE_UNCONFIRMED");
  }

  return Object.freeze({
    schemaVersion: "videoforge.v2-07-failed-cleanup/v1",
    endpointIdHash: hashText(endpoint.id),
    templateIdHash: hashText(template.id),
    retainedVolumeIdHash: V207_FAILED_CLEANUP_VOLUME_ID_HASH,
    stableTerminalSnapshotCount: 2,
    endpointWorkerRecordCount: second.endpointWorkerRecordCount,
    terminalPodRecordCount: second.terminalPodRecordCount,
    endpointDeleted: true,
    templateDeleted: true,
    finalDisposableResourcesAbsent: true,
  });
}

export async function runConfiguredV207FailedCleanup(): Promise<V207FailedCleanupResult> {
  const apiKey = await loadConfiguredRunPodKey();
  await assertSujalRunPodAccount(apiKey);
  return cleanupFailedV207Resources({ apiKey });
}

function isDirectExecution(): boolean {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  );
}

if (isDirectExecution()) {
  void runConfiguredV207FailedCleanup()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error: unknown) => {
      process.stderr.write(`${safeErrorCode(error)}\n`);
      process.exitCode = 1;
    });
}
