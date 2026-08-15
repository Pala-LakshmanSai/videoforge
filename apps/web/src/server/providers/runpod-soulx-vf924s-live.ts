import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import { fetchCp07Catalog } from "./runpod-echo-cp07-preflight";

const REST = "https://rest.runpod.io/v1";
const ACCOUNT_HASH = "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const MAGE_VOLUME_HASH = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const ECHO_VOLUME_HASH = "sha256:cc4160b3ade65a0d715eb993e0a05c330703013adf10f1e50ff270d6b917440f";
const ECHO_VOLUME_NAME = "videoforge-echo-cp07-model-volume-eu-ro-1-50gb";
const SOULX_VOLUME_NAME = "videoforge-soulx-flashhead-pro-vf924s-eu-ro-1-50gb";
const SOULX_VOLUME_HASH = "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const TEMPLATE_NAME = "videoforge-soulx-flashhead-pro-vf924s-template";
const IMAGE_PATTERN =
  /^ghcr\.io\/pala-lakshmansai\/videoforge-soulx-flashhead-pro-vf924s@sha256:[a-f0-9]{64}$/u;
const MANIFEST_SHA256 = "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626";
const REGION = "EU-RO-1";
const GPU = "NVIDIA GeForce RTX 4090";
const GPU_RATE = 0.74;
const GPU_VRAM_GB = 24;
const VOLUME_SIZE_GB = 50;
const FINITE_CAP_USD = 4;
const PRIOR_FAILED_ATTEMPT_CONSERVATIVE_USD = 0.2;
const POD_LIFECYCLE_RESERVE_SECONDS = 120;
const PREP_TIMEOUT_SECONDS = 1_800;
const RUNTIME_READY_TIMEOUT_SECONDS = 1_800;
const GENERATION_TIMEOUT_SECONDS = 1_200;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const PROXY = /^https:\/\/[A-Za-z0-9_-]+-8000\.proxy\.runpod\.net$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const execFileAsync = promisify(execFile);

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const sha256 = (value: string | Buffer): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const sanitize = (value: string): string =>
  value
    .replace(/https?:\/\/\S+/gu, "[redacted-url]")
    .replace(/[A-Za-z0-9_-]{20,}/gu, "[redacted-token]")
    .slice(0, 400);

const proxyUrl = (podId: string): string => {
  const url = `https://${podId}-8000.proxy.runpod.net`;
  if (!PROXY.test(url)) throw new Error("VF924S_PROXY_INVALID");
  return url;
};

interface Volume {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly dataCenterId: string;
}

interface Template {
  readonly id: string;
  readonly name: string;
  readonly imageName: string;
}

interface Pod {
  readonly id: string;
  readonly name: string;
  readonly startedAt: string;
  readonly costPerHour: number;
  readonly startedAtSource: "lastStartedAt" | "createdAt" | "clientRequestedAt";
}

interface DeletedPod {
  readonly pod_id_sha256: string;
  readonly started_at: string;
  readonly deleted_at: string;
  readonly elapsed_cost_upper_bound_usd: number;
  readonly settled_cost_usd: number | null;
  readonly absence_proven: true;
}

class RunPodClient {
  constructor(private readonly apiKey: string) {}

  private async request(
    method: "GET" | "POST" | "DELETE",
    route: string,
    body?: JsonRecord,
    notFoundIsNull = false,
  ): Promise<unknown | null> {
    let response: Response;
    try {
      response = await fetch(`${REST}${route}`, {
        method,
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(
        method === "GET" ? "VF924S_PROVIDER_READ_AMBIGUOUS" : "VF924S_MUTATION_AMBIGUOUS",
      );
    }
    if (notFoundIsNull && response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `VF924S_PROVIDER_${method}_FAILED:${response.status}:${sanitize(await response.text())}`,
      );
    }
    if (response.status === 204) return null;
    return JSON.parse(await response.text()) as unknown;
  }

  async listVolumes(): Promise<readonly Volume[]> {
    const value = await this.request("GET", "/networkvolumes");
    if (!Array.isArray(value)) throw new Error("VF924S_VOLUME_LIST_INVALID");
    return value.map((candidate) => {
      const item = record(candidate);
      if (
        typeof item?.id !== "string" ||
        !ID.test(item.id) ||
        typeof item.name !== "string" ||
        !Number.isSafeInteger(item.size) ||
        typeof item.dataCenterId !== "string"
      ) {
        throw new Error("VF924S_VOLUME_LIST_INVALID");
      }
      return {
        id: item.id,
        name: item.name,
        size: item.size as number,
        dataCenterId: item.dataCenterId,
      };
    });
  }

  async listPods(): Promise<readonly JsonRecord[]> {
    const value = await this.request(
      "GET",
      "/pods?includeMachine=true&includeNetworkVolume=true&includeTemplate=true&includeWorkers=false",
    );
    if (!Array.isArray(value) || value.some((item) => record(item) === null)) {
      throw new Error("VF924S_POD_LIST_INVALID");
    }
    return value as readonly JsonRecord[];
  }

  async listTemplates(): Promise<readonly Template[]> {
    const value = await this.request(
      "GET",
      "/templates?includeEndpointBoundTemplates=false&includePublicTemplates=false&includeRunpodTemplates=false",
    );
    if (!Array.isArray(value)) throw new Error("VF924S_TEMPLATE_LIST_INVALID");
    return value.map((candidate) => {
      const item = record(candidate);
      if (
        typeof item?.id !== "string" ||
        !ID.test(item.id) ||
        typeof item.name !== "string" ||
        typeof item.imageName !== "string"
      ) {
        throw new Error("VF924S_TEMPLATE_LIST_INVALID");
      }
      return { id: item.id, name: item.name, imageName: item.imageName };
    });
  }

  async deleteVolume(volume: Volume): Promise<void> {
    if (
      volume.name !== ECHO_VOLUME_NAME ||
      volume.size !== VOLUME_SIZE_GB ||
      volume.dataCenterId !== REGION ||
      sha256(volume.id) !== ECHO_VOLUME_HASH
    ) {
      throw new Error("VF924S_ECHO_VOLUME_IDENTITY_MISMATCH");
    }
    await this.request("DELETE", `/networkvolumes/${volume.id}`);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if ((await this.listVolumes()).every((item) => item.id !== volume.id)) return;
      await sleep(2_000);
    }
    throw new Error("VF924S_ECHO_VOLUME_ABSENCE_UNCONFIRMED");
  }

  async createVolume(): Promise<Volume> {
    const created = record(
      await this.request("POST", "/networkvolumes", {
        dataCenterId: REGION,
        name: SOULX_VOLUME_NAME,
        size: VOLUME_SIZE_GB,
      }),
    );
    if (typeof created?.id !== "string" || !ID.test(created.id)) {
      throw new Error("VF924S_VOLUME_CREATE_INVALID");
    }
    const exact = (await this.listVolumes()).filter((item) => item.name === SOULX_VOLUME_NAME);
    const selected = exact[0];
    if (
      exact.length !== 1 ||
      selected === undefined ||
      selected.id !== created.id ||
      selected.size !== VOLUME_SIZE_GB ||
      selected.dataCenterId !== REGION
    ) {
      throw new Error("VF924S_VOLUME_CREATE_IDENTITY_UNCONFIRMED");
    }
    return selected;
  }

  async createTemplate(
    imageDigest: string,
    templateName = TEMPLATE_NAME,
    taskId = "VF-9-24S",
  ): Promise<Template> {
    const created = record(
      await this.request("POST", "/templates", {
        category: "NVIDIA",
        containerDiskInGb: 50,
        dockerEntrypoint: [],
        dockerStartCmd: [],
        env: {
          DIFFUSERS_OFFLINE: "1",
          HF_HUB_OFFLINE: "1",
          SOULX_MODEL_ROOT: "/runpod-volume/soulx-flashhead-pro",
          SOULX_MODE: "runtime",
          TRANSFORMERS_OFFLINE: "1",
        },
        imageName: imageDigest,
        isPublic: false,
        isServerless: false,
        name: templateName,
        ports: ["8000/http"],
        readme: `VideoForge exact SoulX-FlashHead Pro ${taskId} Pod worker`,
        volumeInGb: 0,
        volumeMountPath: "/runpod-volume",
      }),
    );
    if (typeof created?.id !== "string" || !ID.test(created.id)) {
      throw new Error("VF924S_TEMPLATE_CREATE_INVALID");
    }
    const exact = (await this.listTemplates()).filter((item) => item.name === templateName);
    if (exact.length !== 1 || exact[0]?.id !== created.id || exact[0].imageName !== imageDigest) {
      throw new Error("VF924S_TEMPLATE_CREATE_IDENTITY_UNCONFIRMED");
    }
    return exact[0];
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.request("DELETE", `/templates/${id}`);
    for (let attempt = 0; attempt < 15; attempt += 1) {
      if ((await this.request("GET", `/templates/${id}`, undefined, true)) === null) return;
      await sleep(2_000);
    }
    throw new Error("VF924S_TEMPLATE_ABSENCE_UNCONFIRMED");
  }

  async createPod(input: {
    readonly name: string;
    readonly templateId: string;
    readonly imageDigest: string;
    readonly volume: Volume;
    readonly mode: "prepare" | "runtime";
    readonly token?: string;
    readonly requireProviderStartedAt?: boolean;
  }): Promise<Pod> {
    const requestedAt = new Date().toISOString();
    const body = {
      allowedCudaVersions: ["12.8"],
      cloudType: "SECURE",
      computeType: "GPU",
      containerDiskInGb: 50,
      dataCenterIds: [REGION],
      dataCenterPriority: "custom",
      dockerEntrypoint: [],
      dockerStartCmd: [],
      env: {
        SOULX_MODEL_ROOT: "/runpod-volume/soulx-flashhead-pro",
        SOULX_MODE: input.mode,
        ...(input.token === undefined ? {} : { VIDEOFORGE_SOULX_WORKER_TOKEN: input.token }),
      },
      globalNetworking: false,
      gpuCount: 1,
      gpuTypeIds: [GPU],
      gpuTypePriority: "custom",
      imageName: input.imageDigest,
      interruptible: false,
      locked: false,
      name: input.name,
      networkVolumeId: input.volume.id,
      ports: ["8000/http"],
      supportPublicIp: false,
      templateId: input.templateId,
      volumeInGb: 0,
      volumeMountPath: "/runpod-volume",
    };
    let created: JsonRecord | null = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        created = record(await this.request("POST", "/pods", body));
        break;
      } catch (error) {
        if (!String(error).includes("There are no instances currently available")) throw error;
        await sleep(15_000);
      }
    }
    if (typeof created?.id !== "string" || !ID.test(created.id)) {
      throw new Error("VF924S_POD_CREATE_INVALID");
    }
    const podId = created.id;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const item = record(
        await this.request(
          "GET",
          `/pods/${podId}?includeMachine=true&includeNetworkVolume=true&includeTemplate=true`,
        ),
      );
      const machine = record(item?.machine);
      const volume = record(item?.networkVolume);
      const cost = finite(item?.adjustedCostPerHr ?? item?.costPerHr);
      const providerLastStartedAt = normalizeTime(item?.lastStartedAt);
      const providerCreatedAt = normalizeTime(item?.createdAt);
      const startedAt = providerLastStartedAt ?? providerCreatedAt ?? requestedAt;
      const startedAtSource = providerLastStartedAt
        ? "lastStartedAt"
        : providerCreatedAt
          ? "createdAt"
          : "clientRequestedAt";
      if (
        item?.name === input.name &&
        item.templateId === input.templateId &&
        (item.image === input.imageDigest || item.imageName === input.imageDigest) &&
        item.volumeMountPath === "/runpod-volume" &&
        item.volumeInGb === 0 &&
        machine?.gpuTypeId === GPU &&
        machine.dataCenterId === REGION &&
        machine.secureCloud === true &&
        volume?.id === input.volume.id &&
        cost !== null &&
        cost > 0 &&
        cost <= GPU_RATE &&
        startedAt !== null &&
        (!input.requireProviderStartedAt || startedAtSource === "lastStartedAt")
      ) {
        return { id: podId, name: input.name, startedAt, costPerHour: cost, startedAtSource };
      }
      await sleep(1_000);
    }
    await this.deletePod(podId);
    throw new Error("VF924S_POD_IDENTITY_MISMATCH");
  }

  async deletePod(id: string): Promise<void> {
    try {
      await this.request("DELETE", `/pods/${id}`);
    } catch (error) {
      if (!String(error).includes("404")) throw error;
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
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
    throw new Error("VF924S_POD_ABSENCE_UNCONFIRMED");
  }

  async settledCost(podId: string, startedAt: string, deletedAt: string): Promise<number | null> {
    const query = new URLSearchParams({
      bucketSize: "hour",
      grouping: "podId",
      podId,
      startTime: startedAt,
      endTime: deletedAt,
    });
    let prior: number | null = null;
    let stable = 0;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const rows = await this.request("GET", `/billing/pods?${query.toString()}`);
      if (!Array.isArray(rows)) throw new Error("VF924S_BILLING_INVALID");
      const total = rows.reduce((sum, row) => {
        const item = record(row);
        const amount = finite(item?.amount);
        if (item?.podId !== podId || amount === null) throw new Error("VF924S_BILLING_INVALID");
        return sum + amount;
      }, 0);
      if (rows.length > 0 && total > 0) {
        stable = total === prior ? stable + 1 : 1;
        prior = total;
        if (stable >= 3) return total;
      }
      await sleep(5_000);
    }
    return null;
  }
}

const normalizeTime = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const direct = new Date(value);
  if (Number.isFinite(direct.getTime())) return direct.toISOString();
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3}) \+0000 UTC$/u.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}Z`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const pollHealth = async (
  podId: string,
  timeoutSeconds: number,
  expectedSchema: string,
): Promise<JsonRecord> => {
  const deadline = Date.now() + timeoutSeconds * 1_000;
  let last: JsonRecord | null = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${proxyUrl(podId)}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      last = record(response.ok ? await response.json() : null);
      if (last?.state === "failed")
        throw new Error(`VF924S_WORKER_FAILED:${sanitize(String(last.error))}`);
      if (last?.schema_version === expectedSchema && last.state === "ready") return last;
    } catch (error) {
      if (String(error).includes("VF924S_WORKER_FAILED")) throw error;
    }
    await sleep(3_000);
  }
  throw new Error(last === null ? "VF924S_WORKER_UNREACHABLE" : "VF924S_WORKER_TIMEOUT");
};

const deletePodEvidence = async (client: RunPodClient, pod: Pod): Promise<DeletedPod> => {
  await client.deletePod(pod.id);
  const deletedAt = new Date().toISOString();
  const elapsedSeconds = Math.max(
    1,
    Math.ceil((new Date(deletedAt).getTime() - new Date(pod.startedAt).getTime()) / 1_000) +
      POD_LIFECYCLE_RESERVE_SECONDS,
  );
  const upperBound = Math.ceil((elapsedSeconds / 3_600) * pod.costPerHour * 1_000_000) / 1_000_000;
  return {
    pod_id_sha256: sha256(pod.id),
    started_at: pod.startedAt,
    deleted_at: deletedAt,
    elapsed_cost_upper_bound_usd: upperBound,
    settled_cost_usd: await client.settledCost(pod.id, pod.startedAt, deletedAt),
    absence_proven: true,
  };
};

const assertPublicImage = async (imageDigest: string): Promise<void> => {
  if (!IMAGE_PATTERN.test(imageDigest)) throw new Error("VF924S_IMAGE_INVALID");
  const digest = imageDigest.split("@")[1];
  const repository = "pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s";
  const url = `https://ghcr.io/v2/${repository}/manifests/${digest}`;
  const accept = "application/vnd.oci.image.manifest.v1+json";
  let response = await fetch(url, { method: "HEAD", headers: { accept } });
  if (response.status === 401) {
    const challenge = response.headers.get("www-authenticate") ?? "";
    const realm = /realm="([^"]+)"/u.exec(challenge)?.[1];
    if (!realm) throw new Error("VF924S_IMAGE_CHALLENGE_INVALID");
    const tokenUrl = new URL(realm);
    tokenUrl.searchParams.set("service", "ghcr.io");
    tokenUrl.searchParams.set("scope", `repository:${repository}:pull`);
    const token = record(await (await fetch(tokenUrl)).json())?.token;
    if (typeof token !== "string") throw new Error("VF924S_IMAGE_TOKEN_INVALID");
    response = await fetch(url, {
      method: "HEAD",
      headers: { accept, authorization: `Bearer ${token}` },
    });
  }
  if (!response.ok || response.headers.get("docker-content-digest") !== digest) {
    throw new Error("VF924S_IMAGE_PUBLIC_PULL_UNPROVEN");
  }
};

const probeMedia = async (mediaPath: string): Promise<JsonRecord> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-count_frames",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,r_frame_rate,duration,nb_read_frames:format=duration,size",
    "-of",
    "json",
    mediaPath,
  ]);
  const probe = record(JSON.parse(stdout));
  if (!probe || !Array.isArray(probe.streams)) throw new Error("VF924S_OUTPUT_PROBE_INVALID");
  return probe;
};

const assertMediaContract = (
  probe: JsonRecord,
  expected: {
    readonly width: number;
    readonly height: number;
    readonly fps: string;
    readonly frames: number;
  },
): JsonRecord => {
  const streams = Array.isArray(probe.streams) ? probe.streams.map(record) : [];
  const video = streams.find((stream) => stream?.codec_type === "video");
  const audio = streams.find((stream) => stream?.codec_type === "audio");
  const format = record(probe.format);
  const videoDuration = finite(video?.duration);
  const audioDuration = finite(audio?.duration);
  const formatDuration = finite(format?.duration);
  const frames = finite(video?.nb_read_frames);
  if (
    video?.codec_name !== "h264" ||
    video.width !== expected.width ||
    video.height !== expected.height ||
    video.r_frame_rate !== expected.fps ||
    frames !== expected.frames ||
    audio?.codec_name !== "aac" ||
    videoDuration === null ||
    audioDuration === null ||
    formatDuration === null ||
    Math.abs(videoDuration - 10) > 0.001 ||
    Math.abs(audioDuration - 10) > 0.01 ||
    Math.abs(formatDuration - 10) > 0.01 ||
    Math.abs(videoDuration - audioDuration) > 0.01
  ) {
    throw new Error("VF924T_MEDIA_CONTRACT_MISMATCH");
  }
  return {
    width: expected.width,
    height: expected.height,
    fps: expected.fps,
    frames,
    video_duration_seconds: videoDuration,
    audio_duration_seconds: audioDuration,
    format_duration_seconds: formatDuration,
    av_duration_delta_seconds: Math.abs(videoDuration - audioDuration),
  };
};

const previewOutputArgs = (outputPath: string): string[] => [
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "15",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-ar",
  "48000",
  "-ac",
  "2",
  "-t",
  "10.000",
  "-movflags",
  "+faststart",
  outputPath,
];

const summarizePreview = async (outputPath: string): Promise<JsonRecord> => {
  const bytes = await readFile(outputPath);
  const probe = await probeMedia(outputPath);
  return {
    path: outputPath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    probe,
    media_contract: assertMediaContract(probe, {
      width: 1920,
      height: 1080,
      fps: "30/1",
      frames: 300,
    }),
  };
};

const renderRangaFullPreview = async (
  nativePath: string,
  sourceImagePath: string,
  outputPath: string,
  profile: "elias-wide-v1" | "source-16x9-v1",
): Promise<JsonRecord> => {
  const backgroundFilter =
    profile === "source-16x9-v1"
      ? "[0:v]scale=1920:1080:flags=lanczos,fps=30[bg];"
      : "[0:v]crop=2500:1406:30:0,scale=1920:1080:flags=lanczos,fps=30[bg];";
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    sourceImagePath,
    "-i",
    nativePath,
    "-filter_complex",
    backgroundFilter +
      "[1:v]scale=1080:1080:flags=lanczos,fps=30,format=rgba[fg];" +
      "color=white:s=1080x1080:r=30:d=10,format=gray," +
      "geq=lum='if(lt(X,32),255*X/32,if(gt(X,W-33),255*(W-1-X)/32,255))'[mask];" +
      "[fg][mask]alphamerge[fgf];[bg][fgf]overlay=420:0:shortest=1[v]",
    "-map",
    "[v]",
    "-map",
    "1:a:0",
    ...previewOutputArgs(outputPath),
  ]);
  return summarizePreview(outputPath);
};

const renderRangaSplitPreview = async (
  nativePath: string,
  contextImagePath: string,
  outputPath: string,
): Promise<JsonRecord> => {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-n",
    "-i",
    nativePath,
    "-loop",
    "1",
    "-framerate",
    "30",
    "-i",
    contextImagePath,
    "-filter_complex",
    "[0:v]crop=448:504:32:4,scale=960:1080:flags=lanczos,fps=30[left];" +
      "[1:v]scale=1920:1080:force_original_aspect_ratio=increase:flags=lanczos," +
      "crop=960:1080,zoompan=z=min(zoom+0.000133333\\,1.04):d=300:s=960x1080:fps=30[right];" +
      "[left][right]hstack=inputs=2[v]",
    "-map",
    "[v]",
    "-map",
    "0:a:0",
    ...previewOutputArgs(outputPath),
  ]);
  return summarizePreview(outputPath);
};

export function projectSoulXAvatarEconomics(input: {
  readonly outputDurationSeconds: number;
  readonly generationWallMs: number;
  readonly podStartToReadyMs: number;
  readonly rateUsdPerHour: number;
  readonly paddedAvatarSeconds?: number;
  readonly spanCount?: number;
}): JsonRecord {
  const paddedAvatarSeconds = input.paddedAvatarSeconds ?? 481.32;
  const spanCount = input.spanCount ?? 103;
  if (
    !Number.isFinite(input.outputDurationSeconds) ||
    input.outputDurationSeconds <= 0 ||
    !Number.isFinite(input.generationWallMs) ||
    input.generationWallMs <= 0 ||
    !Number.isFinite(input.podStartToReadyMs) ||
    input.podStartToReadyMs < 0 ||
    !Number.isFinite(input.rateUsdPerHour) ||
    input.rateUsdPerHour <= 0 ||
    !Number.isFinite(paddedAvatarSeconds) ||
    paddedAvatarSeconds <= 0 ||
    !Number.isSafeInteger(spanCount) ||
    spanCount <= 0
  ) {
    throw new Error("VF924T_ECONOMICS_INPUT_INVALID");
  }
  const measuredRequests = paddedAvatarSeconds / input.outputDurationSeconds;
  const generationProjectedMs = measuredRequests * input.generationWallMs;
  const warmBatchedGpuMs = input.podStartToReadyMs + generationProjectedMs;
  const warmBatchedCostUsd = (warmBatchedGpuMs / 3_600_000) * input.rateUsdPerHour;
  return {
    basis: "one measured cold boot plus linear measured 10-second request wall-time",
    padded_avatar_seconds: paddedAvatarSeconds,
    span_count: spanCount,
    measured_request_equivalents: measuredRequests,
    pod_start_to_ready_ms: input.podStartToReadyMs,
    generation_projected_ms: generationProjectedMs,
    warm_batched_gpu_ms: warmBatchedGpuMs,
    warm_batched_gpu_minutes: warmBatchedGpuMs / 60_000,
    warm_batched_gpu_cost_usd: warmBatchedCostUsd,
    excludes: [
      "retained-volume billing",
      "Mage image generation",
      "Whisper transcription",
      "Cloud Run rendering/storage/egress",
      "settled-provider rounding",
    ],
    uncertainty:
      "The production work plan has 103 separate spans; per-request overhead and duration-dependent chunk rounding require a full-work-plan benchmark before this becomes a settled production cost.",
  };
}

export async function runSoulXVf924s(input: {
  readonly imageDigest: string;
  readonly sourceImagePath: string;
  readonly sourceAudioPath: string;
  readonly artifactRoot: string;
  readonly taskId?: "VF-9-24S" | "VF-9-24T" | "VF-9-24U";
  readonly finiteCapUsd?: number;
  readonly outputBasename?: string;
  readonly renderCropPreviews?: boolean;
  readonly splitContextImagePath?: string;
  readonly fullPreviewProfile?: "elias-wide-v1" | "source-16x9-v1";
  readonly expectedSourceImageSha256?: string;
  readonly expectedSourceAudioSha256?: string;
  readonly expectedSplitContextImageSha256?: string;
}): Promise<JsonRecord> {
  const taskId = input.taskId ?? "VF-9-24S";
  const isSecondSample = taskId === "VF-9-24T";
  const isThirdSample = taskId === "VF-9-24U";
  const isTimedSample = isSecondSample || isThirdSample;
  const finiteCapUsd = input.finiteCapUsd ?? FINITE_CAP_USD;
  const priorConservativeUsd = isTimedSample ? 0 : PRIOR_FAILED_ATTEMPT_CONSERVATIVE_USD;
  const templateName = isThirdSample
    ? "videoforge-soulx-flashhead-pro-vf924u-template"
    : isSecondSample
      ? "videoforge-soulx-flashhead-pro-vf924t-template"
      : TEMPLATE_NAME;
  const outputBasename =
    input.outputBasename ??
    (isThirdSample
      ? "soulx-flashhead-pro-new-avatar-third-10.00s.mp4"
      : isSecondSample
        ? "soulx-flashhead-pro-elias-second-10.00s.mp4"
        : "soulx-flashhead-pro-elias-10.12s.mp4");
  if (
    !IMAGE_PATTERN.test(input.imageDigest) ||
    !path.isAbsolute(input.sourceImagePath) ||
    !path.isAbsolute(input.sourceAudioPath) ||
    !path.isAbsolute(input.artifactRoot) ||
    (input.renderCropPreviews === true &&
      (!input.splitContextImagePath || !path.isAbsolute(input.splitContextImagePath))) ||
    (isTimedSample &&
      (!input.expectedSourceImageSha256 ||
        !SHA256.test(input.expectedSourceImageSha256) ||
        !input.expectedSourceAudioSha256 ||
        !SHA256.test(input.expectedSourceAudioSha256) ||
        !input.expectedSplitContextImageSha256 ||
        !SHA256.test(input.expectedSplitContextImageSha256))) ||
    (isThirdSample && input.fullPreviewProfile !== "source-16x9-v1") ||
    !Number.isFinite(finiteCapUsd) ||
    finiteCapUsd <= 0 ||
    path.basename(outputBasename) !== outputBasename ||
    !outputBasename.endsWith(".mp4")
  ) {
    throw new Error("VF924S_INPUT_INVALID");
  }
  const reservation =
    priorConservativeUsd +
    (((isTimedSample ? 0 : PREP_TIMEOUT_SECONDS) +
      RUNTIME_READY_TIMEOUT_SECONDS +
      GENERATION_TIMEOUT_SECONDS +
      POD_LIFECYCLE_RESERVE_SECONDS * (isTimedSample ? 1 : 2)) /
      3_600) *
      GPU_RATE;
  if (reservation > finiteCapUsd) throw new Error("VF924S_CAP_RISK");

  const [sourceBytes, audioBytes, splitContextBytes] = await Promise.all([
    readFile(input.sourceImagePath),
    readFile(input.sourceAudioPath),
    input.renderCropPreviews === true && input.splitContextImagePath
      ? readFile(input.splitContextImagePath)
      : Promise.resolve(null),
  ]);
  if (
    isTimedSample &&
    (sha256(sourceBytes) !== input.expectedSourceImageSha256 ||
      sha256(audioBytes) !== input.expectedSourceAudioSha256 ||
      splitContextBytes === null ||
      sha256(splitContextBytes) !== input.expectedSplitContextImageSha256)
  ) {
    throw new Error("VF924T_INPUT_HASH_MISMATCH");
  }

  const apiKey = await loadSujalRunPodApiKeyFromKeychain();
  const account = await assertSujalRunPodAccount(apiKey);
  if (account.accountIdHash !== ACCOUNT_HASH) throw new Error("VF924S_ACCOUNT_MISMATCH");
  const selected = (await fetchCp07Catalog(apiKey)).find(
    (candidate) => candidate.offeringId === GPU,
  );
  if (
    selected?.region !== REGION ||
    selected.rateUsdPerHour !== GPU_RATE ||
    selected.vramGb !== GPU_VRAM_GB
  ) {
    throw new Error("VF924S_GPU_DRIFT");
  }
  await assertPublicImage(input.imageDigest);
  const client = new RunPodClient(apiKey);
  const startingPods = await client.listPods();
  const startingTemplates = await client.listTemplates();
  const startingVolumes = await client.listVolumes();
  const mage = startingVolumes.find((item) => sha256(item.id) === MAGE_VOLUME_HASH);
  const echo = startingVolumes.find((item) => sha256(item.id) === ECHO_VOLUME_HASH);
  const existingSoulX = startingVolumes.find(
    (item) =>
      item.name === SOULX_VOLUME_NAME &&
      item.size === VOLUME_SIZE_GB &&
      item.dataCenterId === REGION,
  );
  const exactSoulX = existingSoulX === undefined ? undefined : sha256(existingSoulX.id);
  if (
    startingPods.length !== 0 ||
    startingTemplates.length !== 0 ||
    startingVolumes.length !== 2 ||
    mage?.size !== 50 ||
    (isTimedSample
      ? echo !== undefined || exactSoulX !== SOULX_VOLUME_HASH
      : (echo === undefined && existingSoulX === undefined) ||
        (echo !== undefined && existingSoulX !== undefined))
  ) {
    throw new Error("VF924S_STARTING_INVENTORY_MISMATCH");
  }

  const deletions: DeletedPod[] = [];
  let template: Template | null = null;
  let activePod: Pod | null = null;
  let soulxVolume: Volume | null = null;
  let preparationHealth: JsonRecord | null = null;
  let runtimeHealth: JsonRecord | null = null;
  let generationResult: JsonRecord | null = null;
  try {
    if (existingSoulX === undefined) {
      if (isTimedSample) throw new Error("VF924T_SOULX_VOLUME_ABSENT");
      if (echo === undefined) throw new Error("VF924S_ECHO_VOLUME_ABSENT");
      await client.deleteVolume(echo);
      soulxVolume = await client.createVolume();
    } else {
      soulxVolume = existingSoulX;
    }
    template = await client.createTemplate(input.imageDigest, templateName, taskId);

    if (existingSoulX === undefined) {
      activePod = await client.createPod({
        name: "videoforge-soulx-vf924s-prepare",
        templateId: template.id,
        imageDigest: input.imageDigest,
        volume: soulxVolume,
        mode: "prepare",
      });
      preparationHealth = await pollHealth(
        activePod.id,
        PREP_TIMEOUT_SECONDS,
        "videoforge.soulx-flashhead-pro-preparation-health/v1",
      );
      if (`sha256:${preparationHealth.manifest_sha256}` !== MANIFEST_SHA256) {
        throw new Error("VF924S_PREPARED_MANIFEST_MISMATCH");
      }
      deletions.push(await deletePodEvidence(client, activePod));
      activePod = null;
    } else {
      preparationHealth = {
        state: "reused_after_compiler_only_runtime_failure",
        volume_id_sha256: sha256(existingSoulX.id),
        runtime_manifest_reverification_required: true,
      };
    }

    const workerToken = randomBytes(32).toString("base64url");
    activePod = await client.createPod({
      name: isThirdSample
        ? "videoforge-soulx-vf924u-new-avatar-sample"
        : isSecondSample
          ? "videoforge-soulx-vf924t-second-sample"
          : "videoforge-soulx-vf924s-sample",
      templateId: template.id,
      imageDigest: input.imageDigest,
      volume: soulxVolume,
      mode: "runtime",
      token: workerToken,
      requireProviderStartedAt: isTimedSample,
    });
    runtimeHealth = await pollHealth(
      activePod.id,
      RUNTIME_READY_TIMEOUT_SECONDS,
      "videoforge.soulx-flashhead-pro-worker-health/v1",
    );
    const modelReadyObservedAt = new Date().toISOString();
    const podStartedToModelReadyMs = Math.max(
      0,
      new Date(modelReadyObservedAt).getTime() - new Date(activePod.startedAt).getTime(),
    );
    if (`sha256:${runtimeHealth.manifest_sha256}` !== MANIFEST_SHA256) {
      throw new Error("VF924S_RUNTIME_MANIFEST_MISMATCH");
    }
    const runtimePod = activePod;
    const uploadStarted = Date.now();
    const submit = record(
      await (
        await fetch(`${proxyUrl(activePod.id)}/generate`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${workerToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            source_image_base64: sourceBytes.toString("base64"),
            audio_wav_base64: audioBytes.toString("base64"),
          }),
          signal: AbortSignal.timeout(60_000),
        })
      ).json(),
    );
    if (typeof submit?.job_id !== "string" || !/^[a-f0-9]{32}$/u.test(submit.job_id)) {
      throw new Error("VF924S_SUBMIT_INVALID");
    }
    const deadline = Date.now() + GENERATION_TIMEOUT_SECONDS * 1_000;
    while (Date.now() < deadline) {
      const response = await fetch(`${proxyUrl(activePod.id)}/jobs/${submit.job_id}`, {
        headers: { authorization: `Bearer ${workerToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      const status = record(response.ok ? await response.json() : null);
      if (status?.status === "failed")
        throw new Error(`VF924S_GENERATION_FAILED:${sanitize(String(status.error))}`);
      if (status?.status === "complete") {
        generationResult = status;
        break;
      }
      await sleep(3_000);
    }
    if (generationResult === null || typeof generationResult.output_base64 !== "string") {
      throw new Error("VF924S_GENERATION_TIMEOUT_OR_INVALID");
    }
    const outputBytes = Buffer.from(generationResult.output_base64, "base64");
    if (sha256(outputBytes) !== `sha256:${generationResult.output_sha256}`) {
      throw new Error("VF924S_OUTPUT_HASH_MISMATCH");
    }
    await mkdir(input.artifactRoot, { recursive: true, mode: 0o700 });
    const outputPath = path.join(input.artifactRoot, outputBasename);
    await writeFile(outputPath, outputBytes, { flag: "wx", mode: 0o600 });
    await chmod(outputPath, 0o600);
    const probe = await probeMedia(outputPath);
    const nativeMediaContract = isTimedSample
      ? assertMediaContract(probe, { width: 512, height: 512, fps: "25/1", frames: 250 })
      : null;
    if (
      isTimedSample &&
      (generationResult.duration_seconds !== 10 || generationResult.frame_count !== 250)
    ) {
      throw new Error("VF924T_WORKER_OUTPUT_CONTRACT_MISMATCH");
    }
    const uploadAndPollMs = Date.now() - uploadStarted;
    const outputSummary = {
      path: outputPath,
      sha256: sha256(outputBytes),
      bytes: outputBytes.length,
      probe,
      media_contract: nativeMediaContract,
      worker_result: { ...generationResult, output_base64: undefined },
      upload_poll_retrieval_ms: uploadAndPollMs,
    };
    const generationWallMs = uploadAndPollMs;
    const workerDurationSeconds = finite(generationResult.duration_seconds);
    if (isTimedSample) {
      const partialEvidence = {
        schema_version: isThirdSample
          ? "videoforge.soulx-flashhead-pro-vf924u-runtime-partial/v1"
          : "videoforge.soulx-flashhead-pro-vf924t-runtime-partial/v1",
        task_id: taskId,
        recorded_at: new Date().toISOString(),
        account_id_sha256: ACCOUNT_HASH,
        image_digest: input.imageDigest,
        retained_soulx_volume_id_sha256: SOULX_VOLUME_HASH,
        pod_id_sha256: sha256(runtimePod.id),
        provider_pod_started_at: runtimePod.startedAt,
        provider_pod_started_at_source: runtimePod.startedAtSource,
        model_ready_observed_at: modelReadyObservedAt,
        pod_start_to_model_ready_ms: podStartedToModelReadyMs,
        generation_submit_to_retrieval_ms: generationWallMs,
        runtime_health: runtimeHealth,
        worker_result: { ...generationResult, output_base64: undefined },
        output: outputSummary,
      };
      await writeFile(
        path.join(input.artifactRoot, "runtime-partial.json"),
        `${JSON.stringify(partialEvidence, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
    }
    deletions.push(await deletePodEvidence(client, runtimePod));
    activePod = null;
    const cropPreviews =
      isTimedSample && input.renderCropPreviews === true
        ? {
            full: await renderRangaFullPreview(
              outputPath,
              input.sourceImagePath,
              path.join(input.artifactRoot, "ranga-style-full-16x9-corrected.mp4"),
              input.fullPreviewProfile ?? "elias-wide-v1",
            ),
            split: await renderRangaSplitPreview(
              outputPath,
              input.splitContextImagePath as string,
              path.join(input.artifactRoot, "ranga-style-split-composite-16x9-corrected.mp4"),
            ),
          }
        : null;
    const economics =
      isTimedSample && workerDurationSeconds !== null
        ? projectSoulXAvatarEconomics({
            outputDurationSeconds: workerDurationSeconds,
            generationWallMs,
            podStartToReadyMs: podStartedToModelReadyMs,
            rateUsdPerHour: runtimePod.costPerHour,
          })
        : null;
    await client.deleteTemplate(template.id);
    template = null;

    const finalPods = await client.listPods();
    const finalTemplates = await client.listTemplates();
    const finalVolumes = await client.listVolumes();
    const retainedMage = finalVolumes.find((item) => sha256(item.id) === MAGE_VOLUME_HASH);
    const retainedSoulX = finalVolumes.find((item) => item.id === soulxVolume?.id);
    if (
      finalPods.length !== 0 ||
      finalTemplates.length !== 0 ||
      finalVolumes.length !== 2 ||
      retainedMage?.size !== 50 ||
      retainedSoulX?.name !== SOULX_VOLUME_NAME ||
      retainedSoulX.size !== 50
    ) {
      throw new Error("VF924S_FINAL_CLEANUP_MISMATCH");
    }
    const settled = deletions.reduce((sum, item) => sum + (item.settled_cost_usd ?? 0), 0);
    const conservative = deletions.reduce(
      (sum, item) => sum + (item.settled_cost_usd ?? item.elapsed_cost_upper_bound_usd),
      priorConservativeUsd,
    );
    if (conservative > finiteCapUsd) throw new Error("VF924S_FINAL_CAP_BREACH");
    const evidence: JsonRecord = {
      schema_version: isThirdSample
        ? "videoforge.soulx-flashhead-pro-vf924u-new-avatar-sample/v1"
        : isSecondSample
          ? "videoforge.soulx-flashhead-pro-vf924t-second-sample/v1"
          : "videoforge.soulx-flashhead-pro-vf924s-qualification/v1",
      task_id: taskId,
      inputs: {
        source_image_sha256: sha256(sourceBytes),
        source_audio_sha256: sha256(audioBytes),
        split_context_image_sha256: splitContextBytes === null ? null : sha256(splitContextBytes),
      },
      completed_at: new Date().toISOString(),
      account: { owner: "sujal", account_id_sha256: ACCOUNT_HASH },
      image_digest: input.imageDigest,
      gpu: selected,
      volume: {
        size_gb: 50,
        recurring_usd_per_month: 3.5,
        retained_soulx_volume_id_sha256: sha256(retainedSoulX.id),
        preserved_mage_volume_id_sha256: MAGE_VOLUME_HASH,
        deleted_echo_volume_id_sha256: ECHO_VOLUME_HASH,
      },
      preparation_health: preparationHealth,
      runtime_health: runtimeHealth,
      lifecycle_timing: {
        provider_pod_started_at: runtimePod.startedAt,
        provider_pod_started_at_source: runtimePod.startedAtSource,
        model_ready_observed_at: modelReadyObservedAt,
        pod_start_to_model_ready_ms: podStartedToModelReadyMs,
        generation_submit_to_retrieval_ms: generationWallMs,
      },
      output: outputSummary,
      crop_previews: cropPreviews,
      avatar_economics_projection: economics,
      pod_deletions: deletions,
      finite_cost: {
        cap_usd: finiteCapUsd,
        settled_usd_observed: settled,
        prior_failed_attempt_conservative_usd: priorConservativeUsd,
        conservative_usd: conservative,
      },
      final_resource_audit: {
        pods: 0,
        private_templates: 0,
        endpoints: 0,
        active_serverless_workers: 0,
        network_volumes: 2,
      },
    };
    const evidencePath = path.join(input.artifactRoot, "qualification.json");
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return evidence;
  } finally {
    if (activePod !== null) await client.deletePod(activePod.id);
    if (template !== null) await client.deleteTemplate(template.id);
  }
}
