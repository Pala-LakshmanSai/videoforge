import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodJobResult,
} from "./runpod-control";

const required = (name: string, pattern: RegExp): string => {
  const value = process.env[name];
  if (!value || !pattern.test(value)) throw new Error(`${name}_INVALID`);
  return value;
};
const image = required("VIDEOFORGE_RUNPOD_IMAGE", /^ghcr\.io\/[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/u);
const volumeId = required("VIDEOFORGE_NETWORK_VOLUME_ID", /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u);
const dataCenterId = required(
  "VIDEOFORGE_NETWORK_VOLUME_DATACENTER_ID",
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u,
);
const bootstrapGpuTypeId = required(
  "VIDEOFORGE_BOOTSTRAP_GPU_TYPE_ID",
  /^(?:NVIDIA GeForce RTX 4090|NVIDIA A100-SXM4-80GB)$/u,
);
const evidenceRoot = resolve(required("VIDEOFORGE_BOOTSTRAP_EVIDENCE_ROOT", /^\/.+/u));
const capUsd = Number(process.env.VIDEOFORGE_BOOTSTRAP_COST_STOP_USD ?? "0.35");
if (!Number.isFinite(capUsd) || capUsd <= 0 || capUsd > 0.4) {
  throw new Error("VIDEOFORGE_BOOTSTRAP_COST_STOP_USD_INVALID");
}
const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));
const hashId = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const balance = async (apiKey: string): Promise<number> => {
  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
    signal: AbortSignal.timeout(30_000),
  });
  const value = (await response.json()) as { data?: { myself?: { clientBalance?: unknown } } };
  const candidate = Number(value.data?.myself?.clientBalance);
  if (!response.ok || !Number.isFinite(candidate)) throw new Error("RUNPOD_BALANCE_UNAVAILABLE");
  return candidate;
};

await mkdir(evidenceRoot, { recursive: true });
const apiKey = await loadSujalRunPodApiKeyFromKeychain();
await assertSujalRunPodAccount(apiKey);
const control = new RunPodControlClient({ apiKey });
const guard = new RunPodDrainGuard();
const startedAt = new Date().toISOString();
const startedBalance = await balance(apiKey);
const initialInventory = await control.inventory();
if (
  initialInventory.pods.length !== 0 ||
  initialInventory.endpoints.length !== 0 ||
  initialInventory.privateTemplateCount !== 0 ||
  initialInventory.networkVolumes.length !== 1 ||
  initialInventory.networkVolumes[0]?.idHash !== hashId(volumeId)
) {
  throw new Error("RUNPOD_BOOTSTRAP_NOT_EXACT_VOLUME_ONLY");
}

let template: Awaited<ReturnType<RunPodControlClient["createServerlessTemplate"]>> | undefined;
let endpoint: Awaited<ReturnType<RunPodControlClient["createScaleZeroEndpoint"]>> | undefined;
let jobs: RunPodServerlessJobClient | undefined;
let job: RunPodJobResult | undefined;
let failureCode: string | null = null;
let bootstrap: unknown = null;
try {
  const suffix = createHash("sha256").update(image).digest("hex").slice(0, 12);
  template = await control.createServerlessTemplate(`vf_bootstrap_${suffix}`, image, 100, {
    ECHOMIMIC_MODEL_ROOT: "/runpod-volume/models",
    HF_HOME: "/runpod-volume/models/.cache",
  });
  endpoint = await control.createScaleZeroEndpoint(
    `vf_bootstrap_${suffix}`,
    template.id,
    [bootstrapGpuTypeId],
    { workersMin: 0, workersMax: 1, gpuCount: 1, idleTimeout: 5, executionTimeoutMs: 1_500_000 },
    { networkVolumeId: volumeId, dataCenterIds: [dataCenterId] },
  );
  jobs = new RunPodServerlessJobClient({ apiKey, endpointId: endpoint.id, guard });
  await jobs.confirmDrained();
  job = await jobs.dispatch(`vf_bootstrap_${suffix}`, { mode: "BOOTSTRAP_ONLY_V1" });
  const dispatchStarted = Date.now();
  for (
    let attempt = 0;
    attempt < 100 && !["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(job.status);
    attempt += 1
  ) {
    await sleep(15_000);
    job = await jobs.status(job.id);
    if (attempt % 4 === 3 && startedBalance - (await balance(apiKey)) >= capUsd) {
      throw new Error("RUNPOD_BOOTSTRAP_COST_STOP");
    }
    if (Date.now() - dispatchStarted > 22 * 60_000) throw new Error("RUNPOD_BOOTSTRAP_TIMEOUT");
  }
  if (job.status !== "COMPLETED") throw new Error(`RUNPOD_BOOTSTRAP_JOB_${job.status}`);
  const envelope = job.output as {
    ok?: unknown;
    result?: { bootstrap?: unknown };
    error_code?: unknown;
  };
  if (envelope?.ok !== true || !envelope.result?.bootstrap) {
    throw new Error(
      typeof envelope?.error_code === "string"
        ? envelope.error_code
        : "AVATAR_BOOTSTRAP_RESULT_INVALID",
    );
  }
  bootstrap = envelope.result.bootstrap;
} catch (error) {
  failureCode = error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN_FAILURE";
} finally {
  if (jobs && guard.snapshot() === "active") guard.beginDrain();
  if (jobs && job && !["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(job.status)) {
    try {
      await jobs.cancel(job.id);
    } catch {
      failureCode ??= "RUNPOD_BOOTSTRAP_CANCEL_UNCONFIRMED";
    }
  }
  if (jobs && guard.snapshot() !== "zero") {
    try {
      await jobs.confirmQueueEmpty();
    } catch {
      failureCode ??= "RUNPOD_BOOTSTRAP_DRAIN_UNCONFIRMED";
    }
  }
  if (endpoint && (guard.snapshot() === "queue_empty" || guard.snapshot() === "zero")) {
    try {
      await control.deleteEndpoint(endpoint.id, guard);
    } catch {
      failureCode ??= "RUNPOD_BOOTSTRAP_ENDPOINT_DELETE_UNCONFIRMED";
    }
  }
  if (template) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const inventory = await control.inventory();
      if (inventory.endpoints.length === 0 && inventory.activeServerlessWorkerCount === 0) break;
      await sleep(2_000);
    }
    try {
      await control.deleteTemplate(template.id);
    } catch {
      failureCode ??= "RUNPOD_BOOTSTRAP_TEMPLATE_DELETE_UNCONFIRMED";
    }
  }
}
const endingBalance = await balance(apiKey);
const finalInventory = await control.inventory();
if (
  finalInventory.pods.length !== 0 ||
  finalInventory.endpoints.length !== 0 ||
  finalInventory.privateTemplateCount !== 0 ||
  finalInventory.networkVolumes.length !== 1 ||
  finalInventory.networkVolumes[0]?.idHash !== hashId(volumeId)
)
  failureCode ??= "RUNPOD_BOOTSTRAP_FINAL_STATE_INVALID";
const evidence = {
  schema_version: "videoforge.echomimic-bootstrap-qualification/v1",
  started_at: startedAt,
  checked_at: new Date().toISOString(),
  image,
  data_center_id: dataCenterId,
  gpu_type_id: bootstrapGpuTypeId,
  network_volume_id_hash: hashId(volumeId),
  runtime: {
    status: job?.status ?? null,
    delay_time_ms: job?.delayTimeMs ?? null,
    execution_time_ms: job?.executionTimeMs ?? null,
    bootstrap,
    failure_code: failureCode,
  },
  cost: {
    starting_balance_usd: startedBalance,
    ending_balance_usd: endingBalance,
    measured_spend_usd: Math.max(0, startedBalance - endingBalance),
    stop_usd: capUsd,
  },
  final_inventory: finalInventory,
};
await writeFile(
  resolve(evidenceRoot, "bootstrap-qualification.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  { flag: "wx" },
);
process.stdout.write(
  `${JSON.stringify({ ok: !failureCode, ...evidence.runtime, spendUsd: evidence.cost.measured_spend_usd })}\n`,
);
if (failureCode) process.exitCode = 1;
