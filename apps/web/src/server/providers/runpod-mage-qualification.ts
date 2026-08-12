import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadRunPodApiKeyFromKeychain } from "./keychain";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodInventory,
  type RunPodJobResult,
} from "./runpod-control";

const spendCapUsd = 0.15;
const costStopUsd = 0.12;
const gpuTypeIds = ["NVIDIA GeForce RTX 4090"] as const;
const prompt =
  "A wide documentary photograph of families loading bulk groceries into cars outside a large American warehouse supermarket at night, natural parking-lot lighting, realistic candid people, believable architecture and vehicles, no visible text, no logos, no brand names, no watermarks, no signs, no graphics, no borders, no overlays.";
const modelRevision = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const now = (): string => new Date().toISOString();
let abortRequested = false;
const operatorAbort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    abortRequested = true;
    operatorAbort.abort();
  });
}

const requiredImage = (): string => {
  const value = process.env.VIDEOFORGE_RUNPOD_IMAGE;
  if (!value || !/^ghcr\.io\/pala-lakshmansai\/videoforge-mage@sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error("VIDEOFORGE_RUNPOD_IMAGE_INVALID");
  }
  return value;
};

const balance = async (apiKey: string): Promise<number> => {
  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = (await response.json()) as { data?: { myself?: { clientBalance?: unknown } } };
  const candidate = Number(value.data?.myself?.clientBalance);
  if (!response.ok || !Number.isFinite(candidate) || candidate < 0) {
    throw new Error("RUNPOD_BALANCE_UNAVAILABLE");
  }
  return candidate;
};

const volumeHashes = (inventory: RunPodInventory): string[] =>
  inventory.networkVolumes.map((volume) => volume.idHash).sort();

const assertInitialSafe = (inventory: RunPodInventory): void => {
  if (
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    inventory.pods.length !== 0 ||
    inventory.endpoints.length !== 0 ||
    inventory.privateTemplateCount !== 0
  ) {
    throw new Error("RUNPOD_NOT_IDLE_AT_START");
  }
};

const assertFinalSafe = (initial: RunPodInventory, final: RunPodInventory): void => {
  if (
    final.runningPodCount !== 0 ||
    final.activeServerlessWorkerCount !== 0 ||
    final.pods.length !== 0 ||
    final.endpoints.length !== 0 ||
    final.privateTemplateCount !== 0 ||
    JSON.stringify(volumeHashes(final)) !== JSON.stringify(volumeHashes(initial))
  ) {
    throw new Error("RUNPOD_FINAL_ZERO_UNCONFIRMED");
  }
};

const probePng = (bytes: Buffer): { width: number; height: number; bytes: number } => {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error("MAGE_OUTPUT_PNG_INVALID");
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width !== 1280 || height !== 720 || bytes.length > 16 * 1024 * 1024) {
    throw new Error("MAGE_OUTPUT_PROFILE_INVALID");
  }
  return { width, height, bytes: bytes.length };
};

const image = requiredImage();
const outputRoot = resolve(
  process.env.VIDEOFORGE_QUALIFICATION_OUTPUT_ROOT ?? ".videoforge/vf-9-11",
);
await mkdir(outputRoot, { recursive: true });
const apiKey = await loadRunPodApiKeyFromKeychain();
const control = new RunPodControlClient({ apiKey });
const guard = new RunPodDrainGuard();
const overallStartedMs = Date.now();
const initialInventory = await control.inventory();
assertInitialSafe(initialInventory);
const startingBalanceUsd = await balance(apiKey);
const promptHash = sha256(prompt);
const suffix = createHash("sha256").update(image).digest("hex").slice(0, 12);
const attemptId = `vf9_11_${suffix}`;
const events: { event: string; at: string; elapsed_ms: number; detail?: unknown }[] = [];
const mark = (event: string, detail?: unknown): void => {
  events.push({
    event,
    at: now(),
    elapsed_ms: Date.now() - overallStartedMs,
    ...(detail === undefined ? {} : { detail }),
  });
};
mark("initial_inventory_zero", { preexisting_volume_hashes: volumeHashes(initialInventory) });

let template: Awaited<ReturnType<RunPodControlClient["createServerlessTemplate"]>> | undefined;
let endpoint: Awaited<ReturnType<RunPodControlClient["createScaleZeroEndpoint"]>> | undefined;
let jobs: RunPodServerlessJobClient | undefined;
let job: RunPodJobResult | undefined;
let failureCode: string | undefined;
let outputEvidence: Record<string, unknown> | undefined;
let endpointDeleted = false;

try {
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  mark("template_create_started");
  template = await control.createServerlessTemplate(`vf_mage_${suffix}`, image, 100);
  mark("template_created", { template_id_hash: template.idHash });
  endpoint = await control.createScaleZeroEndpoint(`vf_mage_${suffix}`, template.id, gpuTypeIds, {
    workersMin: 0,
    workersMax: 1,
    gpuCount: 1,
    idleTimeout: 5,
    executionTimeoutMs: 1_800_000,
  });
  mark("endpoint_created", { endpoint_id_hash: endpoint.idHash, network_volume_attached: false });
  jobs = new RunPodServerlessJobClient({
    apiKey,
    endpointId: endpoint.id,
    guard,
    signal: operatorAbort.signal,
  });
  await jobs.confirmDrained();
  mark("endpoint_zero_confirmed");
  if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
  mark("dispatch_started");
  job = await jobs.dispatch(attemptId, {
    mode: "INLINE_QUALIFICATION_V1",
    attempt_id: attemptId,
    model_revision: modelRevision,
    items: [
      {
        scene_id: "warehouse_night_documentary",
        positive_prompt: prompt,
        positive_prompt_sha256: promptHash,
        seed: 20260812,
        width: 1280,
        height: 720,
      },
    ],
  });
  mark("dispatch_acknowledged", { job_id_hash: job.idHash });
  for (let attempt = 0; attempt < 120 && !terminalStatuses.has(job.status); attempt += 1) {
    await sleep(15_000);
    if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
    job = await jobs.status(job.id);
    if (attempt % 4 === 3) {
      const spend = Math.max(0, startingBalanceUsd - (await balance(apiKey)));
      mark("cost_checked", {
        spend_usd: spend,
        status: job.status,
        progress: job.progress ?? null,
      });
      if (spend >= costStopUsd) throw new Error("RUNPOD_COST_STOP");
    }
    const inventory = await control.inventory();
    if (inventory.runningPodCount > 1) throw new Error("RUNPOD_WORKER_RETRY_LIMIT");
  }
  if (!terminalStatuses.has(job.status)) throw new Error("RUNPOD_JOB_TIMEOUT");
  mark("job_terminal", {
    status: job.status,
    delay_time_ms: job.delayTimeMs,
    execution_time_ms: job.executionTimeMs,
  });
  if (job.status !== "COMPLETED") throw new Error(`RUNPOD_JOB_${job.status}`);
  const envelope = job.output as {
    ok?: unknown;
    result?: Record<string, unknown>;
    error_code?: unknown;
  };
  if (!envelope || envelope.ok !== true || !envelope.result) {
    throw new Error(
      typeof envelope?.error_code === "string" ? envelope.error_code : "MAGE_RESULT_INVALID",
    );
  }
  const encoded = envelope.result.output_base64;
  if (typeof encoded !== "string") throw new Error("MAGE_OUTPUT_MISSING");
  const output = Buffer.from(encoded, "base64");
  if (output.toString("base64") !== encoded || sha256(output) !== envelope.result.output_sha256) {
    throw new Error("MAGE_OUTPUT_CHECKSUM_INVALID");
  }
  const probe = probePng(output);
  const outputPath = resolve(outputRoot, "warehouse-night-documentary-seed20260812.png");
  await writeFile(outputPath, output, { flag: "wx" });
  const safeResult = { ...envelope.result };
  delete safeResult.output_base64;
  outputEvidence = { ...safeResult, local_path: outputPath, local_probe: probe };
  mark("output_saved", { output_sha256: sha256(output), bytes: output.length });
} catch (error) {
  failureCode = error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN_FAILURE";
  mark("qualification_failed", { failure_code: failureCode });
} finally {
  if (jobs && guard.snapshot() === "active") guard.beginDrain();
  if (jobs && job && !terminalStatuses.has(job.status)) {
    try {
      job = await jobs.cancel(job.id);
      mark("job_cancelled");
    } catch {
      failureCode ??= "RUNPOD_CANCEL_UNCONFIRMED";
    }
  }
  if (jobs && guard.snapshot() !== "zero") {
    try {
      await jobs.confirmQueueEmpty();
      mark("queue_empty");
    } catch {
      failureCode ??= "RUNPOD_QUEUE_DRAIN_UNCONFIRMED";
    }
  }
  if (endpoint && (guard.snapshot() === "queue_empty" || guard.snapshot() === "zero")) {
    try {
      await control.deleteEndpoint(endpoint.id, guard);
      endpointDeleted = true;
      mark("endpoint_deleted");
    } catch {
      failureCode ??= "RUNPOD_ENDPOINT_DELETE_UNCONFIRMED";
    }
  }
  if (endpointDeleted) {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const inventory = await control.inventory();
      if (
        inventory.runningPodCount === 0 &&
        inventory.activeServerlessWorkerCount === 0 &&
        inventory.endpoints.length === 0
      ) {
        guard.confirmZero(0, 0);
        break;
      }
      await sleep(2_000);
    }
  }
  if (template && (!endpoint || guard.snapshot() === "zero")) {
    try {
      await control.deleteTemplate(template.id);
      mark("template_deleted");
    } catch {
      failureCode ??= "RUNPOD_TEMPLATE_DELETE_UNCONFIRMED";
    }
  }
}

const endingBalanceUsd = await balance(apiKey);
const finalInventory = await control.inventory();
try {
  assertFinalSafe(initialInventory, finalInventory);
  mark("final_inventory_zero");
} catch (error) {
  failureCode ??= error instanceof Error ? error.message : "RUNPOD_FINAL_ZERO_UNCONFIRMED";
}
const evidence = {
  schema_version: "videoforge.mage-qualification/v1",
  checked_at: now(),
  image,
  model_revision: modelRevision,
  input: { prompt, prompt_sha256: promptHash, seed: 20260812, width: 1280, height: 720 },
  network_volume: {
    attached: false,
    reason: "isolated first qualification; preexisting ImageForge volume not mutated",
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
    events,
    total_wall_time_ms: Date.now() - overallStartedMs,
  },
  cost: {
    starting_balance_usd: startingBalanceUsd,
    ending_balance_usd: endingBalanceUsd,
    measured_spend_usd: Math.max(0, startingBalanceUsd - endingBalanceUsd),
    cap_usd: spendCapUsd,
    cost_stop_usd: costStopUsd,
  },
  initial_inventory: initialInventory,
  final_inventory: finalInventory,
};
await writeFile(
  resolve(outputRoot, "qualification.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { flag: "wx" },
);
process.stdout.write(
  `${JSON.stringify({ ok: !failureCode, status: job?.status ?? null, spendUsd: evidence.cost.measured_spend_usd, output: outputEvidence?.local_path ?? null, finalRunningPods: finalInventory.runningPodCount, finalActiveWorkers: finalInventory.activeServerlessWorkerCount, failureCode: failureCode ?? null })}\n`,
);
if (failureCode) process.exitCode = 1;
