import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadRunPodApiKeyFromKeychain } from "./keychain";
import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
  type RunPodInventory,
  type RunPodJobResult,
} from "./runpod-control";
import {
  MAGE_MATRIX_NEGATIVE_PROMPT,
  buildMageMatrix,
  type MageMatrixItem,
} from "./runpod-mage-matrix-inputs";
import {
  MAGE_CANDIDATE_IMAGE,
  MAGE_GPU,
  MAGE_MODEL_REVISION,
  MAGE_SOURCE_REVISION,
  acceptMageResult,
} from "./runpod-mage-result";

const spendCapUsd = 1.5;
const costStopUsd = 1.35;
const gpuTypeIds = [MAGE_GPU] as const;
const terminalStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const negativePrompt = MAGE_MATRIX_NEGATIVE_PROMPT;

const sha256 = (value: string | Buffer): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
const now = (): string => new Date().toISOString();
const safeCode = (error: unknown): string =>
  error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN_FAILURE";

interface ReviewDecision {
  readonly scene_id: string;
  readonly relevant: boolean;
  readonly severe_failure: boolean;
  readonly crop_safe: boolean;
  readonly style_clear: boolean;
  readonly reasons: readonly string[];
}

const parseReview = (
  value: unknown,
  expected: readonly MageMatrixItem[],
): readonly ReviewDecision[] => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("MAGE_REVIEW_INVALID");
  const decisions = (value as { decisions?: unknown }).decisions;
  if (!Array.isArray(decisions) || decisions.length !== expected.length) {
    throw new Error("MAGE_REVIEW_INCOMPLETE");
  }
  const expectedIds = new Set(expected.map((item) => item.sceneId));
  const seen = new Set<string>();
  for (const candidate of decisions) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("MAGE_REVIEW_INVALID");
    }
    const decision = candidate as Record<string, unknown>;
    if (
      Object.keys(decision).sort().join(",") !==
        "crop_safe,reasons,relevant,scene_id,severe_failure,style_clear" ||
      typeof decision.scene_id !== "string" ||
      !expectedIds.has(decision.scene_id) ||
      seen.has(decision.scene_id) ||
      typeof decision.relevant !== "boolean" ||
      typeof decision.severe_failure !== "boolean" ||
      typeof decision.crop_safe !== "boolean" ||
      typeof decision.style_clear !== "boolean" ||
      !Array.isArray(decision.reasons) ||
      decision.reasons.some((reason) => typeof reason !== "string" || reason.length > 160)
    ) {
      throw new Error("MAGE_REVIEW_INVALID");
    }
    seen.add(decision.scene_id);
  }
  return decisions as ReviewDecision[];
};

const assertAbsoluteZero = (inventory: RunPodInventory): void => {
  if (
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    inventory.pods.length !== 0 ||
    inventory.endpoints.length !== 0 ||
    inventory.privateTemplateCount !== 0 ||
    inventory.networkVolumes.length !== 0
  ) {
    throw new Error("RUNPOD_ABSOLUTE_ZERO_UNCONFIRMED");
  }
};

const balance = async (apiKey: string): Promise<number> => {
  const response = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ query: "query { myself { clientBalance } }" }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await response.json()) as { data?: { myself?: { clientBalance?: unknown } } };
  const candidate = Number(body.data?.myself?.clientBalance);
  if (!response.ok || !Number.isFinite(candidate) || candidate < 0) {
    throw new Error("RUNPOD_BALANCE_UNAVAILABLE");
  }
  return candidate;
};

const image = process.env.VIDEOFORGE_RUNPOD_IMAGE;
if (image !== MAGE_CANDIDATE_IMAGE) throw new Error("VIDEOFORGE_RUNPOD_IMAGE_INVALID");
const outputRoot = resolve(
  process.env.VIDEOFORGE_QUALIFICATION_OUTPUT_ROOT ?? ".videoforge/vf-9-18",
);
const reviewPath = resolve(
  process.env.VIDEOFORGE_REVIEW_DECISIONS_PATH ?? `${outputRoot}/review-decisions.json`,
);
await mkdir(resolve(outputRoot, "outputs"), { recursive: true });

const apiKey = await loadRunPodApiKeyFromKeychain();
const control = new RunPodControlClient({ apiKey });
const guard = new RunPodDrainGuard();
const startedMs = Date.now();
const initialInventory = await control.inventory();
assertAbsoluteZero(initialInventory);
const startingBalanceUsd = await balance(apiKey);
const matrix = buildMageMatrix();
const events: Record<string, unknown>[] = [];
const results: Record<string, unknown>[] = [];
let template: Awaited<ReturnType<RunPodControlClient["createServerlessTemplate"]>> | undefined;
let endpoint: Awaited<ReturnType<RunPodControlClient["createScaleZeroEndpoint"]>> | undefined;
let jobs: RunPodServerlessJobClient | undefined;
let currentJob: RunPodJobResult | undefined;
let failureCode: string | undefined;
let endpointDeleted = false;
let review: readonly ReviewDecision[] | undefined;
let abortRequested = false;
const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    abortRequested = true;
    controller.abort();
  });
}
const mark = (event: string, detail?: unknown): void => {
  events.push({ event, at: now(), elapsed_ms: Date.now() - startedMs, detail: detail ?? null });
};

const waitForTerminal = async (job: RunPodJobResult): Promise<RunPodJobResult> => {
  if (!jobs) throw new Error("RUNPOD_JOB_CLIENT_MISSING");
  for (let attempt = 0; attempt < 180 && !terminalStatuses.has(job.status); attempt += 1) {
    await sleep(10_000);
    if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
    job = await jobs.status(job.id);
    if (attempt % 3 === 2) {
      const spend = Math.max(0, startingBalanceUsd - (await balance(apiKey)));
      mark("cost_checked", {
        spend_usd: spend,
        status: job.status,
        progress: job.progress ?? null,
      });
      if (spend >= costStopUsd) throw new Error("RUNPOD_COST_STOP");
    }
    const inventory = await control.inventory();
    if (inventory.runningPodCount > 1 || inventory.activeServerlessWorkerCount > 1) {
      throw new Error("RUNPOD_WORKER_LIMIT_BREACH");
    }
  }
  if (!terminalStatuses.has(job.status)) throw new Error("RUNPOD_JOB_TIMEOUT");
  return job;
};

const runItem = async (item: MageMatrixItem, attempt: 1 | 2): Promise<void> => {
  if (!jobs) throw new Error("RUNPOD_JOB_CLIENT_MISSING");
  const attemptId = `vf9_18_${item.sceneId}_a${attempt}`;
  const seed = item.seed + (attempt === 2 ? 1_000 : 0);
  mark("item_dispatch_started", { scene_id: item.sceneId, attempt, seed });
  currentJob = await jobs.dispatch(attemptId, {
    mode: "INLINE_QUALIFICATION_V1",
    attempt_id: attemptId,
    model_revision: MAGE_MODEL_REVISION,
    items: [
      {
        scene_id: item.sceneId,
        positive_prompt: item.prompt,
        positive_prompt_sha256: item.promptHash,
        negative_prompt: negativePrompt,
        negative_prompt_sha256: item.negativePromptHash,
        seed,
        width: 1280,
        height: 720,
      },
    ],
  });
  mark("item_dispatch_acknowledged", {
    scene_id: item.sceneId,
    attempt,
    job_id_hash: currentJob.idHash,
  });
  currentJob = await waitForTerminal(currentJob);
  if (currentJob.status !== "COMPLETED") throw new Error(`RUNPOD_JOB_${currentJob.status}`);
  const reportedSpendUsd = Math.max(0, startingBalanceUsd - (await balance(apiKey)));
  const accepted = acceptMageResult(
    currentJob.output,
    {
      attemptId,
      sceneId: item.sceneId,
      promptSha256: item.promptHash,
      negativePromptSha256: item.negativePromptHash,
      seed,
      width: 1280,
      height: 720,
      image: MAGE_CANDIDATE_IMAGE,
      modelRevision: MAGE_MODEL_REVISION,
      sourceRevision: MAGE_SOURCE_REVISION,
      gpu: MAGE_GPU,
      maximumCostUsd: spendCapUsd,
    },
    reportedSpendUsd,
  );
  const filename = `${item.sceneId}-a${attempt}-seed${seed}.png`;
  await writeFile(resolve(outputRoot, "outputs", filename), accepted.output, { flag: "wx" });
  results.push({
    scene_id: item.sceneId,
    category: item.category,
    style_id: item.styleId,
    layout: item.layout,
    attempt,
    seed,
    prompt: item.prompt,
    prompt_sha256: item.promptHash,
    negative_prompt: negativePrompt,
    negative_prompt_sha256: item.negativePromptHash,
    local_file: `outputs/${filename}`,
    output_sha256: sha256(accepted.output),
    delay_time_ms: currentJob.delayTimeMs,
    execution_time_ms: currentJob.executionTimeMs,
    accepted_evidence: accepted.evidence,
  });
  mark("item_saved", { scene_id: item.sceneId, attempt, output_sha256: sha256(accepted.output) });
  await jobs.confirmWarmIdle();
  currentJob = undefined;
  if (reportedSpendUsd >= costStopUsd) throw new Error("RUNPOD_COST_STOP");
  process.stdout.write(
    `${JSON.stringify({ event: "item_saved", sceneId: item.sceneId, attempt, count: results.length, spendUsd: reportedSpendUsd })}\n`,
  );
};

try {
  mark("initial_inventory_absolute_zero");
  const suffix = createHash("sha256").update(`${image}:${startedMs}`).digest("hex").slice(0, 12);
  template = await control.createServerlessTemplate(`vf_mage_matrix_${suffix}`, image, 100);
  mark("template_created", { template_id_hash: template.idHash });
  endpoint = await control.createScaleZeroEndpoint(
    `vf_mage_matrix_${suffix}`,
    template.id,
    gpuTypeIds,
    {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 60,
      executionTimeoutMs: 1_800_000,
    },
  );
  mark("endpoint_created", { endpoint_id_hash: endpoint.idHash, network_volume_attached: false });
  jobs = new RunPodServerlessJobClient({
    apiKey,
    endpointId: endpoint.id,
    guard,
    signal: controller.signal,
  });
  await jobs.confirmDrained();
  for (const item of matrix) await runItem(item, 1);

  mark("first_generation_complete", { count: matrix.length, review_path: reviewPath });
  process.stdout.write(
    `${JSON.stringify({ event: "awaiting_review", count: matrix.length, reviewPath, outputRoot })}\n`,
  );
  for (let attempt = 0; attempt < 240 && !review; attempt += 1) {
    if (abortRequested) throw new Error("RUNPOD_OPERATOR_ABORT");
    try {
      review = parseReview(JSON.parse(await readFile(reviewPath, "utf8")), matrix);
    } catch (error) {
      if (safeCode(error) !== "ENOENT") {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
    }
    if (!review) await sleep(5_000);
  }
  if (!review) throw new Error("MAGE_REVIEW_DEADLINE");
  const byId = new Map(review.map((decision) => [decision.scene_id, decision]));
  const rejected = matrix.filter((item) => {
    const decision = byId.get(item.sceneId)!;
    return (
      !decision.relevant || decision.severe_failure || !decision.crop_safe || !decision.style_clear
    );
  });
  mark("review_recorded", { rejected_scene_ids: rejected.map((item) => item.sceneId) });
  for (const item of rejected) await runItem(item, 2);
} catch (error) {
  failureCode = safeCode(error);
  mark("qualification_failed", { failure_code: failureCode });
} finally {
  if (jobs && (guard.snapshot() === "active" || guard.snapshot() === "warm_idle")) {
    try {
      guard.beginDrain();
    } catch {
      failureCode ??= "RUNPOD_DRAIN_BEGIN_FAILED";
    }
  }
  if (jobs && currentJob && !terminalStatuses.has(currentJob.status)) {
    try {
      currentJob = await jobs.cancel(currentJob.id);
      mark("job_cancelled");
    } catch {
      failureCode ??= "RUNPOD_CANCEL_UNCONFIRMED";
    }
  }
  if (jobs && guard.snapshot() === "draining") {
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
  assertAbsoluteZero(finalInventory);
  mark("final_inventory_absolute_zero");
} catch (error) {
  failureCode ??= safeCode(error);
}
const measuredSpendUsd = Math.max(0, startingBalanceUsd - endingBalanceUsd);
if (measuredSpendUsd > spendCapUsd) failureCode ??= "RUNPOD_COST_CAP_EXCEEDED";
const evidence = {
  schema_version: "videoforge.mage-quality-matrix/v1",
  checked_at: now(),
  status: failureCode ? "FAILED" : "READY_FOR_USER_REVIEW",
  image,
  model_revision: MAGE_MODEL_REVISION,
  source_revision: MAGE_SOURCE_REVISION,
  matrix_count: matrix.length,
  first_generation_count: results.filter((result) => result.attempt === 1).length,
  retry_count: results.filter((result) => result.attempt === 2).length,
  review: review ?? null,
  results,
  resource_identity: {
    template_id_hash: template?.idHash ?? null,
    endpoint_id_hash: endpoint?.idHash ?? null,
  },
  cost: {
    starting_balance_usd: startingBalanceUsd,
    ending_balance_usd: endingBalanceUsd,
    measured_spend_usd: measuredSpendUsd,
    cap_usd: spendCapUsd,
    cost_stop_usd: costStopUsd,
  },
  vram: {
    peak_bytes: null,
    reason: "pinned worker exposes total GPU memory but not peak allocation",
  },
  initial_inventory: initialInventory,
  final_inventory: finalInventory,
  events,
  failure_code: failureCode ?? null,
  total_wall_time_ms: Date.now() - startedMs,
};
await writeFile(
  resolve(outputRoot, "qualification.json"),
  `${JSON.stringify(evidence, null, 2)}\n`,
  {
    flag: "wx",
  },
);
process.stdout.write(
  `${JSON.stringify({ ok: !failureCode, status: evidence.status, firstGenerationCount: evidence.first_generation_count, retryCount: evidence.retry_count, spendUsd: measuredSpendUsd, finalRunningPods: finalInventory.runningPodCount, finalActiveWorkers: finalInventory.activeServerlessWorkerCount, failureCode: failureCode ?? null, outputRoot })}\n`,
);
if (failureCode) process.exitCode = 1;
