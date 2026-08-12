import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  startSshAvatarPrivateTransfer,
  type AvatarPrivateTransfer,
} from "./avatar-private-transfer";
import { loadRunPodApiKeyFromKeychain } from "./keychain";
import { safeAvatarFailureEvidence, safeAvatarSuccessEvidence } from "./runpod-avatar-result";
import {
  RunPodControlClient,
  RunPodControlError,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodJobResult,
} from "./runpod-control";

const execFileAsync = promisify(execFile);
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const qualificationSpendCapUsd = Number(process.env.VIDEOFORGE_COST_CAP_USD ?? "0.50");
const qualificationCostStopUsd = Number(process.env.VIDEOFORGE_COST_STOP_USD ?? "0.45");
const qualificationFrames = Number(process.env.VIDEOFORGE_AVATAR_SAMPLE_FRAMES ?? "253");
const outputTransport = process.env.VIDEOFORGE_AVATAR_OUTPUT_TRANSPORT ?? "private_tunnel_v1";
const networkVolumeId = process.env.VIDEOFORGE_NETWORK_VOLUME_ID;
const networkVolumeDataCenterId = process.env.VIDEOFORGE_NETWORK_VOLUME_DATACENTER_ID;
if (
  !Number.isFinite(qualificationSpendCapUsd) ||
  qualificationSpendCapUsd <= 0 ||
  qualificationSpendCapUsd > 1 ||
  !Number.isFinite(qualificationCostStopUsd) ||
  qualificationCostStopUsd <= 0 ||
  qualificationCostStopUsd > qualificationSpendCapUsd ||
  !Number.isSafeInteger(qualificationFrames) ||
  qualificationFrames < 5 ||
  qualificationFrames > 253 ||
  (qualificationFrames - 1) % 4 !== 0 ||
  !["inline_result_v1", "private_tunnel_v1"].includes(outputTransport) ||
  Boolean(networkVolumeId) !== Boolean(networkVolumeDataCenterId) ||
  (networkVolumeId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u.test(networkVolumeId)) ||
  (networkVolumeDataCenterId !== undefined &&
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u.test(networkVolumeDataCenterId))
) {
  throw new Error("AVATAR_QUALIFICATION_SCOPE_INVALID");
}
const qualificationGpuProfiles = {
  "NVIDIA GeForce RTX 4090": 24,
  "NVIDIA A100 80GB PCIe": 80,
  "NVIDIA A100-SXM4-80GB": 80,
} as const;
const qualificationGpuTypeId =
  process.env.VIDEOFORGE_AVATAR_GPU_TYPE_ID ?? "NVIDIA GeForce RTX 4090";
if (!(qualificationGpuTypeId in qualificationGpuProfiles)) {
  throw new Error("AVATAR_QUALIFICATION_GPU_INVALID");
}
const qualificationGpuTypeIds = [qualificationGpuTypeId] as const;
const qualificationGpuMemoryGb =
  qualificationGpuProfiles[qualificationGpuTypeId as keyof typeof qualificationGpuProfiles];
let abortRequested = false;
let abortSignal: string | null = null;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    abortRequested = true;
    abortSignal ??= signal;
  });
}
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const digest = (value: Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const resourceIdHash = (value: string): string =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const readAmbiguous = (error: unknown): boolean =>
  error instanceof RunPodControlError &&
  (error.code === "RUNPOD_READ_AMBIGUOUS" || error.code === "RUNPOD_READ_FAILED");

const requiredEnvironment = (name: string, pattern: RegExp): string => {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`${name}_INVALID`);
  return value;
};

const balance = async (apiKey: string): Promise<number> => {
  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = (await response.json()) as {
    data?: { myself?: { clientBalance?: unknown } };
  };
  const candidate = Number(value.data?.myself?.clientBalance);
  if (!response.ok || !Number.isFinite(candidate) || candidate < 0) {
    throw new Error("RUNPOD_BALANCE_UNAVAILABLE");
  }
  return candidate;
};

const gpuRate = async (apiKey: string): Promise<Readonly<Record<string, unknown>>> => {
  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      query: "query { gpuTypes { id displayName memoryInGb securePrice communityPrice } }",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = (await response.json()) as {
    data?: { gpuTypes?: unknown };
    errors?: unknown;
  };
  const rows = Array.isArray(value.data?.gpuTypes) ? value.data.gpuTypes : [];
  const row = rows.find(
    (candidate) =>
      candidate &&
      typeof candidate === "object" &&
      (candidate as Record<string, unknown>).id === qualificationGpuTypeIds[0],
  ) as Record<string, unknown> | undefined;
  if (
    !response.ok ||
    value.errors ||
    !row ||
    row.memoryInGb !== qualificationGpuMemoryGb ||
    !Number.isFinite(Number(row.securePrice)) ||
    !Number.isFinite(Number(row.communityPrice))
  ) {
    throw new Error("RUNPOD_QUALIFICATION_GPU_RATE_UNAVAILABLE");
  }
  return Object.freeze({
    checked_at: new Date().toISOString(),
    id: row.id,
    display_name: row.displayName,
    memory_gb: row.memoryInGb,
    secure_usd_per_hour: Number(row.securePrice),
    community_usd_per_hour: Number(row.communityPrice),
  });
};

const drain = async (client: RunPodServerlessJobClient): Promise<void> => {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await client.confirmDrained();
      return;
    } catch {
      await sleep(5_000);
    }
  }
  throw new Error("RUNPOD_DRAIN_TIMEOUT");
};

const inventoryOrNull = async (
  client: RunPodControlClient,
  attempts: number,
): Promise<Awaited<ReturnType<RunPodControlClient["inventory"]>> | null> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await client.inventory();
    } catch {
      if (attempt + 1 < attempts) await sleep(2_000);
    }
  }
  return null;
};

const probe = async (path: string): Promise<unknown> => {
  const completed = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,width,height,r_frame_rate:format=duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  return JSON.parse(completed.stdout);
};

const image = requiredEnvironment(
  "VIDEOFORGE_RUNPOD_IMAGE",
  /^ghcr\.io\/[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/u,
);
const sourcePath = resolve(requiredEnvironment("VIDEOFORGE_AVATAR_SOURCE_PATH", /^\/.+/u));
const audioPath = resolve(requiredEnvironment("VIDEOFORGE_AVATAR_AUDIO_PATH", /^\/.+/u));
const outputRoot = resolve(
  process.env.VIDEOFORGE_QUALIFICATION_OUTPUT_ROOT ?? ".videoforge/review/VF-9-24",
);
const evidenceRoot = resolve(
  process.env.VIDEOFORGE_QUALIFICATION_EVIDENCE_ROOT ??
    "project-context/evidence/acceptance/VF-9-24/elias-echomimic-v3-flash-sample",
);
await mkdir(outputRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
const journalPath = resolve(evidenceRoot, "qualification.journal.json");
const journalEvents: Array<Readonly<Record<string, unknown>>> = [];
const persistJournal = async () =>
  writeFile(
    journalPath,
    `${JSON.stringify(
      {
        schema_version: "videoforge.echomimic-v3-flash-sample-journal/v1",
        events: journalEvents,
      },
      null,
      2,
    )}\n`,
  );
const journalRequired = async (stage: string, detail: Readonly<Record<string, unknown>> = {}) => {
  journalEvents.push({ checked_at: new Date().toISOString(), stage, ...detail });
  await persistJournal();
};
const journal = async (stage: string, detail: Readonly<Record<string, unknown>> = {}) => {
  journalEvents.push({ checked_at: new Date().toISOString(), stage, ...detail });
  try {
    await persistJournal();
  } catch {
    // Provider cleanup must continue even if local evidence storage becomes unavailable.
  }
};

const source = await readFile(sourcePath);
const audio = await readFile(audioPath);
if (source.byteLength > 2 * 1024 * 1024 || audio.byteLength > 2 * 1024 * 1024) {
  throw new Error("QUALIFICATION_INPUT_TOO_LARGE");
}

const apiKey = await loadRunPodApiKeyFromKeychain();
const control = new RunPodControlClient({ apiKey });
const guard = new RunPodDrainGuard();
const initialInventory = await control.inventory();
const expectedVolumeHash = networkVolumeId ? resourceIdHash(networkVolumeId) : null;
if (
  initialInventory.runningPodCount !== 0 ||
  initialInventory.activeServerlessWorkerCount !== 0 ||
  initialInventory.pods.length !== 0 ||
  initialInventory.endpoints.length !== 0 ||
  initialInventory.privateTemplateCount !== 0 ||
  (expectedVolumeHash === null
    ? initialInventory.networkVolumes.length !== 0
    : initialInventory.networkVolumes.length !== 1 ||
      initialInventory.networkVolumes[0]?.idHash !== expectedVolumeHash)
) {
  throw new Error("RUNPOD_NOT_ZERO_AT_START");
}
const gpuRateSnapshot = await gpuRate(apiKey);

const startedBalance = await balance(apiKey);
await journalRequired("preflight_complete", {
  starting_balance_usd: startedBalance,
  gpu_rate_snapshot: gpuRateSnapshot,
  initial_inventory: initialInventory,
});
let template: Awaited<ReturnType<RunPodControlClient["createServerlessTemplate"]>> | undefined;
let endpoint: Awaited<ReturnType<RunPodControlClient["createScaleZeroEndpoint"]>> | undefined;
let jobs: RunPodServerlessJobClient | undefined;
let job: RunPodJobResult | undefined;
let transfer: AvatarPrivateTransfer | undefined;
let failureCode: string | undefined;
let outputEvidence: unknown;
let resultValue: Record<string, unknown> | undefined;
let outputProbe: unknown;
const outputPath = resolve(outputRoot, "echomimic-v3-flash-elias-10.12s-native.mp4");

try {
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  if (outputTransport === "private_tunnel_v1") {
    transfer = await startSshAvatarPrivateTransfer({ source, audio, outputPath });
    await journal("private_transfer_ready", { output_transport: outputTransport });
  }
  const suffix = createHash("sha256").update(image).digest("hex").slice(0, 12);
  await journal("template_create_started");
  template = await control.createServerlessTemplate(
    `vf_avatar_${suffix}`,
    image,
    100,
    networkVolumeId
      ? {
          ECHOMIMIC_MODEL_ROOT: "/runpod-volume/models",
          HF_HOME: "/runpod-volume/models/.cache",
        }
      : {},
  );
  await journal("template_created", { template_id_hash: template.idHash });
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  await journal("endpoint_create_started");
  endpoint = await control.createScaleZeroEndpoint(
    `vf_avatar_${suffix}`,
    template.id,
    qualificationGpuTypeIds,
    {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 1_500_000,
    },
    networkVolumeId && networkVolumeDataCenterId
      ? { networkVolumeId, dataCenterIds: [networkVolumeDataCenterId] }
      : {},
  );
  await journal("endpoint_created", { endpoint_id_hash: endpoint.idHash });
  jobs = new RunPodServerlessJobClient({ apiKey, endpointId: endpoint.id, guard });
  await jobs.confirmDrained();
  await journal("endpoint_drained_before_dispatch");
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  const attemptId = `vf9_24_${suffix}`;
  const sharedInput = {
    attempt_id: attemptId,
    source_sha256: digest(source),
    span_audio_sha256: digest(audio),
    prompt:
      "A man talks naturally to the camera with subtle head and upper-body movement. Static camera, stable background, realistic motion.",
    layout: "AVATAR_FULL",
    num_output_frames: qualificationFrames,
  };
  await journal("job_dispatch_started", {
    attempt_id: attemptId,
    input: {
      source_sha256: sharedInput.source_sha256,
      span_audio_sha256: sharedInput.span_audio_sha256,
      layout: sharedInput.layout,
      num_output_frames: sharedInput.num_output_frames,
    },
  });
  job = await jobs.dispatch(
    attemptId,
    transfer
      ? {
          ...sharedInput,
          attempt_id: attemptId,
          source_url: transfer.sourceUrl,
          span_audio_url: transfer.audioUrl,
          output_put_url: transfer.outputPutUrl,
        }
      : {
          ...sharedInput,
          mode: "INLINE_QUALIFICATION_V1",
          source_base64: source.toString("base64"),
          span_audio_base64: audio.toString("base64"),
        },
  );
  await journal("job_dispatched", { job_id_hash: job.idHash, job_status: job.status });
  const dispatchStartedAt = Date.now();
  let activeStartedAt: number | null = null;
  let previousWorkerRecordCount = 0;
  for (let attempt = 0; attempt < 140 && !terminalStatuses.has(job.status); attempt += 1) {
    await sleep(15_000);
    if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
    try {
      job = await jobs.status(job.id);
    } catch (error) {
      if (!readAmbiguous(error)) throw error;
      await journal("job_status_read_ambiguous", { attempt: attempt + 1 });
      continue;
    }
    await journal("job_status", {
      delay_time_ms: job.delayTimeMs,
      execution_time_ms: job.executionTimeMs,
      job_status: job.status,
      progress: job.progress ?? null,
    });
    if (terminalStatuses.has(job.status)) break;
    const liveInventory = await control.inventory();
    const workerRecordCount = liveInventory.endpoints.reduce(
      (total, candidate) => total + candidate.workerRecordCount,
      0,
    );
    if (workerRecordCount !== previousWorkerRecordCount) {
      previousWorkerRecordCount = workerRecordCount;
      await journal("worker_inventory_changed", {
        active_serverless_workers: liveInventory.activeServerlessWorkerCount,
        running_pods: liveInventory.runningPodCount,
        worker_records: workerRecordCount,
        worker_statuses: liveInventory.endpoints.flatMap((candidate) => candidate.workerStatuses),
      });
    }
    if (liveInventory.activeServerlessWorkerCount > 1) {
      throw new Error("RUNPOD_WORKER_RETRY_LIMIT");
    }
    if (liveInventory.activeServerlessWorkerCount > 0 && activeStartedAt === null) {
      activeStartedAt = Date.now();
      await journal("worker_active");
    }
    if (activeStartedAt === null && Date.now() - dispatchStartedAt >= 10 * 60_000)
      throw new Error("RUNPOD_QUEUE_TIMEOUT");
    if (activeStartedAt !== null && Date.now() - activeStartedAt >= 25 * 60_000)
      throw new Error("RUNPOD_ACTIVE_TIMEOUT");
    if (attempt % 4 === 3 && startedBalance - (await balance(apiKey)) >= qualificationCostStopUsd) {
      throw new Error("RUNPOD_COST_STOP");
    }
  }
  if (!terminalStatuses.has(job.status)) throw new Error("RUNPOD_JOB_TIMEOUT");
  if (job.status !== "COMPLETED") throw new Error(`RUNPOD_JOB_${job.status}`);
  const envelope = job.output as {
    ok?: unknown;
    result?: Record<string, unknown>;
    error_code?: unknown;
  };
  if (!envelope || envelope.ok !== true || !envelope.result) {
    outputEvidence = safeAvatarFailureEvidence(job.output);
    throw new Error(
      typeof envelope?.error_code === "string" ? envelope.error_code : "AVATAR_RESULT_INVALID",
    );
  }
  resultValue = envelope.result;
  let output: Buffer;
  if (transfer) {
    await Promise.race([
      transfer.waitForOutput(),
      sleep(30_000).then(() => {
        throw new Error("AVATAR_OUTPUT_UPLOAD_TIMEOUT");
      }),
    ]);
    output = await readFile(outputPath);
  } else {
    const encoded = envelope.result.output_base64;
    if (typeof encoded !== "string") throw new Error("AVATAR_OUTPUT_MISSING");
    output = Buffer.from(encoded, "base64");
  }
  const expected = envelope.result.output_sha256;
  if (digest(output) !== expected || output.byteLength > 64 * 1024 * 1024) {
    throw new Error("AVATAR_OUTPUT_CHECKSUM_INVALID");
  }
  if (!transfer) await writeFile(outputPath, output, { flag: "wx" });
  outputProbe = await probe(outputPath);
} catch (error) {
  failureCode = error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN_FAILURE";
  await journal("attempt_failed", { abort_signal: abortSignal, failure_code: failureCode });
} finally {
  let endpointDeleted = false;
  if (jobs && guard.snapshot() === "active") guard.beginDrain();
  if (jobs && job && !terminalStatuses.has(job.status)) {
    try {
      await jobs.cancel(job.id);
      await journal("job_cancelled", { job_id_hash: job.idHash });
    } catch {
      failureCode ??= "RUNPOD_CANCEL_UNCONFIRMED";
    }
  }
  if (jobs && guard.snapshot() !== "zero") {
    try {
      await jobs.confirmQueueEmpty();
      await journal("queue_empty_confirmed");
    } catch {
      failureCode ??= "RUNPOD_QUEUE_DRAIN_UNCONFIRMED";
    }
  }
  if (endpoint && (guard.snapshot() === "queue_empty" || guard.snapshot() === "zero")) {
    try {
      await control.deleteEndpoint(endpoint.id, guard);
      endpointDeleted = true;
      await journal("endpoint_deleted", { endpoint_id_hash: endpoint.idHash });
    } catch {
      failureCode ??= "RUNPOD_ENDPOINT_DELETE_UNCONFIRMED";
    }
  }
  if (endpointDeleted) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const inventory = await inventoryOrNull(control, 1);
      if (
        inventory &&
        inventory.runningPodCount === 0 &&
        inventory.activeServerlessWorkerCount === 0 &&
        !inventory.endpoints.some((candidate) => candidate.idHash === endpoint?.idHash)
      ) {
        guard.confirmZero(0, 0);
        break;
      }
      await sleep(2_000);
    }
  } else if (jobs && guard.snapshot() !== "zero") {
    try {
      await drain(jobs);
    } catch {
      failureCode ??= "RUNPOD_DRAIN_TIMEOUT";
    }
  }
  if (template && (!endpoint || guard.snapshot() === "zero")) {
    try {
      await control.deleteTemplate(template.id);
      await journal("template_deleted", { template_id_hash: template.idHash });
    } catch {
      failureCode ??= "RUNPOD_TEMPLATE_DELETE_UNCONFIRMED";
    }
  }
  if (transfer) {
    try {
      await transfer.close();
    } catch {
      failureCode ??= "AVATAR_TRANSFER_CLOSE_UNCONFIRMED";
    }
  }
}

let endingBalance: number | null = null;
try {
  endingBalance = await balance(apiKey);
} catch {
  failureCode ??= "RUNPOD_ENDING_BALANCE_UNAVAILABLE";
}
const finalInventory = await inventoryOrNull(control, 6);
await journal("final_observation", {
  ending_balance_usd: endingBalance,
  failure_code: failureCode ?? null,
  final_inventory: finalInventory,
});
if (!finalInventory) failureCode ??= "RUNPOD_FINAL_INVENTORY_UNAVAILABLE";
if (
  finalInventory &&
  (finalInventory.runningPodCount !== 0 ||
    finalInventory.activeServerlessWorkerCount !== 0 ||
    finalInventory.pods.length !== 0 ||
    finalInventory.endpoints.length !== 0 ||
    finalInventory.privateTemplateCount !== 0 ||
    (expectedVolumeHash === null
      ? finalInventory.networkVolumes.length !== 0
      : finalInventory.networkVolumes.length !== 1 ||
        finalInventory.networkVolumes[0]?.idHash !== expectedVolumeHash))
) {
  failureCode ??= "RUNPOD_FINAL_INVENTORY_NONZERO";
}
const measuredSpendUsd =
  endingBalance === null ? null : Math.max(0, startedBalance - endingBalance);
if (resultValue && measuredSpendUsd !== null) {
  const parsed = safeAvatarSuccessEvidence(resultValue, measuredSpendUsd);
  if (!parsed) failureCode ??= "AVATAR_RESULT_INVALID";
  else outputEvidence = { ...parsed, output_transport: outputTransport, local_probe: outputProbe };
}
const evidence = {
  schema_version: "videoforge.echomimic-v3-flash-sample/v1",
  checked_at: new Date().toISOString(),
  image,
  output_transport: outputTransport,
  input: {
    source_sha256: digest(source),
    source_bytes: source.byteLength,
    audio_sha256: digest(audio),
    audio_bytes: audio.byteLength,
    layout: "AVATAR_FULL",
    num_output_frames: qualificationFrames,
  },
  resource_identity: {
    template_id_hash: template?.idHash ?? null,
    endpoint_id_hash: endpoint?.idHash ?? null,
    job_id_hash: job?.idHash ?? null,
  },
  runtime: {
    status: job?.status ?? null,
    delay_time_ms: job?.delayTimeMs ?? null,
    execution_time_ms: job?.executionTimeMs ?? null,
    progress: job?.progress ?? null,
    output: outputEvidence ?? null,
    failure_code: failureCode ?? null,
  },
  cost: {
    starting_balance_usd: startedBalance,
    ending_balance_usd: endingBalance,
    measured_spend_usd: measuredSpendUsd,
    cap_usd: qualificationSpendCapUsd,
    gpu_rate_snapshot: gpuRateSnapshot,
  },
  initial_inventory: initialInventory,
  final_inventory: finalInventory,
};
await writeFile(
  resolve(evidenceRoot, "qualification.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  {
    flag: "wx",
  },
);
process.stdout.write(
  `${JSON.stringify({
    ok: !failureCode,
    status: job?.status ?? null,
    spendUsd: evidence.cost.measured_spend_usd,
    finalRunningPods: finalInventory?.runningPodCount ?? null,
    finalActiveWorkers: finalInventory?.activeServerlessWorkerCount ?? null,
    failureCode: failureCode ?? null,
  })}\n`,
);
if (failureCode) process.exitCode = 1;
