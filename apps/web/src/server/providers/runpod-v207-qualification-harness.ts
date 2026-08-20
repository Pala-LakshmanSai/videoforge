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
  V207_RUNPOD_GPU,
  V207_RUNPOD_VOLUME_MOUNT,
  type RunPodEndpointPolicy,
  type RunPodDisposableResourceInventory,
  type RunPodInventory,
  type RunPodJobResult,
  type RunPodV207ConcurrentReaderPolicy,
  type RunPodV207Placement,
} from "./runpod-control";
import { V207_REPAIRED_IMAGE } from "./v207-activation-authority";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const PORT_CAPABILITY = /^[A-Za-z0-9._:-]{32,512}$/u;
const PORT_ID = ID;
const URL_MAX_LENGTH = 8_192;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);

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
}

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
  #template: { readonly id: string; readonly idHash: string } | null = null;
  #endpoint: { readonly id: string; readonly idHash: string } | null = null;
  #jobs: RunPodServerlessJobClient | null = null;
  #initialConfigHash: string | null = null;
  #concurrentReaderConfigHash: string | null = null;
  #initialQualificationComplete = false;
  /** Blocks the primary client until every independently guarded reader has drained. */
  #concurrentReaderFence = false;
  /** Claims the one allowed two-reader dispatch while its primary fence is active. */
  #concurrentReaderDispatchClaimed = false;

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

  private async assertSpendWithinCap(): Promise<number> {
    const spend = await this.#options.spendSnapshotUsd();
    if (!Number.isFinite(spend) || spend < 0) {
      throw new RunPodControlError("RUNPOD_SPEND_SNAPSHOT_INVALID");
    }
    if (spend > this.#options.finiteSpendCapUsd) {
      throw new RunPodControlError("RUNPOD_FINITE_SPEND_CAP_EXCEEDED");
    }
    return spend;
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
  ): boolean {
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
    const exactStrings = (value: unknown, expected: readonly string[]): boolean =>
      Array.isArray(value) &&
      value.length === expected.length &&
      value.every((entry, index) => entry === expected[index]);
    return (
      resource.name === this.#options.endpointName &&
      resource.raw.templateId === templateId &&
      resource.raw.computeType === "GPU" &&
      resource.raw.workersMin === 0 &&
      resource.raw.workersMax === this.#options.initialPolicy.workersMax &&
      resource.raw.gpuCount === 1 &&
      exactStrings(resource.raw.gpuTypeIds, [V207_RUNPOD_GPU]) &&
      volumeBindingMatches &&
      exactStrings(resource.raw.dataCenterIds, [V207_RUNPOD_REGION]) &&
      exactStrings(resource.raw.allowedCudaVersions, [V207_RUNPOD_MIN_CUDA_VERSION]) &&
      resource.raw.minCudaVersion === V207_RUNPOD_MIN_CUDA_VERSION &&
      resource.raw.flashboot === false &&
      resource.raw.idleTimeout === this.#options.initialPolicy.idleTimeout &&
      resource.raw.executionTimeoutMs === this.#options.initialPolicy.executionTimeoutMs &&
      resource.raw.scalerType === "REQUEST_COUNT" &&
      resource.raw.scalerValue === 1
    );
  }

  /**
   * Recover a create mutation whose response was ambiguous. Only a unique, exact-name resource
   * with the complete intended identity may be drained/deleted; unknown or drifted resources are
   * deliberately left untouched and reported as uncertain.
   */
  private async reconcileAmbiguousCreate(): Promise<void> {
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
      });
      await this.#jobs.confirmDrained();
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
  }

  async create(): Promise<void> {
    if (this.#endpoint || this.#template) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_ALREADY_CREATED");
    }
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
    try {
      this.#template = await this.#options.control.createServerlessTemplate(
        this.#options.templateName,
        this.#options.imageName,
        this.#options.containerDiskInGb,
        this.#options.templateEnvironment,
        true,
      );
      console.error("v207:harness-template-created");
      this.mark("template_created", { template_id_hash: this.#template!.idHash });
      this.#endpoint = await this.#options.control.createScaleZeroEndpoint(
        this.#options.endpointName,
        this.#template!.id,
        ["NVIDIA GeForce RTX 4090"],
        this.#options.initialPolicy,
        this.#options.placement,
        true,
      );
      console.error("v207:harness-endpoint-created");
      this.#jobs = new RunPodServerlessJobClient({
        apiKey: this.#options.apiKey,
        endpointId: this.#endpoint!.id,
        guard: this.#guard,
        fetch: this.#options.fetch,
        baseUrl: this.#options.baseUrl,
      });
      // Endpoint creation is the first live provider state. Mark it active before accepting
      // the provider's ready-idle baseline; the drain guard otherwise rejects a valid baseline
      // as an impossible transition and waits forever for zero workers.
      this.#guard.markActive();
      try {
        // RunPod can briefly expose a ready-idle worker at endpoint creation even with
        // workersMin=0. Capture that queue-empty baseline immediately; waiting for strict zero
        // first can let the provider recycle the worker back into throttled startup.
        await this.#jobs!.confirmWarmIdle(300, 250);
        console.error("v207:harness-warm-idle");
        this.mark("provider_warm_idle_baseline");
      } catch (error) {
        if (
          !(error instanceof RunPodControlError) ||
          error.code !== "RUNPOD_WARM_IDLE_NOT_CONFIRMED"
        ) {
          throw error;
        }
        await this.#jobs!.confirmDrained(90);
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
          flashboot: false,
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
    } catch (error) {
      const needsResourceReconciliation =
        error instanceof RunPodControlError &&
        [
          "RUNPOD_MUTATION_AMBIGUOUS",
          "RUNPOD_RESPONSE_INVALID",
          "RUNPOD_SCALE_ZERO_UNCONFIRMED",
        ].includes(error.code);
      if (needsResourceReconciliation) {
        try {
          await this.reconcileAmbiguousCreate();
        } catch (reconciliationError) {
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
      // A failed endpoint create can leave disposable resources. Never delete the retained model
      // volume here: it is intentionally outside this harness's mutation surface.
      if (this.#endpoint && this.#jobs) {
        try {
          await this.#jobs.confirmDrained();
          await this.#options.control.deleteEndpoint(this.#endpoint.id, this.#guard);
        } catch {
          this.mark("endpoint_cleanup_uncertain");
        }
      }
      if (this.#template) {
        try {
          await this.#options.control.deleteTemplate(this.#template!.id);
        } catch {
          this.mark("template_cleanup_uncertain");
        }
      }
      throw error;
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
    this.assertCreated();
    this.assertPrimaryDispatchAllowed();
    if (!ID.test(input.requestKey) || !ID.test(input.attemptId)) {
      throw new RunPodControlError("RUNPOD_QUALIFICATION_ATTEMPT_INVALID");
    }
    const batch = asRecord(input.input.batch);
    const envelope = asRecord(input.input.envelope);
    const artifacts = asRecord(envelope?.artifacts);
    const itemCount = Array.isArray(batch?.items) ? batch.items.length : null;
    const outputPrefix = artifacts?.output_prefix ?? input.outputAuthority.outputPrefix;
    const reservationIds = artifacts?.transfer_port_reservation_ids;
    const inputPorts = input.inputPorts ?? [];
    const inputGetUrls = input.inputGetUrls ?? [];
    if (
      itemCount === null ||
      typeof outputPrefix !== "string" ||
      !Array.isArray(reservationIds) ||
      reservationIds.some((value) => typeof value !== "string") ||
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
    assertAuthority(input.outputAuthority, {
      attemptId: input.attemptId,
      itemCount,
      outputPrefix,
      reservationIds: reservationIds as readonly string[],
    });
    const request = jsonValue({
      ...input.input,
      ports: {
        inputs: inputPorts,
        outputs: [],
      },
      input_get_urls: inputGetUrls,
      generated_output_authorities: input.outputAuthority.authorities,
      output_put_urls: input.outputAuthority.outputPutUrls,
    });
    await this.assertSpendWithinCap();
    const job = await this.#jobs!.dispatch(input.requestKey, request);
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
      await this.assertSpendWithinCap();
      latest = await this.#jobs!.status(jobId);
      this.mark("job_status", {
        job_id_hash: latest.idHash,
        status: latest.status,
        delay_time_ms: latest.delayTimeMs,
        execution_time_ms: latest.executionTimeMs,
        ...(latest.error === undefined ? {} : { provider_error_present: true }),
      });
      if (TERMINAL_STATUSES.has(latest.status)) return latest;
      if (poll + 1 < maxPolls) await sleep(this.#options.pollIntervalMs ?? 15_000);
    }
    throw new RunPodControlError("RUNPOD_QUALIFICATION_RECONCILIATION_TIMEOUT");
  }

  /** Capture only the provider's bounded status tuple after a terminal failure. */
  async diagnostic(jobId: string): Promise<RunPodJobDiagnostic> {
    this.assertCreated();
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.#jobs!.diagnostic(jobId);
    this.mark("job_diagnostic", { job_id_hash: sha256(jobId), ...value });
    return value;
  }

  async confirmWarmIdle(): Promise<void> {
    this.assertCreated();
    if (this.#guard.snapshot() !== "active" && this.#guard.snapshot() !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_WARM_IDLE_NOT_ALLOWED");
    }
    await this.#jobs!.confirmWarmIdle(300, 250);
    this.mark("warm_idle_confirmed");
  }

  async cancel(jobId: string): Promise<RunPodJobResult> {
    this.assertCreated();
    if (this.#concurrentReaderFence) {
      throw new RunPodControlError("RUNPOD_CONCURRENT_READER_FENCE_ACTIVE");
    }
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    if (this.#guard.snapshot() === "active" || this.#guard.snapshot() === "warm_idle") {
      this.#guard.beginDrain();
    }
    const result = await this.#jobs!.cancel(jobId);
    this.mark("job_cancelled", { job_id_hash: result.idHash });
    return result;
  }

  async applyConcurrentReaderPolicy(): Promise<string> {
    this.assertCreated();
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
    if (this.#guard.snapshot() === "active") await this.#jobs!.confirmWarmIdle();
    await this.assertSpendWithinCap();
    await this.#options.control.enforceV207EndpointPolicy(
      this.#endpoint!.id,
      this.#template!.id,
      this.#options.concurrentReaderPolicy,
      this.#options.placement,
      this.#guard,
    );
    await this.assertSpendWithinCap();
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
        flashboot: false,
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
    // Claim the one allowed reader dispatch before the first asynchronous cap read. This keeps a
    // third caller out during preflight; the primary fence remains until drain proves zero.
    this.#concurrentReaderDispatchClaimed = true;
    // Check each reader before any /run request. A single shared check would allow the second
    // reader to enter after a concurrent billing read crossed the approved finite cap.
    try {
      await this.assertSpendWithinCap();
      await this.assertSpendWithinCap();
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
      });
      this.#readerJobs.push(client);
      return client;
    }) as [RunPodServerlessJobClient, RunPodServerlessJobClient];
    const results = await Promise.all(
      inputs.map((input, index) => {
        const batch = asRecord(input.input.batch);
        const itemCount = Array.isArray(batch?.items) ? batch.items.length : 0;
        const authority = input.outputAuthority;
        const inputPorts = input.inputPorts ?? [];
        const inputGetUrls = input.inputGetUrls ?? [];
        const envelope = asRecord(input.input.envelope);
        const artifacts = asRecord(envelope?.artifacts);
        const reservationIds = artifacts?.transfer_port_reservation_ids;
        if (
          !Array.isArray(reservationIds) ||
          reservationIds.some((value) => typeof value !== "string")
        ) {
          throw new RunPodControlError("RUNPOD_OUTPUT_AUTHORITY_INVALID");
        }
        assertAuthority(authority, {
          attemptId: input.attemptId,
          itemCount,
          outputPrefix:
            typeof artifacts?.output_prefix === "string"
              ? artifacts.output_prefix
              : authority.outputPrefix,
          reservationIds: reservationIds as readonly string[],
        });
        if (
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
          throw new RunPodControlError("RUNPOD_INPUT_URLS_INVALID");
        }
        const request = jsonValue({
          ...input.input,
          ports: { inputs: inputPorts, outputs: [] },
          input_get_urls: inputGetUrls,
          generated_output_authorities: authority.authorities,
          output_put_urls: authority.outputPutUrls,
        });
        return clients[index]!.dispatch(input.requestKey, request);
      }),
    );
    await this.assertSpendWithinCap();
    const first = results[0]!;
    const second = results[1]!;
    this.mark("two_concurrent_readers_dispatched", {
      job_id_hashes: [first.idHash, second.idHash],
    });
    return [first, second];
  }

  async reconcileConcurrentReaders(
    jobIds: readonly [string, string],
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
    await this.assertSpendWithinCap();
    await this.assertSpendWithinCap();
    const maxPolls = this.#options.maxPolls ?? 120;
    const sleep =
      this.#options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    const reconcile = async (client: RunPodServerlessJobClient, jobId: string) => {
      let latest: RunPodJobResult | null = null;
      for (let poll = 0; poll < maxPolls; poll += 1) {
        await this.assertSpendWithinCap();
        latest = await client.status(jobId);
        this.mark("concurrent_reader_job_status", {
          job_id_hash: latest.idHash,
          status: latest.status,
          delay_time_ms: latest.delayTimeMs,
          execution_time_ms: latest.executionTimeMs,
          ...(latest.error === undefined ? {} : { provider_error_present: true }),
        });
        if (TERMINAL_STATUSES.has(latest.status)) return latest;
        if (poll + 1 < maxPolls) await sleep(this.#options.pollIntervalMs ?? 15_000);
      }
      throw new RunPodControlError("RUNPOD_QUALIFICATION_RECONCILIATION_TIMEOUT");
    };
    const results = await Promise.all([
      reconcile(this.#readerJobs[0]!, jobIds[0]),
      reconcile(this.#readerJobs[1]!, jobIds[1]),
    ]);
    await this.assertSpendWithinCap();
    return [results[0]!, results[1]!];
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
        throw new RunPodControlError("RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN");
      }
    }
    await this.#jobs!.confirmDrained();
    this.#readerJobs.length = 0;
    this.#concurrentReaderDispatchClaimed = false;
    this.#concurrentReaderFence = false;
    this.mark("workers_zero_confirmed");
  }

  async scaleDownToInitial(): Promise<void> {
    this.assertCreated();
    await this.drain();
    await this.assertSpendWithinCap();
    await this.#options.control.enforceV207EndpointPolicy(
      this.#endpoint!.id,
      this.#template!.id,
      this.#options.initialPolicy,
      this.#options.placement,
      this.#guard,
    );
    this.mark("scaled_down_to_max_one");
  }

  /** Retains endpoint/template/volumes by default; deletes only disposable resources on failure. */
  async cleanup(options: {
    readonly deleteIfFailed: boolean;
    readonly failed: boolean;
  }): Promise<void> {
    if (!this.#endpoint || !this.#jobs || !this.#template) return;
    if (
      this.#concurrentReaderFence ||
      this.#readerJobs.length > 0 ||
      ["active", "warm_idle", "draining", "queue_empty"].includes(this.#guard.snapshot())
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
