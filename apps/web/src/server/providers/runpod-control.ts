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
    readonly activeWorkerCount: number;
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
  private state: "unknown" | "active" | "draining" | "zero" = "unknown";

  markActive(): void {
    this.state = "active";
  }

  beginDrain(): void {
    if (this.state !== "active") throw new RunPodControlError("RUNPOD_DRAIN_STATE_INVALID");
    this.state = "draining";
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

  assertDispatchAllowed(): void {
    if (this.state !== "zero") throw new RunPodControlError("RUNPOD_DISPATCH_BLOCKED");
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
          env: {},
          imageName,
          isPublic: false,
          isServerless: true,
          name,
          ports: [],
          readme: "VideoForge pinned AvatarForcing worker",
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
  ): Promise<RunPodResourceIdentity> {
    assertRunPodEndpointPolicy(policy);
    if (!ID.test(name) || !ID.test(templateId) || gpuTypeIds.length < 1 || gpuTypeIds.length > 2) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
    }
    if (gpuTypeIds.some((gpu) => typeof gpu !== "string" || gpu.length > 100)) {
      throw new RunPodControlError("RUNPOD_ENDPOINT_INPUT_INVALID");
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

  async deleteEndpoint(endpointId: string, guard: RunPodDrainGuard): Promise<void> {
    if (!ID.test(endpointId)) throw new RunPodControlError("RUNPOD_ENDPOINT_ID_INVALID");
    guard.assertDispatchAllowed();
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
      return Object.freeze({
        idHash: hashId(endpoint.id),
        workersMin,
        workersMax,
        activeWorkerCount: workers.length,
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
      activeServerlessWorkerCount: endpoints.reduce(
        (total, endpoint) => total + endpoint.activeWorkerCount,
        0,
      ),
    });
  }
}

export interface RunPodJobResult {
  readonly idHash: string;
  readonly status: string;
}

export interface RunPodServerlessJobClientOptions {
  readonly apiKey: string;
  readonly endpointId: string;
  readonly guard: RunPodDrainGuard;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export class RunPodServerlessJobClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
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
  }

  private async request(method: "GET" | "POST", path: string, body?: string): Promise<JsonRecord> {
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
      throw new RunPodControlError("RUNPOD_MUTATION_AMBIGUOUS");
    }
    if (!response.ok) {
      throw new RunPodControlError(
        response.status === 401 || response.status === 403
          ? "RUNPOD_AUTH_REJECTED"
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
    const pending = this.request("POST", "/run", inputBytes).then((value) => {
      if (typeof value.id !== "string" || !ID.test(value.id) || typeof value.status !== "string") {
        throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
      }
      return Object.freeze({ idHash: hashId(value.id), status: value.status });
    });
    this.replays.set(requestHash, pending);
    return pending;
  }

  async status(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.request("GET", `/status/${jobId}`);
    if (typeof value.id !== "string" || !ID.test(value.id) || typeof value.status !== "string") {
      throw new RunPodControlError("RUNPOD_RESPONSE_INVALID");
    }
    return Object.freeze({ idHash: hashId(value.id), status: value.status });
  }

  async cancel(jobId: string): Promise<RunPodJobResult> {
    if (!ID.test(jobId)) throw new RunPodControlError("RUNPOD_JOB_ID_INVALID");
    const value = await this.request("POST", `/cancel/${jobId}`);
    if (typeof value.id !== "string" || !ID.test(value.id) || value.status !== "CANCELLED") {
      throw new RunPodControlError("RUNPOD_CANCEL_UNCONFIRMED");
    }
    return Object.freeze({ idHash: hashId(value.id), status: value.status });
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
}
