import { createHash } from "node:crypto";

import { canonicalizeJson } from "@videoforge/contracts";

const DEFAULT_BASE_URL = "https://rest.runpod.io/v1";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const IMAGE = /^ghcr\.io\/pala-lakshmansai\/videoforge-mage-cp06@sha256:[a-f0-9]{64}$/u;

export const CP06_MAGE_DATA_CENTER_ID = "EU-RO-1" as const;
export const CP06_MAGE_GPU_TYPE_ID = "NVIDIA GeForce RTX 4090" as const;
export const CP06_MAGE_GPU_RATE_CEILING_USD_PER_HOUR = 0.74 as const;
export const CP06_MAGE_NETWORK_VOLUME_SIZE_GB = 50 as const;
export const CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH = "/workspace" as const;
export const CP06_MAGE_HTTP_PORT = "8000/http" as const;
export const CP06_MAGE_PREP_CONFIRMATION = "DOWNLOAD_EXACT_VIDEOFORGE_MAGE_INT8" as const;
export const CP06_MAGE_MODEL_BYTES = 13_379_919_280 as const;
export const CP06_MAGE_WRONG_VOLUME_ID_HASH =
  "sha256:a839f325284d095ee1678b505e61a7fd31875ad8dd2677c544f16781f4ddf940" as const;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type JsonRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const numberOrNull = (value: unknown): number | null => {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
};

const hashId = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

const exactStringArray = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value) &&
  value.length === expected.length &&
  value.every((candidate, index) => candidate === expected[index]);

const exactStaticEnvironment = (value: unknown): boolean => {
  const environment = record(value);
  return (
    environment !== null &&
    Object.keys(environment).sort().join(",") ===
      "DIFFUSERS_OFFLINE,HF_HUB_OFFLINE,MAGE_MODEL_ROOT,TRANSFORMERS_OFFLINE" &&
    environment.HF_HUB_OFFLINE === "1" &&
    environment.TRANSFORMERS_OFFLINE === "1" &&
    environment.DIFFUSERS_OFFLINE === "1" &&
    environment.MAGE_MODEL_ROOT === "/workspace/mage-model"
  );
};

const exactKeys = (value: JsonRecord, expected: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...expected].sort().join(",");

const exactIsoTimestamp = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
};

const normalizeRunPodTimestamp = (value: unknown): string | null => {
  if (exactIsoTimestamp(value)) return value;
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) \+0000 UTC$/u.exec(value);
  if (match === null) return null;
  const normalized = `${match[1]}T${match[2]}Z`;
  return exactIsoTimestamp(normalized) ? normalized : null;
};

const providerNormalizedEnvironment = (value: unknown): JsonRecord | null => {
  const environment = record(value);
  if (environment === null) return null;
  const publicKey = environment.PUBLIC_KEY;
  if (
    publicKey !== undefined &&
    (typeof publicKey !== "string" ||
      publicKey.length < 1 ||
      publicKey.length > 65_536 ||
      /\0/u.test(publicKey))
  ) {
    return null;
  }
  const owned = { ...environment };
  delete owned.PUBLIC_KEY;
  return owned;
};

const staticEnvironment = Object.freeze({
  HF_HUB_OFFLINE: "1",
  TRANSFORMERS_OFFLINE: "1",
  DIFFUSERS_OFFLINE: "1",
  MAGE_MODEL_ROOT: "/workspace/mage-model",
});

const runtimeEnvironment = (
  imageDigest: string,
  volumeIdHash: string,
  workerToken: string,
): Readonly<Record<string, string>> => ({
  ...staticEnvironment,
  VIDEOFORGE_MAGE_VOLUME_ID_HASH: volumeIdHash,
  VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: imageDigest,
  VIDEOFORGE_MAGE_WORKER_TOKEN: workerToken,
  VIDEOFORGE_MAGE_GPU_OFFERING_ID: CP06_MAGE_GPU_TYPE_ID,
});

const prepEnvironment = (volumeId: string): Readonly<Record<string, string>> => ({
  ...staticEnvironment,
  VIDEOFORGE_MAGE_VOLUME_ID: volumeId,
  VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION: CP06_MAGE_PREP_CONFIRMATION,
});

const exactPrepEnvironment = (value: unknown, volumeId: string): boolean => {
  const environment = providerNormalizedEnvironment(value);
  return (
    environment !== null &&
    exactKeys(environment, [
      "DIFFUSERS_OFFLINE",
      "HF_HUB_OFFLINE",
      "MAGE_MODEL_ROOT",
      "TRANSFORMERS_OFFLINE",
      "VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION",
      "VIDEOFORGE_MAGE_VOLUME_ID",
    ]) &&
    environment.HF_HUB_OFFLINE === "1" &&
    environment.TRANSFORMERS_OFFLINE === "1" &&
    environment.DIFFUSERS_OFFLINE === "1" &&
    environment.MAGE_MODEL_ROOT === "/workspace/mage-model" &&
    environment.VIDEOFORGE_MAGE_DOWNLOAD_CONFIRMATION === CP06_MAGE_PREP_CONFIRMATION &&
    environment.VIDEOFORGE_MAGE_VOLUME_ID === volumeId
  );
};

const exactRuntimeEnvironment = (
  value: unknown,
  imageDigest: string,
  volumeIdHash: string,
  workerToken?: string,
): boolean => {
  const environment = providerNormalizedEnvironment(value);
  const observedToken = environment?.VIDEOFORGE_MAGE_WORKER_TOKEN;
  return (
    environment !== null &&
    Object.keys(environment).sort().join(",") ===
      "DIFFUSERS_OFFLINE,HF_HUB_OFFLINE,MAGE_MODEL_ROOT,TRANSFORMERS_OFFLINE,VIDEOFORGE_MAGE_GPU_OFFERING_ID,VIDEOFORGE_MAGE_VOLUME_ID_HASH,VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST,VIDEOFORGE_MAGE_WORKER_TOKEN" &&
    environment.HF_HUB_OFFLINE === "1" &&
    environment.TRANSFORMERS_OFFLINE === "1" &&
    environment.DIFFUSERS_OFFLINE === "1" &&
    environment.MAGE_MODEL_ROOT === "/workspace/mage-model" &&
    environment.VIDEOFORGE_MAGE_VOLUME_ID_HASH === volumeIdHash &&
    environment.VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST === imageDigest &&
    environment.VIDEOFORGE_MAGE_GPU_OFFERING_ID === CP06_MAGE_GPU_TYPE_ID &&
    typeof observedToken === "string" &&
    observedToken.length >= 32 &&
    observedToken.length <= 512 &&
    !/\s/u.test(observedToken) &&
    (workerToken === undefined || observedToken === workerToken)
  );
};

export class RunPodPodControlError extends Error {
  constructor(
    readonly code: string,
    readonly resourceId?: string,
    readonly resourceIds?: readonly string[],
    readonly providerStatus?: number,
    readonly providerMessage?: string,
  ) {
    super(code);
    this.name = "RunPodPodControlError";
  }
}

export interface RunPodPodControlClientOptions {
  readonly apiKey: string;
  readonly fetch?: FetchPort;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

export interface RunPodBoundedPollOptions {
  readonly maximumAttempts?: number;
  readonly intervalMs?: number;
}

export interface RunPodStableBillingOptions extends RunPodBoundedPollOptions {
  readonly requiredStableObservations?: number;
}

export interface RunPodPodResourceIdentity {
  readonly id: string;
  readonly idHash: `sha256:${string}`;
}

export interface RunPodMagePod extends RunPodPodResourceIdentity {
  readonly name: string;
  readonly templateId: string;
  readonly image: string;
  readonly networkVolumeIdHash: `sha256:${string}`;
  readonly dataCenterId: typeof CP06_MAGE_DATA_CENTER_ID;
  readonly gpuTypeId: typeof CP06_MAGE_GPU_TYPE_ID;
  readonly costPerHourUsd: number;
  readonly desiredStatus: "RUNNING" | "EXITED" | "TERMINATED";
  readonly lastStartedAt: string;
}

export interface RunPodMagePrepHealth {
  readonly phase: "starting" | "preparing" | "ready" | "failed";
  readonly prepared: boolean;
  readonly failureCode: string | null;
  readonly volumeIdHash: `sha256:${string}`;
  readonly modelBytes: typeof CP06_MAGE_MODEL_BYTES;
  readonly manifestSha256: `sha256:${string}` | null;
}

export interface RunPodMageNegativePod extends RunPodMagePod {
  readonly negativeKind: "MISSING_VOLUME" | "WRONG_VOLUME_HASH";
  readonly expectedWorkerError: "MAGE_VOLUME_MARKER_INVALID" | "MAGE_VOLUME_ID_MISMATCH";
}

export interface RunPodSettledPodBilling {
  readonly podIdHash: `sha256:${string}`;
  readonly recordCount: number;
  readonly amountUsd: number;
  readonly timeBilledMs: number;
  readonly startTime: string;
  readonly endTime: string;
}

export interface CreateRunPodMagePodInput {
  readonly name: string;
  readonly templateId: string;
  readonly imageDigest: string;
  readonly networkVolumeId: string;
  readonly networkVolumeIdHash: `sha256:${string}`;
  readonly workerToken: string;
}

export type CreateRunPodMagePrepPodInput = Omit<CreateRunPodMagePodInput, "workerToken">;

const prepEntrypoint = Object.freeze([
  "python",
  "/opt/videoforge/mage_prepare_service.py",
] as const);
const runtimeImageEntrypoint = Object.freeze([
  "python",
  "/opt/videoforge/mage-entrypoint.py",
] as const);
const prepStartCommand = Object.freeze([] as const);

const magePodBody = (
  authority: CreateRunPodMagePrepPodInput,
  environment: Readonly<Record<string, string>>,
  dockerEntrypoint: readonly string[],
  dockerStartCmd: readonly string[],
  attachNetworkVolume = true,
): Readonly<Record<string, unknown>> => ({
  allowedCudaVersions: ["13.0"],
  cloudType: "SECURE",
  computeType: "GPU",
  containerDiskInGb: 50,
  dataCenterIds: [CP06_MAGE_DATA_CENTER_ID],
  dataCenterPriority: "custom",
  dockerEntrypoint,
  dockerStartCmd,
  env: environment,
  globalNetworking: false,
  gpuCount: 1,
  gpuTypeIds: [CP06_MAGE_GPU_TYPE_ID],
  gpuTypePriority: "custom",
  imageName: authority.imageDigest,
  interruptible: false,
  locked: false,
  name: authority.name,
  ...(attachNetworkVolume ? { networkVolumeId: authority.networkVolumeId } : {}),
  ports: [CP06_MAGE_HTTP_PORT],
  supportPublicIp: false,
  templateId: authority.templateId,
  volumeInGb: 0,
  ...(attachNetworkVolume ? { volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH } : {}),
});

export class RunPodPodControlClient {
  private readonly fetch: FetchPort;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: RunPodPodControlClientOptions) {
    if (options.apiKey.trim() !== options.apiKey || options.apiKey.length < 20) {
      throw new RunPodPodControlError("RUNPOD_AUTH_INVALID");
    }
    this.fetch = options.fetch ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (this.baseUrl !== DEFAULT_BASE_URL && !this.baseUrl.startsWith("http://127.0.0.1:")) {
      throw new RunPodPodControlError("RUNPOD_BASE_URL_INVALID");
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new RunPodPodControlError("RUNPOD_TIMEOUT_INVALID");
    }
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: Readonly<Record<string, unknown>>,
    notFoundIsNull = false,
  ): Promise<unknown | null> {
    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: canonicalizeJson(body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new RunPodPodControlError(
        method === "GET" ? "RUNPOD_POD_READ_AMBIGUOUS" : "RUNPOD_POD_MUTATION_AMBIGUOUS",
      );
    }
    if (notFoundIsNull && response.status === 404) return null;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new RunPodPodControlError("RUNPOD_AUTH_REJECTED");
      }
      let providerMessage: string | undefined;
      try {
        const errorBody = record(JSON.parse(await response.text()));
        const candidate = errorBody?.error ?? errorBody?.message;
        if (
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate.length <= 500 &&
          /^[A-Za-z0-9 _.,:;/'"()\[\]{}+-]+$/u.test(candidate)
        ) {
          providerMessage = candidate;
        }
      } catch {
        // The HTTP status still distinguishes a definite provider rejection from ambiguity.
      }
      throw new RunPodPodControlError(
        method === "GET" ? "RUNPOD_POD_READ_FAILED" : "RUNPOD_POD_MUTATION_FAILED",
        undefined,
        undefined,
        response.status,
        providerMessage,
      );
    }
    if (response.status === 204) return null;
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new RunPodPodControlError("RUNPOD_RESPONSE_INVALID");
    }
  }

  async createMagePodTemplate(
    name: string,
    imageDigest: string,
  ): Promise<RunPodPodResourceIdentity> {
    if (!ID.test(name) || !IMAGE.test(imageDigest)) {
      throw new RunPodPodControlError("RUNPOD_MAGE_TEMPLATE_INPUT_INVALID");
    }
    const value = record(
      await this.request("POST", "/templates", {
        imageName: imageDigest,
        name,
        category: "NVIDIA",
        containerDiskInGb: 50,
        dockerEntrypoint: [],
        dockerStartCmd: [],
        env: staticEnvironment,
        isPublic: false,
        isServerless: false,
        ports: [CP06_MAGE_HTTP_PORT],
        readme: "VideoForge CP-06 exact Mage INT8 Pod worker",
        volumeInGb: 0,
        volumeMountPath: CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH,
      }),
    );
    return this.parseMagePodTemplate(value, name, imageDigest);
  }

  async findMagePodTemplateByName(
    name: string,
    imageDigest: string,
  ): Promise<RunPodPodResourceIdentity | null> {
    if (!ID.test(name) || !IMAGE.test(imageDigest)) {
      throw new RunPodPodControlError("RUNPOD_MAGE_TEMPLATE_INPUT_INVALID");
    }
    const value = await this.request(
      "GET",
      "/templates?includeEndpointBoundTemplates=false&includePublicTemplates=false&includeRunpodTemplates=false",
    );
    if (!Array.isArray(value)) throw new RunPodPodControlError("RUNPOD_RESPONSE_INVALID");
    const candidates = value.filter((candidate) => record(candidate)?.name === name);
    const candidateIds = candidates.flatMap((candidate) => {
      const id = record(candidate)?.id;
      return typeof id === "string" && ID.test(id) ? [id] : [];
    });
    if (candidates.length === 0) return null;
    if (candidates.length !== 1) {
      throw new RunPodPodControlError(
        "RUNPOD_MAGE_TEMPLATE_NAME_AMBIGUOUS",
        undefined,
        Object.freeze(candidateIds),
      );
    }
    return this.parseMagePodTemplate(candidates[0], name, imageDigest);
  }

  async createMageNetworkVolume(name: string): Promise<RunPodPodResourceIdentity> {
    if (!ID.test(name)) throw new RunPodPodControlError("RUNPOD_MAGE_VOLUME_INPUT_INVALID");
    const value = record(
      await this.request("POST", "/networkvolumes", {
        dataCenterId: CP06_MAGE_DATA_CENTER_ID,
        name,
        size: CP06_MAGE_NETWORK_VOLUME_SIZE_GB,
      }),
    );
    return this.parseMageNetworkVolume(value, name);
  }

  async findMageNetworkVolumeByName(name: string): Promise<RunPodPodResourceIdentity | null> {
    if (!ID.test(name)) throw new RunPodPodControlError("RUNPOD_MAGE_VOLUME_INPUT_INVALID");
    const value = await this.request("GET", "/networkvolumes");
    if (!Array.isArray(value)) throw new RunPodPodControlError("RUNPOD_RESPONSE_INVALID");
    const candidates = value.filter((candidate) => record(candidate)?.name === name);
    const candidateIds = candidates.flatMap((candidate) => {
      const id = record(candidate)?.id;
      return typeof id === "string" && ID.test(id) ? [id] : [];
    });
    if (candidates.length === 0) return null;
    if (candidates.length !== 1) {
      throw new RunPodPodControlError(
        "RUNPOD_MAGE_VOLUME_NAME_AMBIGUOUS",
        undefined,
        Object.freeze(candidateIds),
      );
    }
    return this.parseMageNetworkVolume(candidates[0], name);
  }

  async createMagePod(input: CreateRunPodMagePodInput): Promise<RunPodMagePod> {
    if (
      !ID.test(input.name) ||
      !ID.test(input.templateId) ||
      !IMAGE.test(input.imageDigest) ||
      !ID.test(input.networkVolumeId) ||
      !SHA256.test(input.networkVolumeIdHash) ||
      hashId(input.networkVolumeId) !== input.networkVolumeIdHash ||
      input.workerToken.length < 32 ||
      input.workerToken.length > 512 ||
      /\s/u.test(input.workerToken)
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_POD_INPUT_INVALID");
    }
    const value = await this.request(
      "POST",
      "/pods",
      magePodBody(
        input,
        runtimeEnvironment(input.imageDigest, input.networkVolumeIdHash, input.workerToken),
        [],
        [],
      ),
    );
    return this.parseCreatedPodWithReadFallback(value, (candidate, normalizedRead) =>
      this.parseMagePod(
        candidate,
        input,
        undefined,
        "runtime",
        input.workerToken,
        input.networkVolumeIdHash,
        normalizedRead,
      ),
    );
  }

  async createMagePrepPod(input: CreateRunPodMagePrepPodInput): Promise<RunPodMagePod> {
    this.assertBasePodInput(input);
    const value = await this.request(
      "POST",
      "/pods",
      magePodBody(input, prepEnvironment(input.networkVolumeId), prepEntrypoint, prepStartCommand),
    );
    return this.parseCreatedPodWithReadFallback(value, (candidate, normalizedRead) =>
      this.parseMagePod(
        candidate,
        input,
        undefined,
        "prepare",
        undefined,
        input.networkVolumeIdHash,
        normalizedRead,
      ),
    );
  }

  async createMageMissingVolumeNegativePod(
    input: CreateRunPodMagePodInput,
  ): Promise<RunPodMageNegativePod> {
    this.assertRuntimePodInput(input);
    const value = await this.request(
      "POST",
      "/pods",
      magePodBody(
        input,
        runtimeEnvironment(input.imageDigest, input.networkVolumeIdHash, input.workerToken),
        [],
        [],
        false,
      ),
    );
    return this.parseCreatedPodWithReadFallback(value, (candidate, normalizedRead) =>
      this.parseMissingVolumeNegativePod(candidate, input, normalizedRead),
    );
  }

  async createMageWrongVolumeHashNegativePod(
    input: CreateRunPodMagePodInput,
  ): Promise<RunPodMageNegativePod> {
    this.assertRuntimePodInput(input);
    if (input.networkVolumeIdHash === CP06_MAGE_WRONG_VOLUME_ID_HASH) {
      throw new RunPodPodControlError("RUNPOD_MAGE_WRONG_VOLUME_HASH_NOT_DISTINCT");
    }
    const value = await this.request(
      "POST",
      "/pods",
      magePodBody(
        input,
        runtimeEnvironment(input.imageDigest, CP06_MAGE_WRONG_VOLUME_ID_HASH, input.workerToken),
        [],
        [],
      ),
    );
    return this.parseCreatedPodWithReadFallback(value, (candidate, normalizedRead) =>
      this.parseWrongVolumeHashNegativePod(candidate, input, input.workerToken, normalizedRead),
    );
  }

  private async parseCreatedPodWithReadFallback<T>(
    createResponse: unknown,
    parse: (candidate: unknown, normalizedRead: boolean) => T,
  ): Promise<T> {
    try {
      return parse(createResponse, false);
    } catch (error) {
      if (!(error instanceof RunPodPodControlError) || error.resourceId === undefined) throw error;
      const podId = error.resourceId;
      let lastError: unknown = error;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const observed = await this.request(
          "GET",
          `/pods/${podId}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
          undefined,
          true,
        );
        if (observed !== null) {
          try {
            return parse(observed, true);
          } catch (readError) {
            lastError = readError;
          }
        }
        if (attempt + 1 < 12) await this.sleep(1_000);
      }
      throw lastError;
    }
  }

  async getMagePod(
    podId: string,
    authority: Omit<CreateRunPodMagePodInput, "workerToken">,
  ): Promise<RunPodMagePod | null> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    const value = await this.request(
      "GET",
      `/pods/${podId}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
      undefined,
      true,
    );
    return value === null
      ? null
      : this.parseMagePod(
          value,
          authority,
          podId,
          "runtime",
          undefined,
          authority.networkVolumeIdHash,
          true,
        );
  }

  async getMagePrepPod(
    podId: string,
    authority: CreateRunPodMagePrepPodInput,
  ): Promise<RunPodMagePod | null> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    this.assertBasePodInput(authority);
    const value = await this.request(
      "GET",
      `/pods/${podId}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
      undefined,
      true,
    );
    return value === null
      ? null
      : this.parseMagePod(
          value,
          authority,
          podId,
          "prepare",
          undefined,
          authority.networkVolumeIdHash,
          true,
        );
  }

  async listMagePodsByExactName(
    authority: CreateRunPodMagePrepPodInput,
    mode: "runtime" | "prepare" | "negativeMissing" | "negativeWrongHash",
  ): Promise<readonly RunPodMagePod[]> {
    this.assertBasePodInput(authority);
    const value = await this.request(
      "GET",
      `/pods?name=${encodeURIComponent(authority.name)}&includeMachine=true&includeNetworkVolume=true&includeTemplate=true&includeWorkers=false`,
    );
    if (!Array.isArray(value)) throw new RunPodPodControlError("RUNPOD_RESPONSE_INVALID");
    return Object.freeze(
      value.map((candidate) => {
        const observedName = record(candidate)?.name;
        const resourceId = record(candidate)?.id;
        if (observedName !== authority.name) {
          throw new RunPodPodControlError(
            "RUNPOD_MAGE_POD_NAME_FILTER_VIOLATION",
            typeof resourceId === "string" && ID.test(resourceId) ? resourceId : undefined,
          );
        }
        if (mode === "prepare") {
          return this.parseMagePod(
            candidate,
            authority,
            undefined,
            "prepare",
            undefined,
            authority.networkVolumeIdHash,
            true,
          );
        }
        if (mode === "negativeMissing") {
          const token = record(record(candidate)?.env)?.VIDEOFORGE_MAGE_WORKER_TOKEN;
          return this.parseMissingVolumeNegativePod(
            candidate,
            {
              ...authority,
              workerToken: typeof token === "string" ? token : "",
            },
            true,
          );
        }
        if (mode === "negativeWrongHash") {
          return this.parseWrongVolumeHashNegativePod(candidate, authority, undefined, true);
        }
        return this.parseMagePod(
          candidate,
          authority,
          undefined,
          "runtime",
          undefined,
          authority.networkVolumeIdHash,
          true,
        );
      }),
    );
  }

  validateMagePrepHealth(
    candidate: unknown,
    authority: CreateRunPodMagePrepPodInput,
  ): RunPodMagePrepHealth {
    this.assertBasePodInput(authority);
    const value = record(candidate);
    const process = record(value?.process);
    const model = record(value?.model);
    const volume = record(value?.volume);
    const phase = value?.phase;
    const failureCode = value?.failure_code;
    const manifestSha256 = volume?.manifest_sha256;
    const expectedModelStatus =
      phase === "ready" ? "ready" : phase === "failed" ? "error" : "loading";
    const isPhase =
      phase === "starting" || phase === "preparing" || phase === "ready" || phase === "failed";
    const validFailure =
      phase === "failed"
        ? typeof failureCode === "string" && /^MAGE_[A-Z0-9_]{1,115}$/u.test(failureCode)
        : failureCode === null;
    const validManifest =
      phase === "ready"
        ? typeof manifestSha256 === "string" && SHA256.test(manifestSha256)
        : manifestSha256 === null;
    if (
      value === null ||
      !exactKeys(value, [
        "failure_code",
        "model",
        "phase",
        "process",
        "schema_version",
        "volume",
      ]) ||
      value.schema_version !== "videoforge.mage-volume-preparation/v1" ||
      process === null ||
      !exactKeys(process, ["status"]) ||
      process.status !== "ok" ||
      !isPhase ||
      !validFailure ||
      model === null ||
      !exactKeys(model, ["exact_bytes", "id", "precision", "revision", "status"]) ||
      model.id !== "Comfy-Org/Mage-Flow" ||
      model.revision !== "d8c99241f6fa80fbd453014234af2bf337ea21e6" ||
      model.precision !== "int8-convrot" ||
      model.exact_bytes !== CP06_MAGE_MODEL_BYTES ||
      model.status !== expectedModelStatus ||
      volume === null ||
      !exactKeys(volume, ["id_hash", "manifest_sha256", "requested_size_gb"]) ||
      volume.id_hash !== authority.networkVolumeIdHash ||
      volume.requested_size_gb !== CP06_MAGE_NETWORK_VOLUME_SIZE_GB ||
      !validManifest
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_PREP_HEALTH_UNCONFIRMED");
    }
    return Object.freeze({
      phase,
      prepared: phase === "ready",
      failureCode: failureCode as string | null,
      volumeIdHash: authority.networkVolumeIdHash,
      modelBytes: CP06_MAGE_MODEL_BYTES,
      manifestSha256: manifestSha256 as `sha256:${string}` | null,
    });
  }

  async deleteMagePod(podId: string): Promise<void> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    await this.request("DELETE", `/pods/${podId}`);
  }

  async confirmMagePodAbsent(podId: string): Promise<boolean> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    return (
      (await this.request(
        "GET",
        `/pods/${podId}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
        undefined,
        true,
      )) === null
    );
  }

  async deleteMagePodAndConfirmAbsent(
    podId: string,
    options: RunPodBoundedPollOptions = {},
  ): Promise<void> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    const maximumAttempts = options.maximumAttempts ?? 12;
    const intervalMs = options.intervalMs ?? 2_000;
    this.assertPollOptions(maximumAttempts, intervalMs);
    try {
      await this.deleteMagePod(podId);
    } catch (error) {
      if (
        !(error instanceof RunPodPodControlError) ||
        (error.code !== "RUNPOD_POD_MUTATION_AMBIGUOUS" &&
          error.code !== "RUNPOD_POD_MUTATION_FAILED")
      ) {
        throw error;
      }
    }
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      try {
        if (await this.confirmMagePodAbsent(podId)) return;
      } catch (error) {
        if (
          !(error instanceof RunPodPodControlError) ||
          (error.code !== "RUNPOD_POD_READ_AMBIGUOUS" && error.code !== "RUNPOD_POD_READ_FAILED")
        ) {
          throw error;
        }
      }
      if (attempt + 1 < maximumAttempts) await this.sleep(intervalMs);
    }
    throw new RunPodPodControlError("RUNPOD_MAGE_POD_ABSENCE_UNCONFIRMED", podId);
  }

  async deleteMagePodTemplate(templateId: string): Promise<void> {
    if (!ID.test(templateId)) throw new RunPodPodControlError("RUNPOD_TEMPLATE_ID_INVALID");
    await this.request("DELETE", `/templates/${templateId}`);
  }

  async confirmMagePodTemplateAbsent(templateId: string): Promise<boolean> {
    if (!ID.test(templateId)) throw new RunPodPodControlError("RUNPOD_TEMPLATE_ID_INVALID");
    return (await this.request("GET", `/templates/${templateId}`, undefined, true)) === null;
  }

  async settledMagePodBilling(
    podId: string,
    startTime: string,
    endTime: string,
  ): Promise<RunPodSettledPodBilling> {
    if (!ID.test(podId)) throw new RunPodPodControlError("RUNPOD_POD_ID_INVALID");
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      start.toISOString() !== startTime ||
      end.toISOString() !== endTime ||
      start.getTime() >= end.getTime()
    ) {
      throw new RunPodPodControlError("RUNPOD_BILLING_WINDOW_INVALID");
    }
    const query = new URLSearchParams({
      bucketSize: "hour",
      grouping: "podId",
      podId,
      startTime,
      endTime,
    });
    const value = await this.request("GET", `/billing/pods?${query.toString()}`);
    if (!Array.isArray(value)) throw new RunPodPodControlError("RUNPOD_BILLING_RESPONSE_INVALID");
    let amountUsd = 0;
    let timeBilledMs = 0;
    for (const candidate of value) {
      const row = record(candidate);
      const amount = numberOrNull(row?.amount);
      const billed = numberOrNull(row?.timeBilledMs);
      if (
        !row ||
        row.podId !== podId ||
        (row.gpuTypeId !== undefined && row.gpuTypeId !== CP06_MAGE_GPU_TYPE_ID) ||
        amount === null ||
        billed === null ||
        !Number.isSafeInteger(billed)
      ) {
        throw new RunPodPodControlError("RUNPOD_BILLING_RESPONSE_INVALID");
      }
      amountUsd += amount;
      timeBilledMs += billed;
    }
    if (!Number.isFinite(amountUsd) || !Number.isSafeInteger(timeBilledMs)) {
      throw new RunPodPodControlError("RUNPOD_BILLING_RESPONSE_INVALID");
    }
    return Object.freeze({
      podIdHash: hashId(podId),
      recordCount: value.length,
      amountUsd,
      timeBilledMs,
      startTime,
      endTime,
    });
  }

  async settledMagePodBillingStable(
    podId: string,
    startTime: string,
    endTime: string,
    options: RunPodStableBillingOptions = {},
  ): Promise<RunPodSettledPodBilling> {
    const maximumAttempts = options.maximumAttempts ?? 12;
    const intervalMs = options.intervalMs ?? 5_000;
    const requiredStableObservations = options.requiredStableObservations ?? 3;
    this.assertPollOptions(maximumAttempts, intervalMs);
    if (
      !Number.isSafeInteger(requiredStableObservations) ||
      requiredStableObservations < 2 ||
      requiredStableObservations > maximumAttempts
    ) {
      throw new RunPodPodControlError("RUNPOD_BILLING_STABILITY_OPTIONS_INVALID");
    }
    let lastFingerprint: string | null = null;
    let stableObservations = 0;
    let lastObservation: RunPodSettledPodBilling | null = null;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      try {
        const observation = await this.settledMagePodBilling(podId, startTime, endTime);
        if (observation.recordCount > 0 && observation.timeBilledMs > 0) {
          const fingerprint = canonicalizeJson({
            amountUsd: observation.amountUsd,
            recordCount: observation.recordCount,
            timeBilledMs: observation.timeBilledMs,
          });
          stableObservations = fingerprint === lastFingerprint ? stableObservations + 1 : 1;
          lastFingerprint = fingerprint;
          lastObservation = observation;
          if (stableObservations >= requiredStableObservations) return observation;
        } else {
          lastFingerprint = null;
          stableObservations = 0;
          lastObservation = null;
        }
      } catch (error) {
        if (
          !(error instanceof RunPodPodControlError) ||
          (error.code !== "RUNPOD_POD_READ_AMBIGUOUS" && error.code !== "RUNPOD_POD_READ_FAILED")
        ) {
          throw error;
        }
        lastFingerprint = null;
        stableObservations = 0;
        lastObservation = null;
      }
      if (attempt + 1 < maximumAttempts) await this.sleep(intervalMs);
    }
    throw new RunPodPodControlError(
      lastObservation === null ? "RUNPOD_POD_BILLING_UNSETTLED" : "RUNPOD_POD_BILLING_UNSTABLE",
      podId,
    );
  }

  private assertPollOptions(maximumAttempts: number, intervalMs: number): void {
    if (
      !Number.isSafeInteger(maximumAttempts) ||
      maximumAttempts < 1 ||
      maximumAttempts > 120 ||
      !Number.isSafeInteger(intervalMs) ||
      intervalMs < 0 ||
      intervalMs > 60_000
    ) {
      throw new RunPodPodControlError("RUNPOD_POLL_OPTIONS_INVALID");
    }
  }

  private parseMagePod(
    candidate: unknown,
    authority: Omit<CreateRunPodMagePodInput, "workerToken">,
    expectedPodId?: string,
    mode: "runtime" | "prepare" = "runtime",
    expectedWorkerToken?: string,
    expectedEnvironmentVolumeIdHash: string = authority.networkVolumeIdHash,
    allowNormalizedReadOmissions = false,
  ): RunPodMagePod {
    const value = record(candidate);
    const resourceId = typeof value?.id === "string" && ID.test(value.id) ? value.id : undefined;
    const gpu = record(value?.gpu);
    const machine = record(value?.machine);
    const networkVolume = record(value?.networkVolume);
    const listedCostPerHourUsd = numberOrNull(value?.costPerHr);
    const adjustedCostPerHourUsd = numberOrNull(value?.adjustedCostPerHr);
    const costPerHourUsd = adjustedCostPerHourUsd ?? listedCostPerHourUsd;
    const desiredStatus = value?.desiredStatus;
    const providerStartedAt =
      normalizeRunPodTimestamp(value?.lastStartedAt) ??
      (allowNormalizedReadOmissions ? normalizeRunPodTimestamp(value?.createdAt) : null);
    const expectedEntrypoint = mode === "prepare" ? prepEntrypoint : [];
    const expectedStartCommand = prepStartCommand;
    const environmentConfirmed =
      mode === "prepare"
        ? exactPrepEnvironment(value?.env, authority.networkVolumeId)
        : exactRuntimeEnvironment(
            value?.env,
            authority.imageDigest,
            expectedEnvironmentVolumeIdHash,
            expectedWorkerToken,
          );
    const mismatchFields: string[] = [];
    const mismatch = (field: string, condition: boolean): void => {
      if (condition) mismatchFields.push(field);
    };
    mismatch("id", !resourceId);
    mismatch("expectedPodId", expectedPodId !== undefined && resourceId !== expectedPodId);
    mismatch("name", value?.name !== authority.name);
    mismatch("templateId", value?.templateId !== authority.templateId);
    mismatch(
      "image",
      value?.image !== authority.imageDigest &&
        (!allowNormalizedReadOmissions || value?.imageName !== authority.imageDigest),
    );
    mismatch(
      "allowedCudaVersions",
      value?.allowedCudaVersions !== undefined &&
        !exactStringArray(value.allowedCudaVersions, ["13.0"]),
    );
    mismatch(
      "dockerEntrypoint",
      !exactStringArray(value?.dockerEntrypoint, expectedEntrypoint) &&
        (!allowNormalizedReadOmissions ||
          mode !== "runtime" ||
          !exactStringArray(value?.dockerEntrypoint, runtimeImageEntrypoint)),
    );
    mismatch(
      "dockerStartCmd",
      !exactStringArray(value?.dockerStartCmd, expectedStartCommand) &&
        (!allowNormalizedReadOmissions || value?.dockerStartCmd !== undefined),
    );
    mismatch("env", !environmentConfirmed && !allowNormalizedReadOmissions);
    if (!environmentConfirmed && !allowNormalizedReadOmissions && mode === "prepare") {
      const observedEnvironment = providerNormalizedEnvironment(value?.env);
      for (const [key, expected] of Object.entries(prepEnvironment(authority.networkVolumeId))) {
        mismatch(`env.${key}`, observedEnvironment?.[key] !== expected);
      }
    }
    mismatch(
      "endpointId",
      value?.endpointId !== null &&
        (!allowNormalizedReadOmissions || value?.endpointId !== undefined),
    );
    mismatch(
      "interruptible",
      value?.interruptible !== false &&
        (!allowNormalizedReadOmissions || value?.interruptible !== undefined),
    );
    mismatch("volumeInGb", value?.volumeInGb !== 0);
    mismatch("volumeMountPath", value?.volumeMountPath !== CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH);
    mismatch("ports", !exactStringArray(value?.ports, [CP06_MAGE_HTTP_PORT]));
    mismatch(
      "gpu.count",
      gpu?.count !== 1 && (!allowNormalizedReadOmissions || gpu?.count !== undefined),
    );
    mismatch("machine.gpuTypeId", machine?.gpuTypeId !== CP06_MAGE_GPU_TYPE_ID);
    mismatch("machine.dataCenterId", machine?.dataCenterId !== CP06_MAGE_DATA_CENTER_ID);
    mismatch("machine.secureCloud", machine?.secureCloud !== true);
    mismatch("networkVolume.id", networkVolume?.id !== authority.networkVolumeId);
    mismatch(
      "networkVolume.dataCenterId",
      networkVolume?.dataCenterId !== CP06_MAGE_DATA_CENTER_ID,
    );
    mismatch("networkVolume.size", networkVolume?.size !== CP06_MAGE_NETWORK_VOLUME_SIZE_GB);
    mismatch(
      "listedCostPerHourUsd",
      listedCostPerHourUsd === null ||
        listedCostPerHourUsd <= 0 ||
        listedCostPerHourUsd > CP06_MAGE_GPU_RATE_CEILING_USD_PER_HOUR,
    );
    mismatch(
      "adjustedCostPerHourUsd",
      adjustedCostPerHourUsd !== null &&
        (adjustedCostPerHourUsd <= 0 ||
          adjustedCostPerHourUsd > CP06_MAGE_GPU_RATE_CEILING_USD_PER_HOUR),
    );
    mismatch("costPerHourUsd", costPerHourUsd === null || costPerHourUsd <= 0);
    mismatch(
      "desiredStatus",
      desiredStatus !== "RUNNING" && desiredStatus !== "EXITED" && desiredStatus !== "TERMINATED",
    );
    mismatch("lastStartedAt", providerStartedAt === null);
    if (mismatchFields.length > 0) {
      const environmentKeys = Array.isArray(value?.env)
        ? value.env
            .map((entry) => record(entry)?.key)
            .filter((key): key is string => typeof key === "string")
            .sort()
            .join("|")
        : record(value?.env) === null
          ? typeof value?.env
          : Object.keys(record(value?.env) ?? {})
              .sort()
              .join("|");
      const timestampShape = `last:${typeof value?.lastStartedAt}:${String(value?.lastStartedAt)};created:${typeof value?.createdAt}:${String(value?.createdAt)}`;
      throw new RunPodPodControlError(
        "RUNPOD_MAGE_POD_IDENTITY_UNCONFIRMED",
        resourceId,
        undefined,
        undefined,
        `${mismatchFields.join(",")};envKeys:${environmentKeys};${timestampShape}`,
      );
    }
    if (
      resourceId === undefined ||
      costPerHourUsd === null ||
      (desiredStatus !== "RUNNING" &&
        desiredStatus !== "EXITED" &&
        desiredStatus !== "TERMINATED") ||
      typeof providerStartedAt !== "string"
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_POD_IDENTITY_UNCONFIRMED", resourceId);
    }
    return Object.freeze({
      id: resourceId,
      idHash: hashId(resourceId),
      name: authority.name,
      templateId: authority.templateId,
      image: authority.imageDigest,
      networkVolumeIdHash: authority.networkVolumeIdHash,
      dataCenterId: CP06_MAGE_DATA_CENTER_ID,
      gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
      costPerHourUsd,
      desiredStatus,
      lastStartedAt: providerStartedAt,
    });
  }

  private assertBasePodInput(input: CreateRunPodMagePrepPodInput): void {
    if (
      !ID.test(input.name) ||
      !ID.test(input.templateId) ||
      !IMAGE.test(input.imageDigest) ||
      !ID.test(input.networkVolumeId) ||
      !SHA256.test(input.networkVolumeIdHash) ||
      hashId(input.networkVolumeId) !== input.networkVolumeIdHash
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_POD_INPUT_INVALID");
    }
  }

  private assertRuntimePodInput(input: CreateRunPodMagePodInput): void {
    this.assertBasePodInput(input);
    if (
      input.workerToken.length < 32 ||
      input.workerToken.length > 512 ||
      /\s/u.test(input.workerToken)
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_POD_INPUT_INVALID");
    }
  }

  private parseMissingVolumeNegativePod(
    candidate: unknown,
    authority: CreateRunPodMagePodInput,
    allowNormalizedReadOmissions = false,
  ): RunPodMageNegativePod {
    const value = record(candidate);
    const resourceId = typeof value?.id === "string" && ID.test(value.id) ? value.id : undefined;
    const gpu = record(value?.gpu);
    const machine = record(value?.machine);
    const listedCostPerHourUsd = numberOrNull(value?.costPerHr);
    const adjustedCostPerHourUsd = numberOrNull(value?.adjustedCostPerHr);
    const costPerHourUsd = adjustedCostPerHourUsd ?? listedCostPerHourUsd;
    const desiredStatus = value?.desiredStatus;
    const providerStartedAt =
      normalizeRunPodTimestamp(value?.lastStartedAt) ??
      (allowNormalizedReadOmissions ? normalizeRunPodTimestamp(value?.createdAt) : null);
    if (
      !resourceId ||
      value?.name !== authority.name ||
      value.templateId !== authority.templateId ||
      (value.image !== authority.imageDigest &&
        (!allowNormalizedReadOmissions || value.imageName !== authority.imageDigest)) ||
      (!exactStringArray(value.dockerEntrypoint, []) &&
        (!allowNormalizedReadOmissions || value.dockerEntrypoint !== undefined)) ||
      (!exactStringArray(value.dockerStartCmd, []) &&
        (!allowNormalizedReadOmissions || value.dockerStartCmd !== undefined)) ||
      (!allowNormalizedReadOmissions &&
        !exactRuntimeEnvironment(
          value.env,
          authority.imageDigest,
          authority.networkVolumeIdHash,
          authority.workerToken,
        )) ||
      (value.allowedCudaVersions !== undefined &&
        !exactStringArray(value.allowedCudaVersions, ["13.0"])) ||
      (value.endpointId !== null &&
        (!allowNormalizedReadOmissions || value.endpointId !== undefined)) ||
      (value.interruptible !== false &&
        (!allowNormalizedReadOmissions || value.interruptible !== undefined)) ||
      value.volumeInGb !== 0 ||
      (value.volumeMountPath !== undefined &&
        value.volumeMountPath !== null &&
        (!allowNormalizedReadOmissions ||
          value.volumeMountPath !== CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH)) ||
      (value.networkVolume !== null &&
        (!allowNormalizedReadOmissions || value.networkVolume !== undefined)) ||
      !exactStringArray(value.ports, [CP06_MAGE_HTTP_PORT]) ||
      (gpu?.count !== 1 && (!allowNormalizedReadOmissions || gpu?.count !== undefined)) ||
      machine?.gpuTypeId !== CP06_MAGE_GPU_TYPE_ID ||
      machine.dataCenterId !== CP06_MAGE_DATA_CENTER_ID ||
      machine.secureCloud !== true ||
      listedCostPerHourUsd === null ||
      listedCostPerHourUsd <= 0 ||
      listedCostPerHourUsd > CP06_MAGE_GPU_RATE_CEILING_USD_PER_HOUR ||
      (adjustedCostPerHourUsd !== null &&
        (adjustedCostPerHourUsd <= 0 ||
          adjustedCostPerHourUsd > CP06_MAGE_GPU_RATE_CEILING_USD_PER_HOUR)) ||
      costPerHourUsd === null ||
      costPerHourUsd <= 0 ||
      (desiredStatus !== "RUNNING" &&
        desiredStatus !== "EXITED" &&
        desiredStatus !== "TERMINATED") ||
      providerStartedAt === null
    ) {
      throw new RunPodPodControlError(
        "RUNPOD_MAGE_MISSING_VOLUME_NEGATIVE_UNCONFIRMED",
        resourceId,
        undefined,
        undefined,
        `image:${typeof value?.image}:${String(value?.image)};imageName:${typeof value?.imageName}:${String(value?.imageName)};entrypoint:${typeof value?.dockerEntrypoint};start:${typeof value?.dockerStartCmd};endpoint:${typeof value?.endpointId}:${String(value?.endpointId)};interruptible:${typeof value?.interruptible}:${String(value?.interruptible)};volumeInGb:${typeof value?.volumeInGb}:${String(value?.volumeInGb)};volumeMountPath:${typeof value?.volumeMountPath}:${String(value?.volumeMountPath)};networkVolume:${value?.networkVolume === null ? "null" : typeof value?.networkVolume};gpuCount:${typeof gpu?.count}:${String(gpu?.count)};last:${typeof value?.lastStartedAt}:${String(value?.lastStartedAt)}`,
      );
    }
    return Object.freeze({
      id: resourceId,
      idHash: hashId(resourceId),
      name: authority.name,
      templateId: authority.templateId,
      image: authority.imageDigest,
      networkVolumeIdHash: authority.networkVolumeIdHash,
      dataCenterId: CP06_MAGE_DATA_CENTER_ID,
      gpuTypeId: CP06_MAGE_GPU_TYPE_ID,
      costPerHourUsd,
      desiredStatus,
      lastStartedAt: providerStartedAt as string,
      negativeKind: "MISSING_VOLUME",
      expectedWorkerError: "MAGE_VOLUME_MARKER_INVALID",
    });
  }

  private parseWrongVolumeHashNegativePod(
    candidate: unknown,
    authority: CreateRunPodMagePrepPodInput,
    expectedWorkerToken?: string,
    allowNormalizedReadOmissions = false,
  ): RunPodMageNegativePod {
    const value = record(candidate);
    if (
      !allowNormalizedReadOmissions &&
      !exactRuntimeEnvironment(
        value?.env,
        authority.imageDigest,
        CP06_MAGE_WRONG_VOLUME_ID_HASH,
        expectedWorkerToken,
      )
    ) {
      const resourceId = value?.id;
      throw new RunPodPodControlError(
        "RUNPOD_MAGE_NEGATIVE_ENVIRONMENT_UNCONFIRMED",
        typeof resourceId === "string" && ID.test(resourceId) ? resourceId : undefined,
      );
    }
    const pod = this.parseMagePod(
      candidate,
      authority,
      undefined,
      "runtime",
      expectedWorkerToken,
      CP06_MAGE_WRONG_VOLUME_ID_HASH,
      allowNormalizedReadOmissions,
    );
    return Object.freeze({
      ...pod,
      negativeKind: "WRONG_VOLUME_HASH",
      expectedWorkerError: "MAGE_VOLUME_ID_MISMATCH",
    });
  }

  private parseMagePodTemplate(
    candidate: unknown,
    expectedName: string,
    expectedImageDigest: string,
  ): RunPodPodResourceIdentity {
    const value = record(candidate);
    const resourceId = typeof value?.id === "string" && ID.test(value.id) ? value.id : undefined;
    if (
      !resourceId ||
      value?.name !== expectedName ||
      value.imageName !== expectedImageDigest ||
      value.category !== "NVIDIA" ||
      value.containerDiskInGb !== 50 ||
      (value.isPublic !== undefined && value.isPublic !== false) ||
      (value.isServerless !== undefined && value.isServerless !== false) ||
      (value.dockerEntrypoint !== undefined && !exactStringArray(value.dockerEntrypoint, [])) ||
      (value.dockerStartCmd !== undefined && !exactStringArray(value.dockerStartCmd, [])) ||
      !exactStaticEnvironment(value.env) ||
      !exactStringArray(value.ports, [CP06_MAGE_HTTP_PORT]) ||
      (value.volumeInGb !== undefined && value.volumeInGb !== 0) ||
      value.volumeMountPath !== CP06_MAGE_NETWORK_VOLUME_MOUNT_PATH
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_TEMPLATE_IDENTITY_UNCONFIRMED", resourceId);
    }
    return Object.freeze({ id: resourceId, idHash: hashId(resourceId) });
  }

  private parseMageNetworkVolume(
    candidate: unknown,
    expectedName: string,
  ): RunPodPodResourceIdentity {
    const value = record(candidate);
    const resourceId = typeof value?.id === "string" && ID.test(value.id) ? value.id : undefined;
    if (
      !resourceId ||
      value?.name !== expectedName ||
      value.dataCenterId !== CP06_MAGE_DATA_CENTER_ID ||
      value.size !== CP06_MAGE_NETWORK_VOLUME_SIZE_GB
    ) {
      throw new RunPodPodControlError("RUNPOD_MAGE_VOLUME_IDENTITY_UNCONFIRMED", resourceId);
    }
    return Object.freeze({ id: resourceId, idHash: hashId(resourceId) });
  }
}
