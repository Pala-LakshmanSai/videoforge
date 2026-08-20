import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { FakeR2ArtifactPlane } from "@videoforge/control-plane";

import {
  RunPodControlClient,
  type RunPodJobResult,
  type RunPodV207Placement,
} from "./runpod-control";
import {
  RunPodV207QualificationHarness,
  type RunPodV207DispatchBatchInput,
  type RunPodV207OutputAuthority,
} from "./runpod-v207-qualification-harness";
import { parseV207ActivationAuthority } from "./v207-activation-authority";
const MANIFEST = "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b";
const VOLUME = "sha256:eae4e1ece86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const VOLUME_ID = "c7kg89brtj";
const ACCOUNT = "account-a";
const WORKSPACE = "workspace-a";
const PROJECT = "project-a";
const REVISION = "revision-a";
const MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const ROUTE =
  "https://videoforge-v2-06-staging.lakshmansai121.workers.dev/api/v2/v207/generated-output-port";
const RESULT_PATH = "/tmp/videoforge-v207-live-result.json";
const BILLING_START = "2026-08-20T00:00:00.000Z";
const REQUEST_AUTHORITY_TTL_SECONDS = 7_200;
const ACTIVATION = parseV207ActivationAuthority(process.env);
const IMAGE = ACTIVATION.image;
const finiteCapUsd = ACTIVATION.capUsd;

type AnyRecord = Record<string, any>;

const hashText = (value: string): string =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sortedJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${sortedJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const SAFE_PROVIDER_CODE = /^[A-Z][A-Z0-9_.:-]{2,160}$/u;

/** Extract only a bounded error code from RunPod's provider-level error field. */
function providerErrorCode(value: unknown): string {
  const candidates: unknown[] = [value];
  if (typeof value === "string") {
    try {
      candidates.push(JSON.parse(value));
    } catch {
      // The provider may return a plain error string; never persist it verbatim.
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const match = candidate.match(/[A-Z][A-Z0-9_.:-]{2,160}/u)?.[0];
      if (match && SAFE_PROVIDER_CODE.test(match)) return match;
      continue;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      for (const key of ["code", "error_code", "errorCode", "error_type"]) {
        const found = (candidate as AnyRecord)[key];
        if (typeof found === "string" && SAFE_PROVIDER_CODE.test(found)) return found;
      }
    }
  }
  return "PROVIDER_ERROR_PRESENT";
}

const nowIso = (): string => new Date().toISOString();
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function routePort(body: AnyRecord, nonce: string): Promise<AnyRecord> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(ROUTE, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "close",
        "x-videoforge-v207-authority": nonce,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const value = (await response.json()) as AnyRecord;
    if (response.ok && typeof value.url === "string" && /^https:\/\//u.test(value.url)) {
      return value;
    }
    if (response.status !== 503 || attempt === 2) {
      throw new Error(`V207_OUTPUT_PORT_${response.status}`);
    }
    await sleep(500 * (attempt + 1));
  }
  throw new Error("V207_OUTPUT_PORT_UNREACHABLE");
}

async function deleteGeneratedObject(objectKey: string, nonce: string): Promise<void> {
  const response = await fetch(ROUTE, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      connection: "close",
      "x-videoforge-v207-authority": nonce,
    },
    body: JSON.stringify({
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "DELETE",
      account_id: ACCOUNT,
      workspace_id: WORKSPACE,
      object_key: objectKey,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`V207_OUTPUT_DELETE_${response.status}`);
  const value = (await response.json()) as AnyRecord;
  if (value.schema_version !== "videoforge-v207-generated-output-delete/v1" || value.deleted !== true) {
    throw new Error("V207_OUTPUT_DELETE_UNCONFIRMED");
  }
}

async function deleteGeneratedObjects(objectKeys: readonly string[], nonce: string): Promise<void> {
  for (const objectKey of [...new Set(objectKeys)].sort()) {
    await deleteGeneratedObject(objectKey, nonce);
  }
}

async function billingAmount(apiKey: string): Promise<number> {
  const query = new URLSearchParams({
    bucketSize: "hour",
    grouping: "endpointId",
    startTime: BILLING_START,
    endTime: nowIso(),
  });
  const response = await fetch(`https://rest.runpod.io/v1/billing/endpoints?${query}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("RUNPOD_ENDPOINT_BILLING_READ_FAILED");
  const value = (await response.json()) as unknown;
  if (!Array.isArray(value)) throw new Error("RUNPOD_ENDPOINT_BILLING_RESPONSE_INVALID");
  let amount = 0;
  for (const row of value) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("RUNPOD_ENDPOINT_BILLING_ROW_INVALID");
    }
    const candidate = Number((row as AnyRecord).amount);
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new Error("RUNPOD_ENDPOINT_BILLING_AMOUNT_INVALID");
    }
    amount += candidate;
  }
  if (!Number.isFinite(amount) || amount < 0)
    throw new Error("RUNPOD_ENDPOINT_BILLING_TOTAL_INVALID");
  return amount;
}

async function createBatch(
  attemptId: string,
  nonce: string,
): Promise<{
  readonly input: RunPodV207DispatchBatchInput;
  readonly objectKeys: readonly string[];
}> {
  const outputPrefix =
    `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
    `/lane/mage-image/job/${attemptId}`;
  const plane = new FakeR2ArtifactPlane(randomBytes(32));
  const authorities: AnyRecord[] = [];
  const outputPutUrls: string[] = [];
  const objectKeys: string[] = [];
  const reservationIds: string[] = [];
  const portNow = new Date();
  for (let index = 0; index < 32; index += 1) {
    const authority = plane.reserveGeneratedUpload(
      {
        scope: { accountId: ACCOUNT, workspaceId: WORKSPACE } as any,
        projectId: PROJECT,
        projectRevisionId: REVISION,
        lane: "MAGE_IMAGE",
        jobId: attemptId,
        artifactId: `scene-${String(index + 1).padStart(2, "0")}`,
      },
      {
        contentType: "image/png",
        maxContentLength: OUTPUT_LIMIT,
        now: portNow,
        lifetimeMs: 10 * 60 * 1_000,
        maxUses: 1,
        retentionClass: "PROJECT",
      },
    );
    const objectKey = authority.path.slice(1);
    const signed = await routePort(
      {
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: ACCOUNT,
        workspace_id: WORKSPACE,
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: OUTPUT_LIMIT,
        lifetime_seconds: 600,
      },
      nonce,
    );
    authorities.push(authority);
    outputPutUrls.push(signed.url);
    objectKeys.push(objectKey);
    reservationIds.push(authority.reservation_id);
    if ((index + 1) % 8 === 0) console.error(`v207:ports-${attemptId}-${index + 1}`);
  }
  const items = Array.from({ length: 32 }, (_, index) => {
    const positivePrompt = `A documentary photograph of a red apple on a wooden table, scene ${index + 1}`;
    const negativePrompt = "text, letters, logo, watermark, malformed objects";
    return {
      scene_id: `scene-${String(index + 1).padStart(2, "0")}`,
      positive_prompt: positivePrompt,
      positive_prompt_sha256: hashText(positivePrompt),
      negative_prompt: negativePrompt,
      negative_prompt_sha256: hashText(negativePrompt),
      seed: 2_000_000 + index,
      width: 1280,
      height: 720,
      output_put_url: "https://unused.example/placeholder",
    };
  });
  const batch = { attempt_id: attemptId, model_revision: MODEL_REVISION, items };
  const expiresAt = new Date(Date.now() + REQUEST_AUTHORITY_TTL_SECONDS * 1_000).toISOString();
  const envelope = {
    schema: "serverless-worker-job-envelope/v3",
    dispatch_token: `dispatch-${attemptId}-${randomBytes(8).toString("hex")}`,
    tenant: { account_id: ACCOUNT, workspace_id: WORKSPACE },
    work: {
      project_revision_id: REVISION,
      generation_request_id: `request-${attemptId}`,
      task_id: `task-${attemptId}`,
      attempt_id: attemptId,
      lane: "mage_image",
      items_manifest_sha256: hashText(JSON.stringify(items)),
      item_count: 32,
    },
    runtime: {
      endpoint_profile_id: "mage-serverless-v1",
      deployment_id: "deployment-mage-v207",
      container_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
      model_manifest_sha256: MANIFEST,
      volume_id_sha256: VOLUME,
      volume_mount: "/runpod-volume",
      volume_write_policy: "APPLICATION_READ_ONLY",
      scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
      gpu_allowlist: ["NVIDIA GeForce RTX 4090"],
      region: "EU-RO-1",
    },
    artifacts: {
      input_manifest_sha256: hashText(`input-${attemptId}`),
      output_prefix: outputPrefix,
      transfer_port_reservation_ids: reservationIds,
    },
    limits: {
      expires_at: expiresAt,
      max_items: 64,
      max_input_bytes: 268_435_456,
      max_output_bytes: 2_147_483_648,
      execution_timeout_seconds: 2_400,
      init_timeout_seconds: 800,
    },
    policy: {
      model_download_permitted: false,
      volume_mutation_permitted: false,
      pod_lifecycle_permitted: false,
      queue_purge_permitted: false,
    },
    authority_sha256: hashText(`authority-${attemptId}`),
    signature: {
      algorithm: "HMAC-SHA256",
      key_id: "worker-key-1",
      value: "0".repeat(64),
    },
  };
  const outputAuthority: RunPodV207OutputAuthority = {
    schemaVersion: "artifact-generated-output-authority/v1",
    attemptId,
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    outputPrefix,
    authorities,
    outputPutUrls,
  };
  return {
    input: {
      requestKey: `request-${attemptId}`,
      attemptId,
      input: { envelope, batch },
      outputAuthority,
    },
    objectKeys,
  };
}

async function verifyBatch(
  job: RunPodJobResult,
  objectKeys: readonly string[],
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  if (job.status !== "COMPLETED") throw new Error(`RUNPOD_JOB_${job.status}`);
  const output = job.output as AnyRecord;
  if (!output || output.status !== "SUCCEEDED" || !Array.isArray(output.items)) {
    console.error(
      `v207:failed-output-shape=${JSON.stringify({
        job_keys: Object.keys(job).sort(),
        output_type: Array.isArray(output) ? "array" : typeof output,
        output_keys: output && typeof output === "object" ? Object.keys(output).sort() : [],
      })}`,
    );
    const failureCode = output?.failure_code;
    const errorValue = output?.error;
    const code =
      typeof failureCode === "string" && SAFE_PROVIDER_CODE.test(failureCode)
        ? failureCode
        : typeof errorValue === "string"
          ? errorValue.slice(0, 160)
          : errorValue && typeof errorValue === "object"
            ? JSON.stringify(
                Object.fromEntries(
                  Object.entries(errorValue as AnyRecord).filter(([, value]) =>
                    ["string", "number", "boolean"].includes(typeof value),
                  ),
                ),
              ).slice(0, 240)
            : job.error !== undefined
              ? providerErrorCode(job.error)
              : "UNKNOWN";
    throw new Error(`MAGE_OUTPUT_NOT_SUCCEEDED:${String(output?.status ?? "MISSING")}:${code}`);
  }
  const receipt = output.provenance_receipt as AnyRecord;
  if (!receipt || receipt.schema_version !== "serverless-provenance-receipt/v1") {
    throw new Error("MAGE_RECEIPT_MISSING");
  }
  const receiptBody = { ...receipt };
  const signature = receiptBody.signature as AnyRecord;
  delete receiptBody.receipt_sha256;
  delete receiptBody.signature;
  const receiptSha = hashText(sortedJson(receiptBody));
  if (receipt.receipt_sha256 !== receiptSha) throw new Error("MAGE_RECEIPT_HASH_INVALID");
  const preimage = sortedJson({ key_id: receiptKeyId, receipt_sha256: receiptSha });
  const expectedSignature = createHmac("sha256", receiptSecret).update(preimage).digest("hex");
  if (
    signature?.algorithm !== "HMAC-SHA256" ||
    signature.key_id !== receiptKeyId ||
    signature.value !== expectedSignature
  ) {
    throw new Error("MAGE_RECEIPT_SIGNATURE_INVALID");
  }
  const deployment = receipt.deployment as AnyRecord;
  const volumeVerification = receipt.volume_verification as AnyRecord;
  if (
    deployment?.container_digest !== IMAGE.slice(IMAGE.indexOf("@") + 1) ||
    deployment?.intended_volume_id_sha256 !== VOLUME ||
    deployment?.intended_region !== "EU-RO-1" ||
    volumeVerification?.mutation_detected !== false ||
    volumeVerification?.cross_mount_detected !== false
  ) {
    throw new Error("MAGE_RECEIPT_IDENTITY_INVALID");
  }
  const readbacks: AnyRecord[] = [];
  let peakVram = 0;
  for (const [index, itemValue] of output.items.entries()) {
    const item = itemValue as AnyRecord;
    if (
      item.output_object_key !== objectKeys[index] ||
      typeof item.output_sha256 !== "string" ||
      !Number.isSafeInteger(item.output_bytes) ||
      item.output_bytes < 1
    ) {
      throw new Error("MAGE_OUTPUT_LINEAGE_INVALID");
    }
    const getPort = await routePort(
      {
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "GET",
        account_id: ACCOUNT,
        workspace_id: WORKSPACE,
        object_key: item.output_object_key,
        content_type: "image/png",
        max_content_length: OUTPUT_LIMIT,
        lifetime_seconds: 600,
        content_length: item.output_bytes,
        checksum_sha256: item.output_sha256,
      },
      nonce,
    );
    const response = await fetch(getPort.url);
    if (!response.ok) throw new Error("MAGE_OUTPUT_READBACK_FAILED");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const checksum = hashText(Buffer.from(bytes).toString("binary"));
    const byteHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength !== item.output_bytes || byteHash !== item.output_sha256) {
      throw new Error("MAGE_OUTPUT_DURABILITY_MISMATCH");
    }
    if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
      throw new Error("MAGE_OUTPUT_NOT_PNG");
    }
    const evidence = item.runtime_evidence as AnyRecord | undefined;
    const itemPeak = Number(evidence?.gpu?.peak_vram_used_bytes ?? 0);
    if (Number.isFinite(itemPeak)) peakVram = Math.max(peakVram, itemPeak);
    readbacks.push({ bytes: bytes.byteLength, sha256: byteHash });
    void checksum;
  }
  return {
    provider_job_id_hash: hashText(job.id),
    status: job.status,
    execution_time_ms: job.executionTimeMs,
    delay_time_ms: job.delayTimeMs,
    item_count: output.items.length,
    peak_vram_used_bytes: peakVram,
    readbacks,
    receipt_sha256: receipt.receipt_sha256,
    timings: receipt.timings,
  };
}

async function verifyBatchWithDiagnostic(
  harness: RunPodV207QualificationHarness,
  job: RunPodJobResult,
  objectKeys: readonly string[],
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  try {
    return await verifyBatch(job, objectKeys, nonce, receiptKeyId, receiptSecret);
  } catch (error) {
    try {
      const diagnostic = await harness.diagnostic(job.id);
      console.error(`v207:provider-diagnostic=${JSON.stringify(diagnostic)}`);
    } catch (diagnosticError) {
      console.error(
        `v207:provider-diagnostic-unavailable=${
          diagnosticError instanceof Error ? diagnosticError.message : "UNKNOWN"
        }`,
      );
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.RUNPOD_KEY;
  if (!apiKey) throw new Error("RUNPOD_KEY_MISSING");
  const wranglerConfigPath =
    process.env.V207_WRANGLER_CONFIG ?? "dist-staging/videoforge_v2_06_staging/v207-wrangler.json";
  const wranglerConfig = JSON.parse(await readFile(wranglerConfigPath, "utf8")) as AnyRecord;
  const nonce = String(
    process.env.V207_AUTHORITY_NONCE ?? wranglerConfig.vars?.VIDEOFORGE_V207_AUTHORITY_NONCE ?? "",
  );
  if (!/^[a-f0-9]{64}$/u.test(nonce)) throw new Error("V207_NONCE_MISSING");
  const receiptKeyId = "v207-qualification-20260820";
  const receiptSecret = randomBytes(32);
  const baseline = await billingAmount(apiKey);
  const spendSnapshotUsd = async (): Promise<number> => {
    const current = await billingAmount(apiKey);
    const delta = Math.max(0, current - baseline);
    if (delta > finiteCapUsd) throw new Error("V207_FINITE_CAP_EXCEEDED");
    return delta;
  };
  const control = new RunPodControlClient({ apiKey });
  const placement: RunPodV207Placement = {
    networkVolumeId: VOLUME_ID,
    dataCenterIds: ["EU-RO-1"],
  };
  const harness = new RunPodV207QualificationHarness({
    control,
    apiKey,
    templateName: "videoforge_mage_v207_20260820",
    endpointName: "videoforge_mage_v207_20260820",
    imageName: IMAGE,
    containerDiskInGb: 120,
    templateEnvironment: {
      MAGE_MODEL_ROOT: "/runpod-volume",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
      DIFFUSERS_OFFLINE: "1",
      VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: IMAGE,
      VIDEOFORGE_MAGE_MANIFEST_SHA256: MANIFEST,
      VIDEOFORGE_MAGE_VOLUME_ID_HASH: VOLUME,
      VIDEOFORGE_MAGE_WORKER_TOKEN: randomBytes(32).toString("hex"),
      VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
      RUNPOD_INIT_TIMEOUT: "800",
      VIDEOFORGE_RECEIPT_KEY_ID: receiptKeyId,
      VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: receiptSecret.toString("hex"),
    },
    placement,
    initialPolicy: {
      workersMin: 0,
      workersMax: 1,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 2_400_000,
    },
    concurrentReaderPolicy: {
      workersMin: 0,
      workersMax: 2,
      gpuCount: 1,
      idleTimeout: 5,
      executionTimeoutMs: 2_400_000,
    },
    finiteSpendCapUsd: finiteCapUsd,
    spendSnapshotUsd,
    pollIntervalMs: 10_000,
    maxPolls: 180,
    sleep,
  });
  const evidence: AnyRecord = {
    schema_version: "videoforge.v2-07-live-qualification/v1",
    started_at: nowIso(),
    approved_finite_spend_cap_usd: finiteCapUsd,
    baseline_endpoint_spend_usd: baseline,
    image_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
    manifest_sha256: MANIFEST,
    volume_id_sha256: VOLUME,
    volume_id_hash: hashText(VOLUME_ID),
    batches: [],
  };
  let success = false;
  const generatedObjectKeys: string[] = [];
  try {
    await harness.create();
    console.error("v207:create-ready");
    const cold = await createBatch("v207-cold-20260820", nonce);
    generatedObjectKeys.push(...cold.objectKeys);
    console.error("v207:cold-ports-ready");
    const coldJob = await harness.dispatchBatch(cold.input);
    console.error("v207:cold-dispatched");
    const coldResult = await harness.reconcile(coldJob.id);
    console.error("v207:cold-terminal");
    const coldEvidence = await verifyBatchWithDiagnostic(
      harness,
      coldResult,
      cold.objectKeys,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
    (evidence.batches as AnyRecord[]).push({ kind: "cold", ...coldEvidence });
    const duplicate = await harness.dispatchBatch(cold.input);
    if (duplicate.id !== coldJob.id) throw new Error("V207_DUPLICATE_DELIVERY_NOT_FENCED");
    evidence.duplicate_delivery_same_job = true;
    await harness.confirmWarmIdle();
    const warm = await createBatch("v207-warm-20260820", nonce);
    generatedObjectKeys.push(...warm.objectKeys);
    console.error("v207:warm-ports-ready");
    const warmJob = await harness.dispatchBatch(warm.input);
    const warmResult = await harness.reconcile(warmJob.id);
    console.error("v207:warm-terminal");
    const warmEvidence = await verifyBatchWithDiagnostic(
      harness,
      warmResult,
      warm.objectKeys,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
    (evidence.batches as AnyRecord[]).push({ kind: "warm", ...warmEvidence });
    await harness.confirmWarmIdle();
    harness.markInitialQualificationComplete();
    evidence.concurrent_config_sha256 = await harness.applyConcurrentReaderPolicy();
    const readerA = await createBatch("v207-reader-a-20260820", nonce);
    const readerB = await createBatch("v207-reader-b-20260820", nonce);
    generatedObjectKeys.push(...readerA.objectKeys, ...readerB.objectKeys);
    const readerJobs = await harness.dispatchConcurrentReaders([readerA.input, readerB.input]);
    const readerResults = await harness.reconcileConcurrentReaders([
      readerJobs[0].id,
      readerJobs[1].id,
    ]);
    const readerEvidenceA = await verifyBatchWithDiagnostic(
      harness,
      readerResults[0],
      readerA.objectKeys,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
    const readerEvidenceB = await verifyBatchWithDiagnostic(
      harness,
      readerResults[1],
      readerB.objectKeys,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
    (evidence.batches as AnyRecord[]).push({ kind: "reader_a", ...readerEvidenceA });
    (evidence.batches as AnyRecord[]).push({ kind: "reader_b", ...readerEvidenceB });
    await harness.drain();
    await harness.scaleDownToInitial();
    const cancel = await createBatch("v207-cancel-20260820", nonce);
    generatedObjectKeys.push(...cancel.objectKeys);
    const cancelJob = await harness.dispatchBatch(cancel.input);
    const cancelled = await harness.cancel(cancelJob.id);
    if (cancelled.status !== "CANCELLED") throw new Error("V207_CANCEL_UNCONFIRMED");
    evidence.cancel_status = cancelled.status;
    await harness.scaleDownToInitial();
    evidence.spend_usd = await spendSnapshotUsd();
    await harness.cleanup({ deleteIfFailed: false, failed: false });
    success = true;
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    try {
      await deleteGeneratedObjects(generatedObjectKeys, nonce);
      evidence.generated_output_rollback = "CONFIRMED";
    } catch (rollbackError) {
      evidence.generated_output_rollback = "UNCERTAIN";
      evidence.generated_output_rollback_error =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
    }
    try {
      await harness.cleanup({ deleteIfFailed: true, failed: true });
    } catch (cleanupError) {
      evidence.cleanup_error =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
    throw error;
  } finally {
    evidence.finished_at = nowIso();
    evidence.success = success;
    evidence.harness = await harness.evidence();
    await writeFile(RESULT_PATH, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  }
}

await main();
