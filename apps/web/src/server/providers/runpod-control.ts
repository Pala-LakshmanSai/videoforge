import { createHash } from "node:crypto";

import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

const DEFAULT_BASE_URL = "https://rest.runpod.io/v1";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Readonly<Record<string, unknown>>;

export interface RunPodEndpointPolicy {
  readonly workersMin: 0;
  readonly workersMax: 1;
  readonly gpuCount: 1;
  readonly idleTimeout: number;
  readonly executionTimeoutMs: number;
}

export interface RunPodInventory {
  readonly checkedAt: string;
  readonly pods: readonly {
    readonly idHash: string;
    readonly desiredStatus: string;
    readonly endpointWorker: boolean;
    readonly costPerHourUsd: number | null;
  }[];
  readonly endpoints: readonly {
    readonly idHash: string;
    readonly workersMin: number | null;
    readonly workersMax: number | null;
    readonly workerRecordCount: number;
    readonly activeWorkerCount: number;
    readonly exitedWorkerCount: number;
    readonly workerStatuses: readonly string[];
    readonly scaleZeroCompliant: boolean;
  }[];
  readonly privateTemplateCount: number;
  readonly networkVolumes: readonly { readonly idHash: string; readonly sizeGb: number | null }[];
  readonly runningPodCount: number;
  readonly activeServerlessWorkerCount: number;
}

export interface RunPodResourceIdentity {
  readonly id: string;
  readonly idHash: string;
}

export class RunPodControlError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RunPodControlError";
  }
}

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const numberOrNull = (value: unknown): number | null => {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
};

const hashId = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

export function assertRunPodEndpointPolicy(value: RunPodEndpointPolicy): void {
  if (
    value.workersMin !== 0 ||
    value.workersMax !== 1 ||
    value.gpuCount !== 1 ||
    !Number.isSafeInteger(value.idleTimeout) ||
    value.idleTimeout < 1 ||
    value.idleTimeout > 60 ||
    !Number.isSafeInteger(value.executionTimeoutMs) ||
    value.executionTimeoutMs < 1_000 ||
    value.executionTimeoutMs > 3_600_000
  ) {
    throw new RunPodControlError("RUNPOD_SCALE_ZERO_POLICY_INVALID");
  }
}

export class RunPodDrainGuard {
  private state: "unknown" | "active" | "warm_idle" | "draining" | "queue_empty" | "zero" =
    "unknown";

  markActive(): void {
    this.state = "active";
  }

  beginDrain(): void {
    if (this.state !== "active" && this.state !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_DRAIN_STATE_INVALID");
    }
    this.state = "draining";
  }

  confirmWarmIdle(
    idleWorkerCount: number,
    runningWorkerCount: number,
    queuedJobCount: number,
  ): void {
    if (
      this.state !== "active" ||
      !Number.isSafeInteger(idleWorkerCount) ||
      !Number.isSafeInteger(runningWorkerCount) ||
      !Number.isSafeInteger(queuedJobCount) ||
      idleWorkerCount < 0 ||
      idleWorkerCount > 1 ||
      runningWorkerCount !== 0 ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_WARM_IDLE_NOT_CONFIRMED");
    }
    this.state = "warm_idle";
  }

  confirmZero(activeWorkerCount: number, queuedJobCount: number): void {
    if (
      !Number.isSafeInteger(activeWorkerCount) ||
      !Number.isSafeInteger(queuedJobCount) ||
      activeWorkerCount !== 0 ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_ZERO_NOT_CONFIRMED");
    }
    this.state = "zero";
  }

  confirmQueueEmpty(queuedJobCount: number): void {
    if (
      this.state !== "draining" ||
      !Number.isSafeInteger(queuedJobCount) ||
      queuedJobCount !== 0
    ) {
      this.state = "unknown";
      throw new RunPodControlError("RUNPOD_QUEUE_NOT_DRAINED");
    }
    this.state = "queue_empty";
  }

  assertDispatchAllowed(): void {
    if (this.state !== "zero" && this.state !== "warm_idle") {
      throw new RunPodControlError("RUNPOD_DISPATCH_BLOCKED");
    }
  }

  assertTerminationAllowed(): void {
    if (this.state !== "queue_empty" && this.state !== "zero") {
      throw new RunPodControlError("RUNPOD_TERMINATION_BLOCKED");
    }
  }

  snapshot(): string {
    return this.state;
  }
}

export interface RunPodControlClientOptions {
  readonly apiKey: string;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export class RunPodControlClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: RunPodControlClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunPodControlError("RUNPOD_AUTH_INVALID");
    }
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (this.baseUrl !== DEFAULT_BASE_URL && !this.baseUrl.startsWith("http://127.0.0.1:")) {
      throw new RunPodControlError("RUNPOD_BASE_URL_INVALID");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RunPodControlError("RUNPOD_TIMEOUT_INVALID");
    }
  }

  private async read(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError("RUNPOD_READ_AMBIGUOUS");
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
          : "RUNPOD_READ_FAILED",
      );
    }
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  private async mutate(method: "POST" | "DELETE", path: string, body?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError("RUNPOD_MUTATION_AMBIGUOUS");
    }
    if (!response.ok) throw new RunPodControlError("RUNPOD_MUTATION_FAILED");
    if (response.status === 204) return null;
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  async enforceEndpointPolicy(
    endpointId: string,
    policy: RunPodEndpointPolicy,
    guard: RunPodDrainGuard,
  ): Promise<void> {
    if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    assertRunPodEndpointPolicy(policy);
    guard.assertDispatchAllowed();
    const value = record(
      await this.mutate("POST", `/endpoints/${endpointId}/update`, canonicalizeJson(policy)),
    );
    if (!value || value.id !== endpointId || value.workersMin !== 0 || value.workersMax !== 1) {
      throw new RunPodControlError("RUNPOD_SCALE_ZERO_UNCONFIRMED");
    }
  }

  async createServerlessTemplate(
    name: string,
    imageName: string,
    containerDiskInGb: number,
    environment: Readonly<Record<string, string>> = {},
  ): Promise<RunPodResourceIdentity> {
    if (!ID.test(name) || !/^[a-z0-9./:_-]+@[a-z0-9:+._-]+$/u.test(imageName)) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_INPUT_INVALID");
    }
    if (
      !Number.isSafeInteger(containerDiskInGb) ||
      containerDiskInGb < 80 ||
      containerDiskInGb > 120
    ) {
      throw new RunPodControlError("RUNPOD_TEMPLATE_DISK_INVALID");
    }
    const value = record(
      await this.mutate(
        "POST",
        "/templates",
        canonicalizeJson({
          category: "NVIDIA",
          containerDiskInGb,
          dockerEntrypoint: [],
          dockerStartCmd: [],
          env: { LOG_LEVEL: "INFO", RUNPOD_INIT_TIMEOUT: "800", ...environment },
          imageName,
          isPublic: false,
          isServerless: true,
          name,
          ports: [],
          readme: "VideoForge pinned primary avatar worker",
          volumeInGb: 0,
          volumeMountPath: "/models",
        }),
      ),
    );
    if (!value || typeof value.id !== "string" || !ID.test(value.id)) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  async createScaleZeroEndpoint(
    name: string,
    templateId: string,
    gpuTypeIds: readonly string[],
    policy: RunPodEndpointPolicy,
    placement: {
      readonly networkVolumeId?: string;
      readonly dataCenterIds?: readonly string[];
    } = {},
  ): Promise<RunPodResourceIdentity> {
    assertRunPodEndpointPolicy(policy);
    if (!ID.test(name) || !ID.test(templateId) || gpuTypeIds.length < 1 || gpuTypeIds.length > 2) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
    }
    if (gpuTypeIds.some((gpu) => typeof gpu !== "string" || gpu.length > 100)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
    }
    if (
      (placement.networkVolumeId !== undefined && !ID.test(placement.networkVolumeId)) ||
      (placement.dataCenterIds !== undefined &&
        (placement.dataCenterIds.length !== 1 || !ID.test(placement.dataCenterIds[0] ?? "")))
    ) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_PLACEMENT_INVALID");
    }
    const value = record(
      await this.mutate(
        "POST",
        "/endpoints",
        canonicalizeJson({
          computeType: "GPU",
          executionTimeoutMs: policy.executionTimeoutMs,
          flashboot: true,
          gpuCount: policy.gpuCount,
          gpuTypeIds,
          idleTimeout: policy.idleTimeout,
          name,
          ...(placement.networkVolumeId ? { networkVolumeId: placement.networkVolumeId } : {}),
          ...(placement.dataCenterIds ? { dataCenterIds: placement.dataCenterIds } : {}),
          scalerType: "QUEUE_DELAY",
          scalerValue: 1,
          templateId,
          workersMax: policy.workersMax,
          workersMin: policy.workersMin,
        }),
      ),
    );
    if (
      !value ||
      typeof value.id !== "string" ||
      !ID.test(value.id) ||
      value.workersMin !== 0 ||
      value.workersMax !== 1
    ) {
      throw new RunPodControlError("RUNPOD_SCALE_ZERO_UNCONFIRMED");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  async createNetworkVolume(
    name: string,
    sizeGb: number,
    dataCenterId: string,
  ): Promise<RunPodResourceIdentity> {
    if (
      !ID.test(name) ||
      !ID.test(dataCenterId) ||
      !Number.isSafeInteger(sizeGb) ||
      sizeGb !== 50
    ) {
      throw new RunPodControlError("RUNPOD_NETWORK_VOLUME_INPUT_INVALID");
    }
    const value = record(
      await this.mutate(
        "POST",
        "/networkvolumes",
        canonicalizeJson({ dataCenterId, name, size: sizeGb }),
      ),
    );
    if (!value || typeof value.id !== "string" || !ID.test(value.id)) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    return Object.freeze({ id: value.id, idHash: hashId(value.id) });
  }

  async deleteNetworkVolume(volumeId: string): Promise<void> {
    if (!ID.test(volumeId)) throw new RunPodControlError("RUNPOD_NETWORK_VOLUME_ID_INVALID");
    await this.mutate("DELETE", `/networkvolumes/${volumeId}`);
  }

  async deleteEndpoint(endpointId: string, guard: RunPodDrainGuard): Promise<void> {
    if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    guard.assertTerminationAllowed();
    await this.mutate("DELETE", `/endpoints/${endpointId}`);
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (!ID.test(templateId)) throw new RunPodControlError("RUNPOD_TEMPLATE_ID_INVALID");
    await this.mutate("DELETE", `/templates/${templateId}`);
  }

  async inventory(now = new Date()): Promise<RunPodInventory> {
    if (!Number.isFinite(now.getTime())) throw new RunPodControlError("RUNPOD_CLOCK_INVALID");
    const [podValue, endpointValue, templateValue, volumeValue] = await Promise.all([
      this.read("/pods?includeWorkers=true"),
      this.read("/endpoints?includeTemplate=true&includeWorkers=true"),
      this.read("/templates?includeEndpointBoundTemplates=true"),
      this.read("/networkvolumes"),
    ]);
    if (
      !Array.isArray(podValue) ||
      !Array.isArray(endpointValue) ||
      !Array.isArray(templateValue) ||
      !Array.isArray(volumeValue)
    ) {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    const pods = podValue.map(record).map((pod) => {
      if (!pod || typeof pod.id !== "string" || !ID.test(pod.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      return Object.freeze({
        idHash: hashId(pod.id),
        desiredStatus: typeof pod.desiredStatus === "string" ? pod.desiredStatus : "UNKNOWN",
        endpointWorker: typeof pod.endpointId === "string" && pod.endpointId.length > 0,
        costPerHourUsd: numberOrNull(pod.adjustedCostPerHr ?? pod.costPerHr),
      });
    });
    const endpoints = endpointValue.map(record).map((endpoint) => {
      if (!endpoint || typeof endpoint.id !== "string" || !ID.test(endpoint.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      const workersMin = numberOrNull(endpoint.workersMin);
      const workersMax = numberOrNull(endpoint.workersMax);
      const workers = Array.isArray(endpoint.workers) ? endpoint.workers : [];
      const workerStatuses = workers.map((worker) => {
        const value = record(worker);
        return typeof value?.desiredStatus === "string"
          ? value.desiredStatus
          : typeof value?.status === "string"
            ? value.status
            : "UNKNOWN";
      });
      return Object.freeze({
        idHash: hashId(endpoint.id),
        workersMin,
        workersMax,
        workerRecordCount: workers.length,
        activeWorkerCount: workerStatuses.filter((status) => status === "RUNNING").length,
        exitedWorkerCount: workerStatuses.filter(
          (status) => status === "EXITED" || status === "TERMINATED",
        ).length,
        workerStatuses: Object.freeze(workerStatuses),
        scaleZeroCompliant: workersMin === 0 && workersMax === 1,
      });
    });
    const networkVolumes = volumeValue.map(record).map((volume) => {
      if (!volume || typeof volume.id !== "string" || !ID.test(volume.id)) {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      return Object.freeze({ idHash: hashId(volume.id), sizeGb: numberOrNull(volume.size) });
    });
    return Object.freeze({
      checkedAt: now.toISOString(),
      pods: Object.freeze(pods),
      endpoints: Object.freeze(endpoints),
      privateTemplateCount: templateValue.length,
      networkVolumes: Object.freeze(networkVolumes),
      runningPodCount: pods.filter((pod) => pod.desiredStatus === "RUNNING").length,
      activeServerlessWorkerCount: pods.filter(
        (pod) => pod.endpointWorker && pod.desiredStatus === "RUNNING",
      ).length,
    });
  }
}

export interface RunPodJobResult {
  readonly id: string;
  readonly idHash: string;
  readonly status: string;
  readonly output?: unknown;
  readonly progress?: unknown;
  readonly executionTimeMs: number | null;
  readonly delayTimeMs: number | null;
}

const jobResult = (value: JsonRecord): RunPodJobResult => {
  if (typeof value.id !== "string" || !ID.test(value.id) || typeof value.status !== "string") {
    throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
  }
  return Object.freeze({
    id: value.id,
    idHash: hashId(value.id),
    status: value.status,
    ...(Object.hasOwn(value, "output") ? { output: value.output } : {}),
    ...(Object.hasOwn(value, "progress") ? { progress: value.progress } : {}),
    executionTimeMs: numberOrNull(value.executionTime),
    delayTimeMs: numberOrNull(value.delayTime),
  });
};

export interface RunPodServerlessJobClientOptions {
  readonly apiKey: string;
  readonly endpointId: string;
  readonly guard: RunPodDrainGuard;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly readRetryDelaysMs?: readonly number[];
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly signal?: AbortSignal;
}

export class RunPodServerlessJobClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly readRetryDelaysMs: readonly number[];
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly replays = new Map<string, Promise<RunPodJobResult>>();

  constructor(private readonly options: RunPodServerlessJobClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunPodControlError("RUNPOD_AUTH_INVALID");
    }
    if (!ID.test(options.endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.runpod.ai/v2";
    if (
      this.baseUrl !== "https://api.runpod.ai/v2" &&
      !this.baseUrl.startsWith("http://127.0.0.1:")
    ) {
      throw new RunPodControlError("RUNPOD_BASE_URL_INVALID");
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.readRetryDelaysMs = Object.freeze([...(options.readRetryDelaysMs ?? [250, 1_000, 2_000])]);
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (
      this.readRetryDelaysMs.length > 4 ||
      this.readRetryDelaysMs.some(
        (delay) => !Number.isSafeInteger(delay) || delay < 0 || delay > 10_000,
      )
    ) {
      throw new RunPodControlError("RUNPOD_READ_RETRY_POLICY_INVALID");
    }
  }

  private async requestOnce(
    method: "GET" | "POST",
    path: string,
    body?: string,
  ): Promise<JsonRecord> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}/${this.options.endpointId}${path}`, {
        method,
        headers: {
          authorization: this.options.apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodControlError(
        method === "GET" ? "RUNPOD_READ_AMBIGUOUS" : "RUNPOD_MUTATION_AMBIGUOUS",
      );
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
          : method === "GET"
            ? "RUNPOD_READ_FAILED"
            : "RUNPOD_MUTATION_FAILED",
      );
    }
    try {
      const value = record(JSON.parse(await response.text()));
      if (!value) throw new Error("invalid");
      return value;
    } catch {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  private async request(method: "GET" | "POST", path: string, body?: string): Promise<JsonRecord> {
    if (method === "POST") return this.requestOnce(method, path, body);
    for (let attempt = 0; ; attempt += 1) {
      if (this.options.signal?.aborted) {
        throw new RunPodControlError("RUNPOD_READ_ABORTED");
      }
      try {
        return await this.requestOnce(method, path, body);
      } catch (error) {
        const retryable =
          error instanceof RunPodControlError &&
          (error.code === "RUNPOD_READ_AMBIGUOUS" || error.code === "RUNPOD_READ_FAILED");
        if (!retryable || attempt >= this.readRetryDelaysMs.length) throw error;
        await this.sleep(this.readRetryDelaysMs[attempt]!);
      }
    }
  }

  dispatch(requestKey: string, input: JsonValue): Promise<RunPodJobResult> {
    if (!ID.test(requestKey)) throw new RunPodControlError("RUNPOD_REQUEST_KEY_INVALID");
    const inputBytes = canonicalizeJson({ input });
    if (Buffer.byteLength(inputBytes, "utf8") > 10 * 1024 * 1024) {
      throw new RunPodControlError("RUNPOD_REQUEST_TOO_LARGE");
    }
    const requestHash = hashId(`${requestKey}:${inputBytes}`);
    const replay = this.replays.get(requestHash);
    if (replay) return replay;
    this.options.guard.assertDispatchAllowed();
    this.options.guard.markActive();
    const pending = this.request("POST", "/run", inputBytes).then(jobResult);
    this.replays.set(requestHash, pending);
    return pending;
  }

  async status(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    return jobResult(await this.request("GET", `/status/${jobId}`));
  }

  async cancel(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.request("POST", `/cancel/${jobId}`);
    if (value.status !== "CANCELLED") {
      throw new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED");
    }
    return jobResult(value);
  }

  async confirmDrained(): Promise<void> {
    const value = await this.request("GET", "/health");
    const workers = record(value.workers);
    const jobs = record(value.jobs);
    const activeWorkers =
      (numberOrNull(workers?.idle) ?? Number.NaN) + (numberOrNull(workers?.running) ?? Number.NaN);
    const queuedJobs =
      (numberOrNull(jobs?.inQueue) ?? Number.NaN) + (numberOrNull(jobs?.inProgress) ?? Number.NaN);
    this.options.guard.confirmZero(activeWorkers, queuedJobs);
  }

  async confirmWarmIdle(maxAttempts = 30): Promise<void> {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 60) {
      throw new RunPodControlError("RUNPOD_WARM_IDLE_POLICY_INVALID");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const value = await this.request("GET", "/health");
      const workers = record(value.workers);
      const jobs = record(value.jobs);
      const idle = numberOrNull(workers?.idle) ?? Number.NaN;
      const running = numberOrNull(workers?.running) ?? Number.NaN;
      const queued =
        (numberOrNull(jobs?.inQueue) ?? Number.NaN) +
        (numberOrNull(jobs?.inProgress) ?? Number.NaN);
      if (Number.isSafeInteger(idle) && idle <= 1 && running === 0 && queued === 0) {
        this.options.guard.confirmWarmIdle(idle, running, queued);
        return;
      }
      if (attempt + 1 < maxAttempts) await this.sleep(2_000);
    }
    this.options.guard.confirmWarmIdle(Number.NaN, Number.NaN, Number.NaN);
  }

  async confirmQueueEmpty(): Promise<void> {
    const value = await this.request("GET", "/health");
    const jobs = record(value.jobs);
    const queuedJobs =
      (numberOrNull(jobs?.inQueue) ?? Number.NaN) + (numberOrNull(jobs?.inProgress) ?? Number.NaN);
    this.options.guard.confirmQueueEmpty(queuedJobs);
  }
}
