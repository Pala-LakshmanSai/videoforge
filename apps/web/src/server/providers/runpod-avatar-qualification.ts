import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadRunPodApiKeyFromKeychain } from "./keychain";
import { safeAvatarFailureEvidence } from "./runpod-avatar-result";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodJobResult,
} from "./runpod-control";

const execFileAsync = promisify(execFile);
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const qualificationSpendCapUsd = Number(process.env.VIDEOFORGE_COST_CAP_USD ?? "1");
const qualificationCostStopUsd = Number(process.env.VIDEOFORGE_COST_STOP_USD ?? "0.9");
const qualificationFrames = Number(process.env.VIDEOFORGE_AVATAR_SAMPLE_FRAMES ?? "5");
if (
  !Number.isFinite(qualificationSpendCapUsd) ||
  qualificationSpendCapUsd <= 0 ||
  qualificationSpendCapUsd > 1.4736943278 ||
  !Number.isFinite(qualificationCostStopUsd) ||
  qualificationCostStopUsd <= 0 ||
  qualificationCostStopUsd > qualificationSpendCapUsd ||
  !Number.isSafeInteger(qualificationFrames) ||
  qualificationFrames < 5 ||
  qualificationFrames > 253 ||
  (qualificationFrames - 1) % 4 !== 0
) {
  throw new Error("AVATAR_QUALIFICATION_SCOPE_INVALID");
}
const qualificationGpuTypeIds = ["NVIDIA A100 80GB PCIe"] as const;
let abortRequested = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    abortRequested = true;
  });
}
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const digest = (value: Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

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
  process.env.VIDEOFORGE_QUALIFICATION_OUTPUT_ROOT ?? ".videoforge/vf-8-04",
);
await mkdir(outputRoot, { recursive: true });

const source = await readFile(sourcePath);
const audio = await readFile(audioPath);
if (source.byteLength > 2 * 1024 * 1024 || audio.byteLength > 2 * 1024 * 1024) {
  throw new Error("QUALIFICATION_INPUT_TOO_LARGE");
}

const apiKey = await loadRunPodApiKeyFromKeychain();
const control = new RunPodControlClient({ apiKey });
const guard = new RunPodDrainGuard();
const initialInventory = await control.inventory();
if (
  initialInventory.runningPodCount !== 0 ||
  initialInventory.activeServerlessWorkerCount !== 0 ||
  initialInventory.pods.length !== 0 ||
  initialInventory.endpoints.length !== 0 ||
  initialInventory.privateTemplateCount !== 0 ||
  initialInventory.networkVolumes.length !== 0
) {
  throw new Error("RUNPOD_NOT_ZERO_AT_START");
}

const startedBalance = await balance(apiKey);
let template: Awaited<ReturnType<RunPodControlClient["createServerlessTemplate"]>> | undefined;
let endpoint: Awaited<ReturnType<RunPodControlClient["createScaleZeroEndpoint"]>> | undefined;
let jobs: RunPodServerlessJobClient | undefined;
let job: RunPodJobResult | undefined;
let failureCode: string | undefined;
let outputEvidence: unknown;

try {
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  const suffix = createHash("sha256").update(image).digest("hex").slice(0, 12);
  template = await control.createServerlessTemplate(`vf_avatar_${suffix}`, image, 100);
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  endpoint = await control.createScaleZeroEndpoint(
    `vf_avatar_${suffix}`,
    template.id,
    qualificationGpuTypeIds,
    {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 1_800_000,
    },
  );
  jobs = new RunPodServerlessJobClient({ apiKey, endpointId: endpoint.id, guard });
  await jobs.confirmDrained();
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  job = await jobs.dispatch(`vf8_10_${suffix}`, {
    mode: "INLINE_QUALIFICATION_V1",
    attempt_id: `vf8_10_${suffix}`,
    source_base64: source.toString("base64"),
    source_sha256: digest(source),
    span_audio_base64: audio.toString("base64"),
    span_audio_sha256: digest(audio),
    prompt: "A presenter speaks naturally to the camera.",
    layout: "AVATAR_FULL",
    num_output_frames: qualificationFrames,
  });
  let consecutiveNoRunningPolls = 0;
  for (let attempt = 0; attempt < 140 && !terminalStatuses.has(job.status); attempt += 1) {
    await sleep(15_000);
    if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
    job = await jobs.status(job.id);
    if (terminalStatuses.has(job.status)) break;
    const liveInventory = await control.inventory();
    if (liveInventory.runningPodCount > 1) {
      throw new Error("RUNPOD_WORKER_RETRY_LIMIT");
    }
    consecutiveNoRunningPolls =
      liveInventory.runningPodCount === 0 ? consecutiveNoRunningPolls + 1 : 0;
    if (consecutiveNoRunningPolls >= 20) {
      throw new Error("RUNPOD_STARTUP_TIMEOUT");
    }
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
  const encoded = envelope.result.output_base64;
  if (typeof encoded !== "string") throw new Error("AVATAR_OUTPUT_MISSING");
  const output = Buffer.from(encoded, "base64");
  const expected = envelope.result.output_sha256;
  if (digest(output) !== expected || output.byteLength > 8 * 1024 * 1024) {
    throw new Error("AVATAR_OUTPUT_CHECKSUM_INVALID");
  }
  const outputPath = resolve(outputRoot, "avatarforcing-qualification.mp4");
  await writeFile(outputPath, output, { flag: "wx" });
  outputEvidence = {
    ...envelope.result,
    output_base64: undefined,
    local_probe: await probe(outputPath),
  };
} catch (error) {
  failureCode = error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN_FAILURE";
} finally {
  let endpointDeleted = false;
  if (jobs && guard.snapshot() === "active") guard.beginDrain();
  if (jobs && job && !terminalStatuses.has(job.status)) {
    try {
      await jobs.cancel(job.id);
    } catch {
      failureCode ??= "RUNPOD_CANCEL_UNCONFIRMED";
    }
  }
  if (jobs && guard.snapshot() !== "zero") {
    try {
      await jobs.confirmQueueEmpty();
    } catch {
      failureCode ??= "RUNPOD_QUEUE_DRAIN_UNCONFIRMED";
    }
  }
  if (endpoint && (guard.snapshot() === "queue_empty" || guard.snapshot() === "zero")) {
    try {
      await control.deleteEndpoint(endpoint.id, guard);
      endpointDeleted = true;
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
    } catch {
      failureCode ??= "RUNPOD_TEMPLATE_DELETE_UNCONFIRMED";
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
if (!finalInventory) failureCode ??= "RUNPOD_FINAL_INVENTORY_UNAVAILABLE";
const evidence = {
  schema_version: "videoforge.avatarforcing-qualification/v1",
  checked_at: new Date().toISOString(),
  image,
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
    measured_spend_usd: endingBalance === null ? null : Math.max(0, startedBalance - endingBalance),
    cap_usd: qualificationSpendCapUsd,
  },
  initial_inventory: initialInventory,
  final_inventory: finalInventory,
};
await writeFile(
  resolve(outputRoot, "qualification.json"),
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
