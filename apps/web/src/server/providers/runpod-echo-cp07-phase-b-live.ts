import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { canonicalizeJson } from "@videoforge/contracts";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { fetchCp07Catalog } from "./runpod-echo-cp07-preflight";

export const CP07_ACCOUNT_HASH =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
export const CP07_GPU = "NVIDIA GeForce RTX 4090";
export const CP07_GPU_RATE_USD_PER_HOUR = 0.74;
export const CP07_REGION = "EU-RO-1";
export const CP07_CAP_USD = 4;
export const CP07_PRIOR_CONSERVATIVE_SPEND_USD = 1.11;
export const CP07_POD_LIFECYCLE_RESERVE_SECONDS = 120;
export const CP07_VOLUME_NAME = "videoforge-echo-cp07-model-volume-eu-ro-1-50gb";
export const CP07_VOLUME_SIZE_GB = 50;
export const CP06_MAGE_VOLUME_ID_HASH =
  "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
export const CP07_INVALID_ECHO_VOLUME_ID_HASH =
  "sha256:6df3de80cfbc182e6306167c7832915240944e1ddc5753091ed529a84d634e7a";
export const CP07_TEMPLATE_NAME = "videoforge-echo-flash-turbo-cp07-template";
export const CP07_MODEL_ROOT = "/runpod-volume/echo-flash-turbo-fp8";
export const CP07_VOLUME_MOUNT = "/runpod-volume";
export const CP07_PREP_CONFIRMATION = "DOWNLOAD_AND_PREPARE_EXACT_VIDEOFORGE_ECHO_FLASH_TURBO_FP8";
export const CP07_IMAGE =
  /^ghcr\.io\/pala-lakshmansai\/videoforge-echo-flash-turbo-cp07@sha256:[a-f0-9]{64}$/u;

const REST = "https://rest.runpod.io/v1";
const CATALOG_IMAGE_REPOSITORY = "pala-lakshmansai/videoforge-echo-flash-turbo-cp07";
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const PROXY = /^https:\/\/[A-Za-z0-9_-]+-8000\.proxy\.runpod\.net$/u;
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const finite = (value: unknown): number | null => {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) && candidate >= 0 ? candidate : null;
};

const sha256 = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const proxyUrl = (podId: string): string => {
  const value = `https://${podId}-8000.proxy.runpod.net`;
  if (!PROXY.test(value)) throw new Cp07PhaseBError("CP07_PROXY_INVALID");
  return value;
};

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export class Cp07PhaseBError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
    this.name = "Cp07PhaseBError";
  }
}

export interface Cp07ReplacementVolume {
  readonly idHash: `sha256:${string}`;
  readonly name: string;
  readonly size: number;
  readonly dataCenterId: string;
}

export function assertCp07ReplacementInventory(
  volumes: readonly Cp07ReplacementVolume[],
): typeof CP07_INVALID_ECHO_VOLUME_ID_HASH {
  const mageVolumes = volumes.filter((volume) => volume.idHash === CP06_MAGE_VOLUME_ID_HASH);
  const echoVolumes = volumes.filter((volume) => volume.name === CP07_VOLUME_NAME);
  const echo = echoVolumes[0];
  if (
    volumes.length !== 2 ||
    mageVolumes.length !== 1 ||
    echoVolumes.length !== 1 ||
    echo === undefined ||
    echo.idHash !== CP07_INVALID_ECHO_VOLUME_ID_HASH ||
    echo.size !== CP07_VOLUME_SIZE_GB ||
    echo.dataCenterId !== CP07_REGION
  ) {
    throw new Cp07PhaseBError("CP07_REPLACEMENT_VOLUME_INVENTORY_MISMATCH");
  }
  return CP07_INVALID_ECHO_VOLUME_ID_HASH;
}

export function assertCp07CumulativeReservation(
  retryCostUpperBoundUsd: number,
  nextPodMaximumSeconds: number,
): number {
  if (
    !Number.isFinite(retryCostUpperBoundUsd) ||
    retryCostUpperBoundUsd < 0 ||
    !Number.isSafeInteger(nextPodMaximumSeconds) ||
    nextPodMaximumSeconds < 1
  ) {
    throw new Cp07PhaseBError("CP07_COST_RESERVATION_INVALID");
  }
  const nextPodMaximumCostUsd =
    ((nextPodMaximumSeconds + CP07_POD_LIFECYCLE_RESERVE_SECONDS) / 3_600) *
    CP07_GPU_RATE_USD_PER_HOUR;
  const cumulativeReservedUsd =
    CP07_PRIOR_CONSERVATIVE_SPEND_USD + retryCostUpperBoundUsd + nextPodMaximumCostUsd;
  if (cumulativeReservedUsd > CP07_CAP_USD) {
    throw new Cp07PhaseBError("CP07_CUMULATIVE_CAP_RISK");
  }
  return nextPodMaximumCostUsd;
}

const assertCp07ObservedCost = (retryCostUpperBoundUsd: number): void => {
  if (CP07_PRIOR_CONSERVATIVE_SPEND_USD + retryCostUpperBoundUsd > CP07_CAP_USD) {
    throw new Cp07PhaseBError("CP07_CUMULATIVE_CAP_RISK");
  }
};

interface ProviderVolume {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly dataCenterId: string;
}

interface ProviderTemplate {
  readonly id: string;
  readonly name: string;
  readonly imageName: string;
}

interface ProviderPod {
  readonly id: string;
  readonly name: string;
  readonly costPerHourUsd: number;
  readonly startedAt: string;
}

interface PodAuthority {
  readonly name: string;
  readonly templateId: string;
  readonly imageDigest: string;
  readonly volumeId: string;
  readonly volumeIdHash: `sha256:${string}`;
  readonly mode: "prepare" | "runtime";
  readonly workerToken?: string;
}

interface DeletedPodEvidence {
  readonly podIdHash: `sha256:${string}`;
  readonly startedAt: string;
  readonly deletedAt: string;
  readonly elapsedCostUpperBoundUsd: number;
  readonly settledCostUsd: number | null;
  readonly deleteMs: number;
  readonly absenceProven: true;
}

class RunPodCp07Client {
  constructor(
    private readonly apiKey: string,
    private readonly fetchPort: FetchPort = fetch,
  ) {
    if (apiKey.trim() !== apiKey || apiKey.length < 20) {
      throw new Cp07PhaseBError("CP07_RUNPOD_AUTH_INVALID");
    }
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: JsonRecord,
    notFoundIsNull = false,
  ): Promise<unknown | null> {
    let response: Response;
    try {
      response = await this.fetchPort(`${REST}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: canonicalizeJson(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Cp07PhaseBError(
        method === "GET" ? "CP07_PROVIDER_READ_AMBIGUOUS" : "CP07_PROVIDER_MUTATION_AMBIGUOUS",
      );
    }
    if (notFoundIsNull && response.status === 404) return null;
    if (!response.ok) {
      throw new Cp07PhaseBError(
        response.status === 401 || response.status === 403
          ? "CP07_PROVIDER_AUTH_REJECTED"
          : method === "GET"
            ? "CP07_PROVIDER_READ_FAILED"
            : "CP07_PROVIDER_MUTATION_FAILED",
        `status:${response.status}`,
      );
    }
    if (response.status === 204) return null;
    try {
      return JSON.parse(await response.text());
    } catch {
      throw new Cp07PhaseBError("CP07_PROVIDER_RESPONSE_INVALID");
    }
  }

  async listVolumes(): Promise<readonly ProviderVolume[]> {
    const value = await this.request("GET", "/networkvolumes");
    if (!Array.isArray(value)) throw new Cp07PhaseBError("CP07_VOLUME_LIST_INVALID");
    return value.map((candidate) => {
      const item = record(candidate);
      if (
        !item ||
        typeof item.id !== "string" ||
        !ID.test(item.id) ||
        typeof item.name !== "string" ||
        !ID.test(item.name) ||
        !Number.isSafeInteger(item.size) ||
        typeof item.dataCenterId !== "string"
      ) {
        throw new Cp07PhaseBError("CP07_VOLUME_LIST_INVALID");
      }
      return {
        id: item.id,
        name: item.name,
        size: item.size as number,
        dataCenterId: item.dataCenterId,
      };
    });
  }

  async createVolume(): Promise<ProviderVolume> {
    let response: unknown;
    try {
      response = await this.request("POST", "/networkvolumes", {
        dataCenterId: CP07_REGION,
        name: CP07_VOLUME_NAME,
        size: CP07_VOLUME_SIZE_GB,
      });
    } catch (error) {
      if (
        !(error instanceof Cp07PhaseBError) ||
        error.code !== "CP07_PROVIDER_MUTATION_AMBIGUOUS"
      ) {
        throw error;
      }
      const exact = (await this.listVolumes()).filter((item) => item.name === CP07_VOLUME_NAME);
      const selected = exact[0];
      if (exact.length !== 1 || selected === undefined) {
        throw new Cp07PhaseBError("CP07_VOLUME_CREATE_AMBIGUOUS");
      }
      return this.assertEchoVolume(selected);
    }
    const value = record(response);
    if (typeof value?.id !== "string" || !ID.test(value.id)) {
      throw new Cp07PhaseBError("CP07_VOLUME_CREATE_RESPONSE_INVALID");
    }
    const volumes = await this.listVolumes();
    const exact = volumes.filter((item) => item.name === CP07_VOLUME_NAME);
    const selected = exact[0];
    if (exact.length !== 1 || selected === undefined || selected.id !== value.id) {
      throw new Cp07PhaseBError("CP07_VOLUME_CREATE_IDENTITY_UNCONFIRMED");
    }
    return this.assertEchoVolume(selected);
  }

  assertEchoVolume(volume: ProviderVolume): ProviderVolume {
    if (
      volume.name !== CP07_VOLUME_NAME ||
      volume.size !== CP07_VOLUME_SIZE_GB ||
      volume.dataCenterId !== CP07_REGION
    ) {
      throw new Cp07PhaseBError("CP07_VOLUME_IDENTITY_MISMATCH");
    }
    return volume;
  }

  async deleteInvalidEchoVolumeAndConfirm(volume: ProviderVolume): Promise<void> {
    this.assertEchoVolume(volume);
    if (sha256(volume.id) !== CP07_INVALID_ECHO_VOLUME_ID_HASH) {
      throw new Cp07PhaseBError("CP07_INVALID_VOLUME_IDENTITY_MISMATCH");
    }
    await this.request("DELETE", `/networkvolumes/${volume.id}`);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const volumes = await this.listVolumes();
      if (volumes.every((candidate) => candidate.id !== volume.id)) return;
      await sleep(2_000);
    }
    throw new Cp07PhaseBError("CP07_INVALID_VOLUME_ABSENCE_UNCONFIRMED");
  }

  async listTemplates(): Promise<readonly ProviderTemplate[]> {
    const value = await this.request(
      "GET",
      "/templates?includeEndpointBoundTemplates=false&includePublicTemplates=false&includeRunpodTemplates=false",
    );
    if (!Array.isArray(value)) throw new Cp07PhaseBError("CP07_TEMPLATE_LIST_INVALID");
    return value.map((candidate) => {
      const item = record(candidate);
      if (
        !item ||
        typeof item.id !== "string" ||
        !ID.test(item.id) ||
        typeof item.name !== "string" ||
        typeof item.imageName !== "string"
      ) {
        throw new Cp07PhaseBError("CP07_TEMPLATE_LIST_INVALID");
      }
      return { id: item.id, name: item.name, imageName: item.imageName };
    });
  }

  async createTemplate(imageDigest: string): Promise<ProviderTemplate> {
    let response: unknown;
    try {
      response = await this.request("POST", "/templates", {
        category: "NVIDIA",
        containerDiskInGb: 50,
        dockerEntrypoint: [],
        dockerStartCmd: [],
        env: {
          DIFFUSERS_OFFLINE: "1",
          ECHO_MODEL_ROOT: CP07_MODEL_ROOT,
          HF_HUB_OFFLINE: "1",
          TRANSFORMERS_OFFLINE: "1",
        },
        imageName: imageDigest,
        isPublic: false,
        isServerless: false,
        name: CP07_TEMPLATE_NAME,
        ports: ["8000/http"],
        readme: "VideoForge CP-07 EchoMimicV3-Flash Turbo FP8 Pod worker",
        volumeInGb: 0,
        volumeMountPath: CP07_VOLUME_MOUNT,
      });
    } catch (error) {
      if (
        !(error instanceof Cp07PhaseBError) ||
        error.code !== "CP07_PROVIDER_MUTATION_AMBIGUOUS"
      ) {
        throw error;
      }
      const exact = (await this.listTemplates()).filter((item) => item.name === CP07_TEMPLATE_NAME);
      if (exact.length === 1 && exact[0]?.imageName === imageDigest) return exact[0];
      for (const template of exact) await this.deleteTemplate(template.id);
      throw new Cp07PhaseBError("CP07_TEMPLATE_CREATE_AMBIGUOUS_CLEANED");
    }
    const value = record(response);
    if (typeof value?.id !== "string" || !ID.test(value.id)) {
      throw new Cp07PhaseBError("CP07_TEMPLATE_CREATE_RESPONSE_INVALID");
    }
    const templates = await this.listTemplates();
    const exact = templates.filter((item) => item.name === CP07_TEMPLATE_NAME);
    if (exact.length !== 1 || exact[0]?.id !== value.id || exact[0].imageName !== imageDigest) {
      throw new Cp07PhaseBError("CP07_TEMPLATE_CREATE_IDENTITY_UNCONFIRMED");
    }
    return exact[0];
  }

  async deleteTemplate(id: string): Promise<void> {
    if (!ID.test(id)) throw new Cp07PhaseBError("CP07_TEMPLATE_ID_INVALID");
    await this.request("DELETE", `/templates/${id}`);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if ((await this.request("GET", `/templates/${id}`, undefined, true)) === null) return;
      await sleep(2_000);
    }
    throw new Cp07PhaseBError("CP07_TEMPLATE_ABSENCE_UNCONFIRMED");
  }

  async listPodsByName(name: string): Promise<readonly JsonRecord[]> {
    if (!ID.test(name)) throw new Cp07PhaseBError("CP07_POD_NAME_INVALID");
    const value = await this.request(
      "GET",
      `/pods?name=${encodeURIComponent(name)}&includeMachine=true&includeNetworkVolume=true&includeTemplate=true&includeWorkers=false`,
    );
    if (!Array.isArray(value)) throw new Cp07PhaseBError("CP07_POD_LIST_INVALID");
    const items = value.map(record);
    if (items.some((item) => item?.name !== name)) {
      throw new Cp07PhaseBError("CP07_POD_NAME_FILTER_VIOLATION");
    }
    return items as readonly JsonRecord[];
  }

  async listAllPods(): Promise<readonly JsonRecord[]> {
    const value = await this.request(
      "GET",
      "/pods?includeMachine=true&includeNetworkVolume=true&includeTemplate=true&includeWorkers=false",
    );
    if (!Array.isArray(value)) throw new Cp07PhaseBError("CP07_POD_LIST_INVALID");
    const items = value.map(record);
    if (items.some((item) => item === null)) {
      throw new Cp07PhaseBError("CP07_POD_LIST_INVALID");
    }
    return items as readonly JsonRecord[];
  }

  private runtimeEnvironment(authority: PodAuthority): JsonRecord {
    if (authority.workerToken === undefined) {
      return {
        DIFFUSERS_OFFLINE: "1",
        ECHO_MODEL_ROOT: CP07_MODEL_ROOT,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        VIDEOFORGE_ECHO_DOWNLOAD_CONFIRMATION: CP07_PREP_CONFIRMATION,
        VIDEOFORGE_ECHO_PREPARATION: "1",
        VIDEOFORGE_ECHO_VOLUME_ID: authority.volumeId,
      };
    }
    return {
      DIFFUSERS_OFFLINE: "1",
      ECHO_MODEL_ROOT: CP07_MODEL_ROOT,
      ECHO_SCRATCH_ROOT: "/run/videoforge/echo-scratch",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      VIDEOFORGE_ECHO_GPU_OFFERING_ID: CP07_GPU,
      VIDEOFORGE_ECHO_VOLUME_ID_HASH: authority.volumeIdHash,
      VIDEOFORGE_ECHO_WORKER_IMAGE_DIGEST: authority.imageDigest,
      VIDEOFORGE_ECHO_WORKER_TOKEN: authority.workerToken,
    };
  }

  async createPod(authority: PodAuthority): Promise<ProviderPod> {
    const body: JsonRecord = {
      allowedCudaVersions: ["12.8"],
      cloudType: "SECURE",
      computeType: "GPU",
      containerDiskInGb: 50,
      dataCenterIds: [CP07_REGION],
      dataCenterPriority: "custom",
      dockerEntrypoint: [],
      dockerStartCmd: [],
      env: this.runtimeEnvironment(authority),
      globalNetworking: false,
      gpuCount: 1,
      gpuTypeIds: [CP07_GPU],
      gpuTypePriority: "custom",
      imageName: authority.imageDigest,
      interruptible: false,
      locked: false,
      name: authority.name,
      networkVolumeId: authority.volumeId,
      ports: ["8000/http"],
      supportPublicIp: false,
      templateId: authority.templateId,
      volumeInGb: 0,
      volumeMountPath: CP07_VOLUME_MOUNT,
    };
    let response: unknown;
    try {
      response = await this.request("POST", "/pods", body);
    } catch (error) {
      if (
        !(error instanceof Cp07PhaseBError) ||
        error.code !== "CP07_PROVIDER_MUTATION_AMBIGUOUS"
      ) {
        throw error;
      }
      const candidates = await this.listPodsByName(authority.name);
      if (candidates.length !== 1) {
        await this.deleteCandidatePods(candidates);
        throw new Cp07PhaseBError("CP07_POD_CREATE_AMBIGUOUS_CLEANED");
      }
      response = candidates[0];
    }
    const created = record(response);
    if (typeof created?.id !== "string" || !ID.test(created.id)) {
      throw new Cp07PhaseBError("CP07_POD_CREATE_RESPONSE_INVALID");
    }
    let lastError: unknown = new Cp07PhaseBError("CP07_POD_IDENTITY_MISMATCH");
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const read = await this.request(
          "GET",
          `/pods/${created.id}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
        );
        try {
          return this.parsePod(read, authority, created.id);
        } catch (error) {
          lastError = error;
        }
        await sleep(1_000);
      }
      throw lastError;
    } catch {
      await this.deletePodAndConfirm(created.id);
      throw lastError;
    }
  }

  private parsePod(value: unknown, authority: PodAuthority, expectedId: string): ProviderPod {
    const item = record(value);
    const machine = record(item?.machine);
    const networkVolume = record(item?.networkVolume);
    const cost = finite(item?.adjustedCostPerHr ?? item?.costPerHr);
    const startedAt = normalizeTimestamp(item?.lastStartedAt ?? item?.createdAt);
    if (
      !item ||
      item.id !== expectedId ||
      item.name !== authority.name ||
      item.templateId !== authority.templateId ||
      (item.image !== authority.imageDigest && item.imageName !== authority.imageDigest) ||
      item.volumeMountPath !== CP07_VOLUME_MOUNT ||
      item.volumeInGb !== 0 ||
      machine?.gpuTypeId !== CP07_GPU ||
      machine.dataCenterId !== CP07_REGION ||
      machine.secureCloud !== true ||
      networkVolume?.id !== authority.volumeId ||
      networkVolume.dataCenterId !== CP07_REGION ||
      networkVolume.size !== CP07_VOLUME_SIZE_GB ||
      cost === null ||
      cost <= 0 ||
      cost > CP07_GPU_RATE_USD_PER_HOUR ||
      startedAt === null
    ) {
      throw new Cp07PhaseBError("CP07_POD_IDENTITY_MISMATCH");
    }
    return { id: expectedId, name: authority.name, costPerHourUsd: cost, startedAt };
  }

  private async deleteCandidatePods(candidates: readonly JsonRecord[]): Promise<void> {
    for (const candidate of candidates) {
      if (typeof candidate.id === "string" && ID.test(candidate.id)) {
        await this.deletePodAndConfirm(candidate.id);
      }
    }
  }

  async deletePodAndConfirm(id: string): Promise<void> {
    if (!ID.test(id)) throw new Cp07PhaseBError("CP07_POD_ID_INVALID");
    try {
      await this.request("DELETE", `/pods/${id}`);
    } catch (error) {
      if (
        !(error instanceof Cp07PhaseBError) ||
        !["CP07_PROVIDER_MUTATION_AMBIGUOUS", "CP07_PROVIDER_MUTATION_FAILED"].includes(error.code)
      ) {
        throw error;
      }
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (
        (await this.request(
          "GET",
          `/pods/${id}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
          undefined,
          true,
        )) === null
      ) {
        return;
      }
      await sleep(2_000);
    }
    throw new Cp07PhaseBError("CP07_POD_ABSENCE_UNCONFIRMED");
  }

  async settledCost(id: string, startedAt: string, deletedAt: string): Promise<number | null> {
    const query = new URLSearchParams({
      bucketSize: "hour",
      grouping: "podId",
      podId: id,
      startTime: startedAt,
      endTime: deletedAt,
    });
    let last: number | null = null;
    let stable = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const value = await this.request("GET", `/billing/pods?${query.toString()}`);
        if (!Array.isArray(value)) throw new Cp07PhaseBError("CP07_BILLING_RESPONSE_INVALID");
        const total = value.reduce((sum, candidate) => {
          const row = record(candidate);
          const amount = finite(row?.amount);
          if (!row || row.podId !== id || amount === null) {
            throw new Cp07PhaseBError("CP07_BILLING_RESPONSE_INVALID");
          }
          return sum + amount;
        }, 0);
        if (value.length > 0 && total > 0) {
          stable = last === total ? stable + 1 : 1;
          last = total;
          if (stable >= 3) return total;
        }
      } catch (error) {
        if (!(error instanceof Cp07PhaseBError) || error.code === "CP07_BILLING_RESPONSE_INVALID") {
          throw error;
        }
      }
      await sleep(5_000);
    }
    return null;
  }
}

const normalizeTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const direct = new Date(value);
  if (Number.isFinite(direct.getTime()) && direct.toISOString() === value) return value;
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) \+0000 UTC$/u.exec(value);
  if (!match) return null;
  const normalized = `${match[1]}T${match[2]}Z`;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === normalized
    ? normalized
    : null;
};

const assertPublicImage = async (
  imageDigest: string,
  fetchPort: FetchPort = fetch,
): Promise<void> => {
  const digest = imageDigest.split("@")[1];
  if (!CP07_IMAGE.test(imageDigest) || digest === undefined || !SHA256.test(digest)) {
    throw new Cp07PhaseBError("CP07_IMAGE_DIGEST_INVALID");
  }
  const manifestUrl = `https://ghcr.io/v2/${CATALOG_IMAGE_REPOSITORY}/manifests/${digest}`;
  const accept =
    "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";
  let response = await fetchPort(manifestUrl, {
    method: "HEAD",
    headers: { accept },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? "";
    const realm = /realm="([^"]+)"/u.exec(challenge)?.[1];
    const service = /service="([^"]+)"/u.exec(challenge)?.[1];
    const scope = /scope="([^"]+)"/u.exec(challenge)?.[1];
    if (
      !realm ||
      service !== "ghcr.io" ||
      scope !== `repository:${CATALOG_IMAGE_REPOSITORY}:pull`
    ) {
      throw new Cp07PhaseBError("CP07_IMAGE_AUTH_CHALLENGE_INVALID");
    }
    const tokenUrl = new URL(realm);
    tokenUrl.searchParams.set("service", service);
    tokenUrl.searchParams.set("scope", scope);
    const tokenResponse = await fetchPort(tokenUrl, { signal: AbortSignal.timeout(30_000) });
    const token = record(tokenResponse.ok ? await tokenResponse.json() : null)?.token;
    if (typeof token !== "string" || token.length < 20 || /\s/u.test(token)) {
      throw new Cp07PhaseBError("CP07_IMAGE_PULL_TOKEN_INVALID");
    }
    response = await fetchPort(manifestUrl, {
      method: "HEAD",
      headers: { accept, authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  }
  if (!response.ok || response.headers.get("docker-content-digest") !== digest) {
    throw new Cp07PhaseBError("CP07_IMAGE_PUBLIC_PULL_UNPROVEN");
  }
};

const pollWorker = async (
  podId: string,
  timeoutSeconds: number,
  terminal: (health: JsonRecord) => boolean,
): Promise<JsonRecord> => {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let last: JsonRecord | null = null;
  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`${proxyUrl(podId)}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      last = record(response.ok ? await response.json() : null);
      if (last && terminal(last)) return last;
    } catch {
      // Image pull and worker startup legitimately precede proxy availability.
    }
    await sleep(3_000);
  }
  throw new Cp07PhaseBError(last ? "CP07_WORKER_TERMINAL_TIMEOUT" : "CP07_WORKER_UNREACHABLE");
};

const writePrivate = async (filePath: string, bytes: Buffer): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, bytes, { mode: 0o600, flag: "wx" });
  await chmod(filePath, 0o600);
};

const probeMp4 = async (filePath: string): Promise<JsonRecord> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,r_frame_rate,duration:format=duration,size",
    "-of",
    "json",
    filePath,
  ]);
  const value = record(JSON.parse(stdout));
  if (!value || !Array.isArray(value.streams) || !record(value.format)) {
    throw new Cp07PhaseBError("CP07_OUTPUT_PROBE_INVALID");
  }
  return value;
};

const makePaddedWav = async (
  sourceAudio: string,
  destination: string,
  paddedDurationSeconds: number,
): Promise<Buffer> => {
  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    sourceAudio,
    "-t",
    paddedDurationSeconds.toFixed(3),
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    destination,
  ]);
  return readFile(destination);
};

const deleteOwnedPod = async (
  client: RunPodCp07Client,
  pod: ProviderPod,
): Promise<DeletedPodEvidence> => {
  const startedDelete = Date.now();
  await client.deletePodAndConfirm(pod.id);
  const deletedAt = new Date().toISOString();
  const elapsedSeconds = Math.max(
    1,
    Math.ceil((new Date(deletedAt).getTime() - new Date(pod.startedAt).getTime()) / 1_000) + 60,
  );
  const elapsedCostUpperBoundUsd =
    Math.ceil((elapsedSeconds / 3_600) * pod.costPerHourUsd * 1_000_000) / 1_000_000;
  const settledCostUsd = await client.settledCost(pod.id, pod.startedAt, deletedAt);
  return {
    podIdHash: sha256(pod.id),
    startedAt: pod.startedAt,
    deletedAt,
    elapsedCostUpperBoundUsd,
    settledCostUsd,
    deleteMs: Date.now() - startedDelete,
    absenceProven: true,
  };
};

export async function runCp07PhaseB(options: {
  readonly imageDigest: string;
  readonly sourceImagePath: string;
  readonly sourceAudioPath: string;
  readonly artifactRoot: string;
}): Promise<JsonRecord> {
  if (!CP07_IMAGE.test(options.imageDigest) || !path.isAbsolute(options.artifactRoot)) {
    throw new Cp07PhaseBError("CP07_EXECUTION_INPUT_INVALID");
  }
  const apiKey = await loadSujalRunPodApiKeyFromKeychain();
  const account = await assertSujalRunPodAccount(apiKey);
  if (account.accountIdHash !== CP07_ACCOUNT_HASH) {
    throw new Cp07PhaseBError("CP07_ACCOUNT_IDENTITY_MISMATCH");
  }
  const candidates = await fetchCp07Catalog(apiKey);
  const selected = candidates.find((candidate) => candidate.offeringId === CP07_GPU);
  if (
    !selected ||
    selected.region !== CP07_REGION ||
    selected.rateUsdPerHour !== CP07_GPU_RATE_USD_PER_HOUR ||
    selected.vramGb !== 24
  ) {
    throw new Cp07PhaseBError("CP07_SELECTED_GPU_DRIFT");
  }
  await assertPublicImage(options.imageDigest);
  const client = new RunPodCp07Client(apiKey);
  const startingVolumes = await client.listVolumes();
  if ((await client.listAllPods()).length !== 0) {
    throw new Cp07PhaseBError("CP07_STARTING_PODS_PRESENT");
  }
  const namedVolumes = startingVolumes.filter((volume) => volume.name === CP07_VOLUME_NAME);
  const invalidEchoHash = assertCp07ReplacementInventory(
    startingVolumes.map((volume) => ({
      idHash: sha256(volume.id),
      name: volume.name,
      size: volume.size,
      dataCenterId: volume.dataCenterId,
    })),
  );
  const invalidEchoVolume = namedVolumes.find((volume) => sha256(volume.id) === invalidEchoHash);
  if (invalidEchoVolume === undefined) throw new Cp07PhaseBError("CP07_ECHO_VOLUME_AMBIGUOUS");
  const startingTemplates = await client.listTemplates();
  const existingTemplates = startingTemplates.filter(
    (template) => template.name === CP07_TEMPLATE_NAME,
  );
  if (startingTemplates.length !== 0 || existingTemplates.length !== 0) {
    throw new Cp07PhaseBError("CP07_TEMPLATE_ALREADY_EXISTS");
  }

  await client.deleteInvalidEchoVolumeAndConfirm(invalidEchoVolume);
  const volume = await client.createVolume();
  if (sha256(volume.id) === CP07_INVALID_ECHO_VOLUME_ID_HASH) {
    throw new Cp07PhaseBError("CP07_RECREATED_VOLUME_IDENTITY_REUSED");
  }
  let template: ProviderTemplate | null = null;
  let activePod: ProviderPod | null = null;
  const deletionEvidence: DeletedPodEvidence[] = [];
  let conservativeCostUsd = 0;
  const sourceBytes = await readFile(options.sourceImagePath);
  const sourceHash = sha256(sourceBytes);
  const samples: JsonRecord[] = [];
  let manifestSha256: string | null = null;
  try {
    template = await client.createTemplate(options.imageDigest);
    const prepAuthority: PodAuthority = {
      name: "videoforge-echo-cp07-prep-a01",
      templateId: template.id,
      imageDigest: options.imageDigest,
      volumeId: volume.id,
      volumeIdHash: sha256(volume.id),
      mode: "prepare",
    };
    const prepMaximumSeconds = 5_100;
    assertCp07CumulativeReservation(conservativeCostUsd, prepMaximumSeconds);
    activePod = await client.createPod(prepAuthority);
    const prepHealth = await pollWorker(
      activePod.id,
      prepMaximumSeconds,
      (health) => health.phase === "ready" || health.phase === "failed",
    );
    await writePrivate(
      path.join(options.artifactRoot, "preparation-terminal.private.json"),
      Buffer.from(`${JSON.stringify(prepHealth, null, 2)}\n`),
    );
    const prepVolume = record(prepHealth.volume);
    const prepModel = record(prepHealth.model);
    if (
      prepHealth.schema_version !== "videoforge.echo-flash-turbo-fp8-preparation-health/v1" ||
      prepHealth.phase !== "ready" ||
      prepHealth.error_code !== null ||
      prepModel?.runtime_profile_id !== "videoforge_echo_v3_flash_turbo_fp8_v1" ||
      prepVolume?.requested_size_gb !== CP07_VOLUME_SIZE_GB ||
      prepVolume.volume_id_sha256 !== sha256(volume.id) ||
      typeof prepVolume.manifest_sha256 !== "string" ||
      !SHA256.test(prepVolume.manifest_sha256)
    ) {
      throw new Cp07PhaseBError("CP07_PREPARATION_RESULT_INVALID");
    }
    manifestSha256 = prepVolume.manifest_sha256;
    const prepDeletion = await deleteOwnedPod(client, activePod);
    deletionEvidence.push(prepDeletion);
    conservativeCostUsd += prepDeletion.elapsedCostUpperBoundUsd;
    assertCp07ObservedCost(conservativeCostUsd);
    activePod = null;

    for (const durationSeconds of [2, 4, 6] as const) {
      const sampleId = `cp07-owned-${durationSeconds}s`;
      const sampleDirectory = path.join(options.artifactRoot, sampleId);
      await mkdir(sampleDirectory, { recursive: true, mode: 0o700 });
      const wavPath = path.join(sampleDirectory, "padded.wav");
      const paddedDurationSeconds = durationSeconds + 0.5;
      const audioBytes = await makePaddedWav(
        options.sourceAudioPath,
        wavPath,
        paddedDurationSeconds,
      );
      const sampleMaximumSeconds = 2_700;
      assertCp07CumulativeReservation(conservativeCostUsd, sampleMaximumSeconds);
      const workerToken = randomBytes(32).toString("base64url");
      const authority: PodAuthority = {
        name: `videoforge-echo-cp07-${durationSeconds}s-a01`,
        templateId: template.id,
        imageDigest: options.imageDigest,
        volumeId: volume.id,
        volumeIdHash: sha256(volume.id),
        mode: "runtime",
        workerToken,
      };
      activePod = await client.createPod(authority);
      const health = await pollWorker(
        activePod.id,
        sampleMaximumSeconds,
        (candidate) => candidate.phase === "ready" || candidate.phase === "error",
      );
      const model = record(health.model);
      const gpu = record(health.gpu);
      if (
        health.schema_version !== "videoforge.echo-flash-turbo-fp8-worker-health/v1" ||
        health.phase !== "ready" ||
        health.error_code !== null ||
        model?.runtime_profile_id !== "videoforge_echo_v3_flash_turbo_fp8_v1" ||
        model.status !== "ready" ||
        model.real_warmup_complete !== true ||
        gpu?.offering_id !== CP07_GPU ||
        gpu.approved !== true
      ) {
        throw new Cp07PhaseBError("CP07_MODEL_READY_INVALID");
      }
      const request = {
        mode: "OWNED_CP07_QUALIFICATION_V1",
        schema_version: "videoforge.echo-span-job/v1",
        project_revision_id: "vf-9-24r-owned-qualification",
        span_id: sampleId,
        task_key: sampleId,
        attempt_id: `${sampleId}-a01`,
        timeline_composition: durationSeconds === 4 ? "AVATAR_SPLIT_IMAGE" : "AVATAR_FULL",
        source_base64: sourceBytes.toString("base64"),
        source_sha256: sourceHash,
        span_audio_base64: audioBytes.toString("base64"),
        span_audio_sha256: sha256(audioBytes),
        prompt:
          "A natural direct-to-camera presenter speaking calmly with restrained head and upper-body motion.",
        selected_start_ms: 0,
        selected_end_ms_exclusive: durationSeconds * 1_000,
        padded_start_ms: 0,
        padded_end_ms_exclusive: paddedDurationSeconds * 1_000,
        trim_start_ms: 0,
        trim_end_ms_exclusive: durationSeconds * 1_000,
        audio_sample_rate_hz: 16_000,
        audio_channels: 1,
        full_voiceover_dispatched: false,
      };
      const generationStarted = Date.now();
      const response = await fetch(`${proxyUrl(activePod.id)}/generate`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${workerToken}`,
          "content-type": "application/json",
        },
        body: canonicalizeJson(request),
        signal: AbortSignal.timeout(sampleMaximumSeconds * 1_000),
      });
      if (!response.ok) {
        const failure = Buffer.from((await response.text()).slice(0, 20_000));
        await writePrivate(path.join(sampleDirectory, "failure.private.txt"), failure);
        throw new Cp07PhaseBError(`CP07_GENERATION_HTTP_${response.status}`);
      }
      const result = record(await response.json());
      const outputBase64 = result?.output_base64;
      if (
        result?.schema_version !== "videoforge.echo-qualification-result/v1" ||
        result.output_sha256 === undefined ||
        typeof outputBase64 !== "string"
      ) {
        throw new Cp07PhaseBError("CP07_GENERATION_RESULT_INVALID");
      }
      const output = Buffer.from(outputBase64, "base64");
      if (sha256(output) !== result.output_sha256 || output.length !== result.output_bytes) {
        throw new Cp07PhaseBError("CP07_GENERATION_OUTPUT_HASH_MISMATCH");
      }
      const outputPath = path.join(sampleDirectory, `${sampleId}.mp4`);
      await writePrivate(outputPath, output);
      const probe = await probeMp4(outputPath);
      const runtimeEvidence = record(result.runtime_evidence);
      const bootstrap = record(runtimeEvidence?.bootstrap);
      if (
        bootstrap?.manifest_sha256 !== manifestSha256 ||
        bootstrap.registry_access_allowed !== false ||
        bootstrap.downloaded_model_bytes !== 0 ||
        bootstrap.material_quantization_performed !== false
      ) {
        throw new Cp07PhaseBError("CP07_OFFLINE_RUNTIME_EVIDENCE_INVALID");
      }
      samples.push({
        sample_id: sampleId,
        duration_seconds: durationSeconds,
        output_path: outputPath,
        output_sha256: sha256(output),
        output_bytes: output.length,
        probe,
        model_ready_health: health,
        generation_result: { ...result, output_base64: "[private output omitted]" },
        request_total_ms: Date.now() - generationStarted,
      });
      const deletion = await deleteOwnedPod(client, activePod);
      deletionEvidence.push(deletion);
      conservativeCostUsd += deletion.elapsedCostUpperBoundUsd;
      assertCp07ObservedCost(conservativeCostUsd);
      activePod = null;
    }
  } finally {
    if (activePod !== null) {
      const deletion = await deleteOwnedPod(client, activePod);
      deletionEvidence.push(deletion);
      conservativeCostUsd += deletion.elapsedCostUpperBoundUsd;
      assertCp07ObservedCost(conservativeCostUsd);
      activePod = null;
    }
    if (template !== null) await client.deleteTemplate(template.id);
  }

  const finalVolumes = await client.listVolumes();
  const finalPods = await client.listAllPods();
  const finalTemplates = (await client.listTemplates()).filter(
    (candidate) => candidate.name === CP07_TEMPLATE_NAME,
  );
  if (
    finalPods.length !== 0 ||
    finalVolumes.length !== 2 ||
    finalVolumes.filter((candidate) => candidate.name === CP07_VOLUME_NAME).length !== 1 ||
    finalTemplates.length !== 0
  ) {
    throw new Cp07PhaseBError("CP07_FINAL_RESOURCE_AUDIT_FAILED");
  }
  const settledValues = deletionEvidence.map((item) => item.settledCostUsd);
  const allSettled = settledValues.every((value): value is number => value !== null);
  const evidence: JsonRecord = {
    schema_version: "videoforge.cp07-phase-b-evidence/v1",
    checkpoint: "CP-07",
    completed_at: new Date().toISOString(),
    runtime_profile_id: "videoforge_echo_v3_flash_turbo_fp8_v1",
    image_digest: options.imageDigest,
    gpu: {
      offering_id: CP07_GPU,
      region: CP07_REGION,
      rate_usd_per_hour: CP07_GPU_RATE_USD_PER_HOUR,
      vram_gb: 24,
    },
    volume: {
      id_sha256: sha256(volume.id),
      size_gb: CP07_VOLUME_SIZE_GB,
      retained: true,
      ongoing_usd_per_month: 3.5,
      manifest_sha256: manifestSha256,
    },
    source: { image_sha256: sourceHash },
    samples,
    pod_deletions: deletionEvidence,
    finite_cost: {
      cap_usd: CP07_CAP_USD,
      prior_conservative_upper_bound_usd: CP07_PRIOR_CONSERVATIVE_SPEND_USD,
      retry_conservative_elapsed_upper_bound_usd: conservativeCostUsd,
      cumulative_conservative_upper_bound_usd:
        CP07_PRIOR_CONSERVATIVE_SPEND_USD + conservativeCostUsd,
      settled: allSettled,
      settled_usd: allSettled
        ? (settledValues as number[]).reduce((sum, value) => sum + value, 0)
        : null,
    },
    final_resource_audit: {
      pods: 0,
      cp07_templates: 0,
      network_volumes: 2,
      isolated_mage_and_echo_volumes: true,
    },
  };
  await writePrivate(
    path.join(options.artifactRoot, "acceptance.private.json"),
    Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
  );
  return evidence;
}
