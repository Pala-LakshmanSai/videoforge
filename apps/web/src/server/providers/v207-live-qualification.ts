import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  RunPodControlClient,
  type RunPodJobResult,
  type RunPodV207Placement,
  V207_RUNPOD_EXECUTION_TIMEOUT_MS,
  V207_RUNPOD_GPU,
  V207_RUNPOD_INIT_TIMEOUT_SECONDS,
  V207_RUNPOD_MIN_CUDA_VERSION,
  V207_RUNPOD_MODEL_ROOT,
  V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
  V207_RUNPOD_REGION,
  V207_RUNPOD_VOLUME_MOUNT,
} from "./runpod-control";
import {
  RunPodV207QualificationHarness,
  type RunPodV207DispatchBatchInput,
  type RunPodV207OutputAuthority,
} from "./runpod-v207-qualification-harness";
import { loadSujalRunPodApiKeyFromKeychain, SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import {
  parseV207ActivationAuthority,
  V207_REPAIRED_IMAGE_BASE_DIGEST,
  V207_REPAIRED_IMAGE_CONFIG_DIGEST,
  V207_REPAIRED_IMAGE_LAYER_DIGEST,
  V207_REPAIRED_IMAGE_SOURCE_COMMIT,
} from "./v207-activation-authority";
const MANIFEST = "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b";
const VOLUME = "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619";
const SOULX_VOLUME = "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be";
const VOLUME_ID = "c7kg89brtj";
const ACCOUNT = "account-a";
const WORKSPACE = "workspace-a";
const PROJECT = "project-a";
const REVISION = "revision-a";
const MODEL_REVISION = "d8c99241f6fa80fbd453014234af2bf337ea21e6";
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const QUALIFICATION_SCENES = [
  "A documentary photograph of a small mixed farm at sunrise, wide environmental context",
  "Close documentary photograph of weathered hands testing dark soil in a field",
  "A farmer planting vegetable seeds in straight rows, natural morning light",
  "Drip irrigation watering young green crops, realistic agricultural detail",
  "A woman farmer inspecting healthy leaves for pests, candid documentary framing",
  "A compact tractor moving slowly between crop rows, rural landscape behind it",
  "Two farm workers harvesting ripe red apples into wooden crates",
  "Macro documentary photograph of a fresh red apple with natural skin texture",
  "Harvested vegetables being washed with clean water at a farm packing table",
  "Hands sorting tomatoes by ripeness into reusable plain crates",
  "A refrigerated farm truck being loaded at a rural distribution shed",
  "Wide photograph of a wholesale produce market opening before dawn",
  "A market vendor arranging colorful fresh produce at a simple stall",
  "A parent and child choosing fresh vegetables at a neighborhood market",
  "Reusable grocery bags filled with unbranded fruit and vegetables on a kitchen counter",
  "Hands rinsing leafy greens in a bright home kitchen sink",
  "Close photograph of a cook safely chopping carrots on a wooden board",
  "Vegetables simmering in a plain metal pan, realistic steam and texture",
  "A family sharing a home-cooked vegetable meal at a modest dining table",
  "Kitchen scraps being collected in a small countertop compost container",
  "A gardener turning mature compost into raised garden soil",
  "Inside a working greenhouse with rows of plants and diffused daylight",
  "A honeybee pollinating a white orchard blossom, sharp macro evidence",
  "A field technician checking a simple weather sensor beside crops",
  "Farmers sheltering harvested crates from a sudden rain shower",
  "Wide dry field showing the practical effect of drought on crops",
  "A community water tank supplying irrigation lines to small farms",
  "Historical documentary-style scene of farmers using hand tools in the 1940s, no signage",
  "Modern agricultural researchers examining plant samples in a clean laboratory",
  "A split-safe portrait of a farmer standing on the left beside an open field",
  "Aerial documentary view of patchwork farms connected to a nearby town",
  "Fresh produce served on a plain table beside a window, quiet closing image",
] as const;
const ROUTE =
  "https://videoforge-v2-06-staging.lakshmansai121.workers.dev/api/v2/v207/generated-output-port";
const RESULT_PATH = "/tmp/videoforge-v207-live-result.json";
const BILLING_START = "2026-08-20T00:00:00.000Z";
const IMAGE_CONFIG_DIGEST = V207_REPAIRED_IMAGE_CONFIG_DIGEST;
const IMAGE_LAYER_DIGEST = V207_REPAIRED_IMAGE_LAYER_DIGEST;
const IMAGE_BASE_DIGEST = V207_REPAIRED_IMAGE_BASE_DIGEST;
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

export class V207QualificationCancelled extends Error {
  readonly code = "V207_QUALIFICATION_CANCELLED" as const;

  constructor() {
    super("V207_QUALIFICATION_CANCELLED");
    this.name = "V207QualificationCancelled";
  }
}

export interface V207Cancellation {
  readonly requested: boolean;
  request(): void;
  throwIfRequested(): void;
}

/**
 * Keep signal handling synchronous and side-effect free.  The main qualification loop observes
 * this state at bounded phase/status boundaries, then enters its existing rollback path.
 */
export function createV207Cancellation(): V207Cancellation {
  let requested = false;
  return {
    get requested() {
      return requested;
    },
    request(): void {
      requested = true;
    },
    throwIfRequested(): void {
      if (requested) throw new V207QualificationCancelled();
    },
  };
}

type SignalTarget = Pick<NodeJS.Process, "on" | "off">;

/** Install removable handlers so SIGINT/SIGTERM cannot bypass catch/finally cleanup. */
export function installV207SignalHandlers(
  cancellation: V207Cancellation,
  target: SignalTarget = process,
): () => void {
  const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const handlers = new Map<NodeJS.Signals, () => void>();
  for (const signal of signals) {
    const handler = (): void => {
      cancellation.request();
      console.error("v207:cancellation-requested");
    };
    handlers.set(signal, handler);
    target.on(signal, handler);
  }
  return (): void => {
    for (const signal of signals) {
      const handler = handlers.get(signal);
      if (handler) target.off(signal, handler);
    }
  };
}

const SAFE_EVIDENCE_KEYS = new Set([
  "schema_version",
  "phase",
  "event",
  "kind",
  "status",
  "result",
  "code",
  "source_commit",
  "base_digest",
  "manifest_digest",
  "config_digest",
  "image_digest",
  "imageDigest",
  "model_revision",
  "comfyui_revision",
  "precision",
  "region",
  "volume_mount",
  "volume_write_policy",
  "attestation_scope",
  "billing_settlement",
  "generated_output_rollback",
  "cancel_status",
  "cancel_output_cleanup",
]);

/**
 * Persist only bounded qualification facts.  Unknown strings are removed rather than relying on
 * every future provider/error shape to remember the secret/URL/raw-ID rules.
 */
export function redactV207LiveEvidence(value: unknown): AnyRecord {
  const visit = (candidate: unknown, key: string | null, depth: number): unknown => {
    if (depth > 10) return "[REDACTED_DEPTH]";
    if (typeof candidate === "string") {
      if (/^https?:\/\//u.test(candidate)) return "[REDACTED_URL]";
      const hashKey = key !== null && /(?:hash|hashes|sha256|digest|digests)$/iu.test(key);
      if (hashKey) {
        return /^sha256:[a-f0-9]{64}$/u.test(candidate) ? candidate : "[REDACTED]";
      }
      if (
        key !== null &&
        /_at$/iu.test(key) &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(candidate)
      ) {
        return candidate;
      }
      if (key === "os" && /^(?:linux|windows|darwin)$/iu.test(candidate)) return candidate;
      if (key === "architecture" && /^(?:amd64|arm64|x86_64)$/iu.test(candidate)) {
        return candidate;
      }
      if (key !== null && /(?:region|regions)$/iu.test(key) && candidate === V207_RUNPOD_REGION) {
        return candidate;
      }
      if (
        key !== null &&
        (/(?:api[_-]?key|authorization|password|secret|cookie|capability|nonce|token)/iu.test(
          key,
        ) ||
          /(?:^|_)(?:url|uri|id|reservation_id|job_id|endpoint_id|template_id|volume_id)$/iu.test(
            key,
          ) ||
          /id$/iu.test(key))
      ) {
        return "[REDACTED]";
      }
      if (key === "run_tag")
        return /^202[0-9]{5}-[a-f0-9]{12}$/u.test(candidate) ? candidate : "[REDACTED]";
      if (key !== null && SAFE_EVIDENCE_KEYS.has(key)) {
        if (/^[0-9a-f]{40}$/u.test(candidate) || SAFE_PROVIDER_CODE.test(candidate)) {
          return candidate;
        }
        if (/^(?:[A-Za-z0-9._/-]{1,120})$/u.test(candidate)) return candidate;
      }
      return SAFE_PROVIDER_CODE.test(candidate) ? candidate : "[REDACTED]";
    }
    if (typeof candidate === "number" || typeof candidate === "boolean" || candidate === null) {
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map((entry) => visit(entry, key, depth + 1));
    if (candidate && typeof candidate === "object") {
      const output: AnyRecord = {};
      for (const [entryKey, entry] of Object.entries(candidate as AnyRecord)) {
        output[entryKey] = visit(entry, entryKey, depth + 1);
      }
      return output;
    }
    return "[REDACTED]";
  };
  const result = visit(value, null, 0);
  return (
    result && typeof result === "object" && !Array.isArray(result) ? result : { value: result }
  ) as AnyRecord;
}

const RESULT_TEMP_PATH = `${RESULT_PATH}.tmp`;

async function writeV207EvidenceCheckpoint(value: AnyRecord): Promise<void> {
  const redacted = redactV207LiveEvidence(value);
  try {
    await writeFile(RESULT_TEMP_PATH, JSON.stringify(redacted, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(RESULT_TEMP_PATH, 0o600);
    await rename(RESULT_TEMP_PATH, RESULT_PATH);
    await chmod(RESULT_PATH, 0o600);
  } catch {
    throw new Error("V207_EVIDENCE_CHECKPOINT_WRITE_FAILED");
  }
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
    const signedPort = typeof value.url === "string" && /^https:\/\//u.test(value.url);
    const finalized =
      body.operation === "FINALIZE" &&
      value.schema_version === "videoforge-v207-generated-output-finalization/v1";
    if (response.ok && (signedPort || finalized)) return value;
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
      rollback_token: createHmac("sha256", nonce).update(objectKey).digest("hex"),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`V207_OUTPUT_DELETE_${response.status}`);
  const value = (await response.json()) as AnyRecord;
  if (
    value.schema_version !== "videoforge-v207-generated-output-delete/v1" ||
    value.deleted !== true
  ) {
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

const GHCR_BLOB_REDIRECT_HOST = "pkg-containers.githubusercontent.com" as const;

/**
 * GHCR serves private blob content through a short-lived, signed redirect.  Follow exactly one
 * HTTPS redirect to the GitHub blob host, never forward the registry bearer token, and reject
 * every other redirect shape.  This keeps image attestation deterministic without allowing an
 * attacker-controlled URL or credential forwarding to enter the qualification process.
 */
export function isAllowedV207GhcrBlobRedirect(target: URL, expectedDigest: string): boolean {
  return (
    target.protocol === "https:" &&
    target.hostname === GHCR_BLOB_REDIRECT_HOST &&
    target.username === "" &&
    target.password === "" &&
    target.hash === "" &&
    target.searchParams.has("se") &&
    target.searchParams.has("sig") &&
    new RegExp(
      `^/ghcrblobs[^/]+/blobs/${expectedDigest.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
      "u",
    ).test(target.pathname)
  );
}

async function ghcrFetch(
  url: string,
  headers: Readonly<Record<string, string>>,
  expectedDigest?: string,
): Promise<Response> {
  const first = await fetch(url, {
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (first.status < 300 || first.status >= 400) return first;
  if (expectedDigest === undefined) throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  const location = first.headers.get("location");
  if (!location) throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  let redirect: URL;
  try {
    redirect = new URL(location, url);
  } catch {
    throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  }
  if (!isAllowedV207GhcrBlobRedirect(redirect, expectedDigest)) {
    throw new Error("V207_IMAGE_REGISTRY_REDIRECT_INVALID");
  }
  // The signed URL is self-authorizing.  Deliberately send only Accept, never Authorization.
  return fetch(redirect, {
    headers: { accept: headers.accept ?? "application/octet-stream" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}

async function ghcrGet(path: string, accept: string): Promise<Response> {
  const url = `https://ghcr.io${path}`;
  const blobMatch = path.match(/\/blobs\/(sha256:[a-f0-9]{64})$/u);
  const expectedDigest = blobMatch?.[1];
  const first = await ghcrFetch(url, { accept }, expectedDigest);
  if (first.status !== 401) return first;
  const challenge = first.headers.get("www-authenticate") ?? "";
  const fields = new Map<string, string>();
  for (const match of challenge.matchAll(/([a-z]+)="([^"]+)"/gu)) {
    if (match[1] && match[2] && !fields.has(match[1])) fields.set(match[1], match[2]);
  }
  if (
    !challenge.startsWith("Bearer ") ||
    fields.get("realm") !== "https://ghcr.io/token" ||
    fields.get("service") !== "ghcr.io" ||
    fields.get("scope") !== "repository:pala-lakshmansai/videoforge-mage-v2-07:pull"
  ) {
    throw new Error("V207_IMAGE_REGISTRY_AUTH_INVALID");
  }
  const tokenUrl = new URL(fields.get("realm")!);
  tokenUrl.searchParams.set("service", fields.get("service")!);
  tokenUrl.searchParams.set("scope", fields.get("scope")!);
  const tokenResponse = await fetch(tokenUrl, { signal: AbortSignal.timeout(30_000) });
  const tokenValue = tokenResponse.ok ? ((await tokenResponse.json()) as AnyRecord).token : null;
  if (typeof tokenValue !== "string" || tokenValue.length < 20 || /\s/u.test(tokenValue)) {
    throw new Error("V207_IMAGE_REGISTRY_TOKEN_INVALID");
  }
  return ghcrFetch(url, { accept, authorization: `Bearer ${tokenValue}` }, expectedDigest);
}

type V207PreflightSummary = Readonly<{
  readonly schema_version: "videoforge.v2-07-preflight/v1";
  readonly image_attestation: AnyRecord;
  readonly runpod_account_id_sha256: string;
  readonly baseline_endpoint_spend_usd: number;
  readonly remaining_cumulative_cap_usd: number;
  readonly route_authority: Readonly<{ readonly status: number; readonly code: string }>;
  readonly inventory: Readonly<{
    readonly checked_at: string;
    readonly pod_count: number;
    readonly endpoint_count: number;
    readonly private_template_count: number;
    readonly active_serverless_workers: number;
    readonly volume_id_hashes: readonly string[];
  }>;
}>;

/**
 * Check the exact live boundary without creating a template, endpoint, worker, job, or R2
 * reservation.  This mode exists to diagnose provider-free startup failures (for example, an
 * image-registry attestation failure) before the mutation boundary is crossed.
 */
async function preflightRouteAuthority(): Promise<{
  readonly status: number;
  readonly code: string;
}> {
  let response: Response;
  try {
    response = await fetch(ROUTE, {
      method: "POST",
      headers: { "content-type": "application/json", connection: "close" },
      body: "{}",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("V207_ROUTE_PROBE_FAILED");
  }
  let value: unknown;
  try {
    value = (await response.json()) as unknown;
  } catch {
    throw new Error("V207_ROUTE_PROBE_INVALID");
  }
  const error =
    value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord).error : null;
  const code =
    error &&
    typeof error === "object" &&
    !Array.isArray(error) &&
    typeof (error as AnyRecord).code === "string"
      ? (error as AnyRecord).code
      : "V207_ROUTE_ERROR_UNBOUNDED";
  if (
    !(
      (response.status === 403 && code === "V207_AUTHORITY_REJECTED") ||
      (response.status === 404 && code === "V207_ROUTE_DISABLED")
    )
  ) {
    throw new Error("V207_ROUTE_AUTHORITY_UNVERIFIED");
  }
  return Object.freeze({ status: response.status, code });
}

export function assertV207PreflightInventory(
  inventory: Awaited<ReturnType<RunPodControlClient["inventory"]>>,
): void {
  const volumeIdHashes = [...inventory.networkVolumes]
    .sort((left, right) => left.idHash.localeCompare(right.idHash))
    .map((volume) => volume.idHash);
  const expectedVolumeHashes = [SOULX_VOLUME, VOLUME].sort();
  const mismatchCodes: string[] = [];
  if (inventory.pods.length !== 0 || inventory.runningPodCount !== 0) mismatchCodes.push("PODS");
  if (inventory.endpoints.length !== 0) mismatchCodes.push("ENDPOINTS");
  if (inventory.privateTemplateCount !== 0) mismatchCodes.push("TEMPLATES");
  if (inventory.activeServerlessWorkerCount !== 0) mismatchCodes.push("WORKERS");
  if (JSON.stringify(volumeIdHashes) !== JSON.stringify(expectedVolumeHashes)) {
    mismatchCodes.push("VOLUMES");
  }
  if (
    inventory.networkVolumes.some(
      (volume) =>
        volume.sizeGb !== 50 ||
        volume.dataCenterId !== V207_RUNPOD_REGION ||
        !expectedVolumeHashes.includes(volume.idHash),
    )
  ) {
    mismatchCodes.push("VOLUME_IDENTITY");
  }
  if (mismatchCodes.length > 0) {
    throw new Error(`V207_PREFLIGHT_INVENTORY_UNEXPECTED_${mismatchCodes.join("_")}`);
  }
}

export async function runV207PreflightOnly(): Promise<V207PreflightSummary> {
  const imageAttestation = await attestPublishedImage();
  const apiKey = process.env.RUNPOD_KEY ?? (await loadSujalRunPodApiKeyFromKeychain());
  const account = await assertSujalRunPodAccount(apiKey);
  if (account.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Error("V207_RUNPOD_ACCOUNT_MISMATCH");
  }
  const baseline = await billingAmount(apiKey);
  if (baseline > finiteCapUsd) throw new Error("V207_FINITE_CAP_EXCEEDED");
  const control = new RunPodControlClient({ apiKey });
  const inventory = await control.inventory();
  assertV207PreflightInventory(inventory);
  const routeAuthority = await preflightRouteAuthority();
  return Object.freeze({
    schema_version: "videoforge.v2-07-preflight/v1",
    image_attestation: imageAttestation,
    runpod_account_id_sha256: account.accountIdHash,
    baseline_endpoint_spend_usd: baseline,
    remaining_cumulative_cap_usd: Math.max(0, finiteCapUsd - baseline),
    route_authority: routeAuthority,
    inventory: Object.freeze({
      checked_at: inventory.checkedAt,
      pod_count: inventory.pods.length,
      endpoint_count: inventory.endpoints.length,
      private_template_count: inventory.privateTemplateCount,
      active_serverless_workers: inventory.activeServerlessWorkerCount,
      volume_id_hashes: Object.freeze(
        [...inventory.networkVolumes]
          .sort((left, right) => left.idHash.localeCompare(right.idHash))
          .map((volume) => volume.idHash),
      ),
    }),
  });
}

async function attestPublishedImage(): Promise<AnyRecord> {
  const digest = IMAGE.slice(IMAGE.indexOf("@") + 1);
  const repository = "/v2/pala-lakshmansai/videoforge-mage-v2-07";
  const manifestResponse = await ghcrGet(
    `${repository}/manifests/${digest}`,
    "application/vnd.oci.image.manifest.v1+json",
  );
  if (!manifestResponse.ok || manifestResponse.headers.get("docker-content-digest") !== digest) {
    throw new Error("V207_IMAGE_MANIFEST_ATTESTATION_FAILED");
  }
  const manifest = (await manifestResponse.json()) as AnyRecord;
  if (manifest.config?.digest !== IMAGE_CONFIG_DIGEST) {
    throw new Error("V207_IMAGE_CONFIG_DIGEST_MISMATCH");
  }
  const layers = manifest.layers;
  if (
    !Array.isArray(layers) ||
    layers.length === 0 ||
    (layers[layers.length - 1] as AnyRecord | undefined)?.digest !== IMAGE_LAYER_DIGEST
  ) {
    throw new Error("V207_IMAGE_LAYER_DIGEST_MISMATCH");
  }
  const configResponse = await ghcrGet(
    `${repository}/blobs/${IMAGE_CONFIG_DIGEST}`,
    "application/vnd.oci.image.config.v1+json",
  );
  if (!configResponse.ok) throw new Error("V207_IMAGE_CONFIG_ATTESTATION_FAILED");
  const config = (await configResponse.json()) as AnyRecord;
  const labels = config.config?.Labels as AnyRecord;
  const env = new Set<string>(Array.isArray(config.config?.Env) ? config.config.Env : []);
  if (
    config.os !== "linux" ||
    config.architecture !== "amd64" ||
    JSON.stringify(config.config?.Entrypoint) !==
      JSON.stringify(["python", "/opt/videoforge/mage-serverless-entrypoint.py"]) ||
    labels?.["org.opencontainers.image.revision"] !== V207_REPAIRED_IMAGE_SOURCE_COMMIT ||
    labels?.["ai.videoforge.source-commit"] !== V207_REPAIRED_IMAGE_SOURCE_COMMIT ||
    labels?.["org.opencontainers.image.base.digest"] !== IMAGE_BASE_DIGEST ||
    !env.has("HF_HUB_OFFLINE=1") ||
    !env.has("TRANSFORMERS_OFFLINE=1") ||
    !env.has("DIFFUSERS_OFFLINE=1") ||
    !env.has("MAGE_MODEL_ROOT=/runpod-volume")
  ) {
    throw new Error("V207_IMAGE_CONFIG_IDENTITY_MISMATCH");
  }
  return {
    manifest_digest: digest,
    config_digest: IMAGE_CONFIG_DIGEST,
    source_commit: V207_REPAIRED_IMAGE_SOURCE_COMMIT,
    base_digest: IMAGE_BASE_DIGEST,
    os: config.os,
    architecture: config.architecture,
    offline: true,
  };
}

export function assertV207ItemCount(itemCount: number): void {
  // The sealed worker accepts remote batches in the 32-64 range, but this qualification
  // intentionally owns one exact 32-scene video batch. Keep the local runner narrower so
  // it cannot claim 64 authorities while QUALIFICATION_SCENES supplies only 32 items.
  if (!Number.isSafeInteger(itemCount) || itemCount !== 32) {
    throw new Error("V207_BATCH_ITEM_COUNT_INVALID");
  }
}

async function createBatch(
  attemptId: string,
  nonce: string,
  workerToken: string,
  itemCount: number,
  abortCheck?: () => void,
): Promise<{
  readonly input: RunPodV207DispatchBatchInput;
  readonly objectKeys: readonly string[];
}> {
  assertV207ItemCount(itemCount);
  const outputPrefix =
    `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}` +
    `/lane/mage-image/job/${attemptId}`;
  const authorities: AnyRecord[] = [];
  const outputPutUrls: string[] = [];
  const objectKeys: string[] = [];
  const reservationIds: string[] = [];
  try {
    for (let index = 0; index < itemCount; index += 1) {
      abortCheck?.();
      const objectKey = `${outputPrefix}/artifact/scene-${String(index + 1).padStart(2, "0")}`;
      objectKeys.push(objectKey);
      const signed = await routePort(
        {
          schema_version: "videoforge-v207-generated-output-port-request/v1",
          operation: "PUT",
          account_id: ACCOUNT,
          workspace_id: WORKSPACE,
          object_key: objectKey,
          content_type: "image/png",
          max_content_length: OUTPUT_LIMIT,
          lifetime_seconds: V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS,
        },
        nonce,
      );
      abortCheck?.();
      const authority = signed.authority as AnyRecord;
      if (
        !authority ||
        authority.schema_version !== "artifact-generated-output-authority/v1" ||
        authority.path !== `/${objectKey}` ||
        authority.max_uses !== 1 ||
        typeof authority.reservation_id !== "string"
      ) {
        throw new Error("V207_OUTPUT_AUTHORITY_INVALID");
      }
      authorities.push(authority);
      outputPutUrls.push(signed.url);
      reservationIds.push(authority.reservation_id);
      if ((index + 1) % 8 === 0) console.error(`v207:ports-${attemptId}-${index + 1}`);
    }
  } catch (error) {
    try {
      await deleteGeneratedObjects(objectKeys, nonce);
    } catch {
      throw new Error("V207_BATCH_PORT_ROLLBACK_UNCERTAIN", { cause: error });
    }
    throw error;
  }
  const items = QUALIFICATION_SCENES.slice(0, itemCount).map((positivePrompt, index) => {
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
  const expiresAt = new Date(
    Date.now() + V207_RUNPOD_REQUEST_AUTHORITY_TTL_SECONDS * 1_000,
  ).toISOString();
  const envelopeBody = {
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
      item_count: itemCount,
    },
    runtime: {
      endpoint_profile_id: "mage-serverless-v1",
      deployment_id: "deployment-mage-v207",
      container_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
      model_manifest_sha256: MANIFEST,
      volume_id_sha256: VOLUME,
      volume_mount: V207_RUNPOD_VOLUME_MOUNT,
      volume_write_policy: "APPLICATION_READ_ONLY",
      scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
      gpu_allowlist: [V207_RUNPOD_GPU],
      region: V207_RUNPOD_REGION,
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
      execution_timeout_seconds: V207_RUNPOD_EXECUTION_TIMEOUT_MS / 1_000,
      init_timeout_seconds: V207_RUNPOD_INIT_TIMEOUT_SECONDS,
    },
    policy: {
      model_download_permitted: false,
      volume_mutation_permitted: false,
      pod_lifecycle_permitted: false,
      queue_purge_permitted: false,
    },
  };
  const authoritySha256 = hashText(sortedJson(envelopeBody));
  const signaturePreimage = sortedJson({
    key_id: "worker-key-1",
    authority_sha256: authoritySha256,
  });
  const envelope = {
    ...envelopeBody,
    authority_sha256: authoritySha256,
    signature: {
      algorithm: "HMAC-SHA256",
      key_id: "worker-key-1",
      value: createHmac("sha256", Buffer.from(workerToken, "hex"))
        .update(signaturePreimage)
        .digest("hex"),
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
  expectedAttemptId: string,
  objectKeys: readonly string[],
  authorities: readonly AnyRecord[],
  itemCount: number,
  expectedEndpointIdHash: string,
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  assertV207ItemCount(itemCount);
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
    const outputStatus =
      typeof output?.status === "string" && SAFE_PROVIDER_CODE.test(output.status)
        ? output.status
        : "MISSING";
    const failureCode =
      typeof output?.failure_code === "string" && SAFE_PROVIDER_CODE.test(output.failure_code)
        ? output.failure_code
        : "UNKNOWN";
    throw new Error(`MAGE_OUTPUT_NOT_SUCCEEDED:${outputStatus}:${failureCode}`);
  }
  if (output.items.length !== itemCount || objectKeys.length !== itemCount) {
    throw new Error("MAGE_OUTPUT_ITEM_COUNT_INVALID");
  }
  if (authorities.length !== itemCount) throw new Error("MAGE_AUTHORITY_COUNT_INVALID");
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
  const runtimeProbe = receipt.runtime_probe as AnyRecord;
  const volumeVerification = receipt.volume_verification as AnyRecord;
  const modelReady = receipt.model_ready_evidence as AnyRecord;
  const scratchCleanup = receipt.scratch_cleanup as AnyRecord;
  const receiptItems = receipt.items as AnyRecord[];
  const timings = receipt.timings as AnyRecord;
  const requiredTimings = [
    "allocation_ms",
    "container_ready_ms",
    "volume_verified_ms",
    "model_load_ms",
    "warmup_ms",
    "first_inference_ms",
    "upload_ms",
    "total_ms",
  ] as const;
  if (
    receipt.attempt_id !== expectedAttemptId ||
    receipt.provider_job_id !== job.id ||
    deployment?.container_digest !== IMAGE.slice(IMAGE.indexOf("@") + 1) ||
    deployment?.endpoint_id_sha256 !== expectedEndpointIdHash ||
    deployment?.intended_volume_id_sha256 !== VOLUME ||
    deployment?.intended_region !== V207_RUNPOD_REGION ||
    deployment?.model_manifest_sha256 !== MANIFEST ||
    runtimeProbe?.gpu_name !== V207_RUNPOD_GPU ||
    runtimeProbe?.gpu_count !== 1 ||
    runtimeProbe?.cuda_version !== V207_RUNPOD_MIN_CUDA_VERSION ||
    volumeVerification?.manifest_sha256_before !== MANIFEST ||
    volumeVerification?.manifest_sha256_after !== MANIFEST ||
    volumeVerification?.mutation_detected !== false ||
    volumeVerification?.cross_mount_detected !== false ||
    modelReady?.state !== "MODEL_READY" ||
    modelReady?.warmup_completed !== true ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(modelReady?.warmup_output_sha256 ?? "")) ||
    scratchCleanup?.removed !== true ||
    scratchCleanup?.scratch_on_model_volume !== false ||
    !Array.isArray(receiptItems) ||
    receiptItems.length !== objectKeys.length ||
    !timings ||
    requiredTimings.some(
      (key) => !Number.isSafeInteger(timings[key]) || Number(timings[key]) < 0,
    ) ||
    timings.first_inference_ms < 1 ||
    timings.total_ms < 1
  ) {
    throw new Error("MAGE_RECEIPT_IDENTITY_INVALID");
  }
  const readbacks: AnyRecord[] = [];
  const commitReceipts: AnyRecord[] = [];
  let peakVram = 0;
  for (const [index, itemValue] of output.items.entries()) {
    const item = itemValue as AnyRecord;
    const authority = authorities[index] as AnyRecord;
    const receiptItem = receiptItems[index] as AnyRecord;
    const runtimeEvidence = item.runtime_evidence as AnyRecord;
    const gpu = runtimeEvidence?.gpu as AnyRecord;
    if (
      item.output_object_key !== objectKeys[index] ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(item.output_sha256 ?? "")) ||
      !Number.isSafeInteger(item.output_bytes) ||
      item.output_bytes < 1 ||
      item.output_bytes > OUTPUT_LIMIT ||
      item.width !== 1280 ||
      item.height !== 720 ||
      authority?.path !== `/${objectKeys[index]}` ||
      receiptItem?.item_id !== `scene-${String(index + 1).padStart(2, "0")}` ||
      receiptItem?.state !== "SUCCEEDED" ||
      receiptItem?.output_object_key !== item.output_object_key ||
      receiptItem?.output_sha256 !== item.output_sha256 ||
      receiptItem?.output_bytes !== item.output_bytes ||
      receiptItem?.probe?.width !== 1280 ||
      receiptItem?.probe?.height !== 720 ||
      receiptItem?.probe?.format !== "png" ||
      runtimeEvidence?.schema_version !== "videoforge.mage-runtime-evidence/v3" ||
      runtimeEvidence?.volume_id_hash !== VOLUME ||
      runtimeEvidence?.worker_image_digest !== IMAGE ||
      runtimeEvidence?.model_revision !== MODEL_REVISION ||
      runtimeEvidence?.comfyui_revision !== "26d7f8556822d9d08c2d3e1878636ac3b4969af9" ||
      runtimeEvidence?.precision !== "int8-convrot" ||
      gpu?.name !== V207_RUNPOD_GPU ||
      gpu?.device_count !== 1 ||
      gpu?.cuda_version !== V207_RUNPOD_MIN_CUDA_VERSION ||
      !Number.isSafeInteger(gpu?.peak_vram_used_bytes) ||
      Number(gpu?.peak_vram_used_bytes) < 1
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
    const response = await fetch(getPort.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("MAGE_OUTPUT_READBACK_FAILED");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const byteHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (bytes.byteLength !== item.output_bytes || byteHash !== item.output_sha256) {
      throw new Error("MAGE_OUTPUT_DURABILITY_MISMATCH");
    }
    const png = Buffer.from(bytes);
    if (
      png.length < 24 ||
      png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      png.subarray(12, 16).toString("ascii") !== "IHDR" ||
      png.readUInt32BE(16) !== 1280 ||
      png.readUInt32BE(20) !== 720
    ) {
      throw new Error("MAGE_OUTPUT_NOT_PNG");
    }
    const finalizationRequest = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "FINALIZE",
      account_id: ACCOUNT,
      workspace_id: WORKSPACE,
      object_key: item.output_object_key,
      content_type: "image/png",
      content_length: item.output_bytes,
      checksum_sha256: item.output_sha256,
      reservation_id: authority.reservation_id,
      capability_handle: authority.capability_handle,
      callback_id: `callback-${expectedAttemptId}-${String(index + 1).padStart(2, "0")}`,
    };
    const finalized = await routePort(finalizationRequest, nonce);
    const commitReceipt = finalized.receipt as AnyRecord;
    const commitReceiptBody = { ...commitReceipt };
    delete commitReceiptBody.schema_version;
    delete commitReceiptBody.receipt_id;
    delete commitReceiptBody.receipt_sha256;
    if (
      finalized.schema_version !== "videoforge-v207-generated-output-finalization/v1" ||
      commitReceipt?.schema_version !== "artifact-commit-receipt/v3" ||
      commitReceipt?.reservation_id !== authority.reservation_id ||
      commitReceipt?.object_key !== item.output_object_key ||
      commitReceipt?.content_type !== "image/png" ||
      commitReceipt?.content_length !== item.output_bytes ||
      commitReceipt?.checksum_sha256 !== item.output_sha256 ||
      commitReceipt?.probe?.width !== 1280 ||
      commitReceipt?.probe?.height !== 720 ||
      commitReceipt?.probe?.format !== "png" ||
      commitReceipt?.probe?.decoded !== true ||
      !/^sha256:[0-9a-f]{64}$/u.test(String(commitReceipt?.receipt_sha256 ?? "")) ||
      commitReceipt.receipt_sha256 !== hashText(sortedJson(commitReceiptBody))
    ) {
      throw new Error("MAGE_COMMIT_RECEIPT_INVALID");
    }
    const replayed = await routePort(finalizationRequest, nonce);
    if (replayed.receipt?.receipt_sha256 !== commitReceipt.receipt_sha256) {
      throw new Error("MAGE_COMMIT_RECEIPT_REPLAY_INVALID");
    }
    const itemPeak = Number(gpu.peak_vram_used_bytes);
    peakVram = Math.max(peakVram, itemPeak);
    readbacks.push({ bytes: bytes.byteLength, sha256: byteHash });
    commitReceipts.push({
      receipt_sha256: commitReceipt.receipt_sha256,
      reservation_id: commitReceipt.reservation_id,
      replay_confirmed: true,
    });
  }
  return {
    provider_job_id_hash: hashText(job.id),
    status: job.status,
    execution_time_ms: job.executionTimeMs,
    delay_time_ms: job.delayTimeMs,
    item_count: output.items.length,
    peak_vram_used_bytes: peakVram,
    readbacks,
    commit_receipts: commitReceipts,
    receipt_sha256: receipt.receipt_sha256,
    timings,
  };
}

async function verifyBatchWithDiagnostic(
  harness: RunPodV207QualificationHarness,
  job: RunPodJobResult,
  expectedAttemptId: string,
  objectKeys: readonly string[],
  authorities: readonly AnyRecord[],
  itemCount: number,
  expectedEndpointIdHash: string,
  nonce: string,
  receiptKeyId: string,
  receiptSecret: Buffer,
): Promise<AnyRecord> {
  try {
    return await verifyBatch(
      job,
      expectedAttemptId,
      objectKeys,
      authorities,
      itemCount,
      expectedEndpointIdHash,
      nonce,
      receiptKeyId,
      receiptSecret,
    );
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
  const cancellation = createV207Cancellation();
  const removeSignalHandlers = installV207SignalHandlers(cancellation);
  try {
    cancellation.throwIfRequested();
    if (process.env.V207_PREFLIGHT_ONLY === "1") {
      const summary = await runV207PreflightOnly();
      console.error(
        `v207:preflight-ok=${JSON.stringify({
          schema_version: summary.schema_version,
          image_attestation: summary.image_attestation,
          runpod_account_id_sha256: summary.runpod_account_id_sha256,
          baseline_endpoint_spend_usd: summary.baseline_endpoint_spend_usd,
          remaining_cumulative_cap_usd: summary.remaining_cumulative_cap_usd,
          route_authority: summary.route_authority,
          inventory: summary.inventory,
        })}`,
      );
      return;
    }
    const apiKey = process.env.RUNPOD_KEY ?? (await loadSujalRunPodApiKeyFromKeychain());
    let nonce = process.env.V207_AUTHORITY_NONCE?.trim() ?? "";
    if (!nonce) {
      const wranglerConfigPath =
        process.env.V207_WRANGLER_CONFIG ??
        "dist-staging/videoforge_v2_06_staging/v207-wrangler.json";
      const wranglerConfig = JSON.parse(await readFile(wranglerConfigPath, "utf8")) as AnyRecord;
      nonce = String(wranglerConfig.vars?.VIDEOFORGE_V207_AUTHORITY_NONCE ?? "");
    }
    if (!/^[a-f0-9]{64}$/u.test(nonce)) throw new Error("V207_NONCE_MISSING");
    const imageAttestation = await attestPublishedImage();
    const receiptKeyId = "v207-qualification-20260820";
    const receiptSecret = randomBytes(32);
    const workerToken = randomBytes(32).toString("hex");
    const account = await assertSujalRunPodAccount(apiKey);
    if (account.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
      throw new Error("V207_RUNPOD_ACCOUNT_MISMATCH");
    }
    const baseline = await billingAmount(apiKey);
    if (baseline > finiteCapUsd) throw new Error("V207_FINITE_CAP_EXCEEDED");
    const spendSnapshotUsd = async (): Promise<number> => {
      const current = await billingAmount(apiKey);
      if (current > finiteCapUsd) throw new Error("V207_FINITE_CAP_EXCEEDED");
      const delta = Math.max(0, current - baseline);
      return delta;
    };
    const settledSpendSnapshotUsd = async (): Promise<number> => {
      let previous: number | null = null;
      let stableReads = 0;
      for (let poll = 0; poll < 18; poll += 1) {
        const current = await spendSnapshotUsd();
        stableReads =
          previous !== null && Math.abs(current - previous) < 0.000_001 ? stableReads + 1 : 0;
        previous = current;
        if (stableReads >= 2) return current;
        if ((poll + 1) % 3 === 0) console.error(`v207:billing-settlement-poll-${poll + 1}`);
        await sleep(10_000);
      }
      throw new Error("V207_BILLING_SETTLEMENT_UNCONFIRMED");
    };
    const control = new RunPodControlClient({ apiKey });
    const placement: RunPodV207Placement = {
      networkVolumeId: VOLUME_ID,
      dataCenterIds: [V207_RUNPOD_REGION],
    };
    const evidence: AnyRecord = {
      schema_version: "videoforge.v2-07-live-qualification/v1",
      started_at: nowIso(),
      approved_finite_spend_cap_usd: finiteCapUsd,
      runpod_account_id_sha256: account.accountIdHash,
      baseline_endpoint_spend_usd: baseline,
      remaining_cumulative_cap_at_start_usd: Math.max(0, finiteCapUsd - baseline),
      image_digest: IMAGE.slice(IMAGE.indexOf("@") + 1),
      manifest_sha256: MANIFEST,
      volume_id_sha256: VOLUME,
      volume_id_hash: hashText(VOLUME_ID),
      image_attestation: imageAttestation,
      batches: [],
    };
    const runTag = `20260820-${randomBytes(6).toString("hex")}`;
    evidence.run_tag = runTag;
    let latestHarnessEvidence: AnyRecord | null = null;
    const checkpointEvents: AnyRecord[] = [];
    let checkpointWrite: Promise<void> = Promise.resolve();
    const persistCheckpoint = (phase: string, event?: AnyRecord): Promise<void> => {
      if (event) checkpointEvents.push({ phase, ...event });
      evidence.phase = phase;
      evidence.checkpoint_events = checkpointEvents;
      if (latestHarnessEvidence) evidence.harness = latestHarnessEvidence;
      // Two reader reconciliations can report status concurrently. Serialize the atomic replace so
      // one status checkpoint cannot race another through the shared result temp path.
      checkpointWrite = checkpointWrite.then(
        () => writeV207EvidenceCheckpoint(evidence),
        () => writeV207EvidenceCheckpoint(evidence),
      );
      return checkpointWrite;
    };
    const refreshHarnessCheckpoint = async (phase: string): Promise<void> => {
      latestHarnessEvidence = (await harness.evidence()) as unknown as AnyRecord;
      await persistCheckpoint(phase);
    };
    const harness = new RunPodV207QualificationHarness({
      control,
      apiKey,
      templateName: "videoforge_mage_v207_20260820",
      endpointName: "videoforge_mage_v207_20260820",
      imageName: IMAGE,
      containerDiskInGb: 120,
      templateEnvironment: {
        MAGE_MODEL_ROOT: V207_RUNPOD_MODEL_ROOT,
        HF_HUB_OFFLINE: "1",
        TRANSFORMERS_OFFLINE: "1",
        DIFFUSERS_OFFLINE: "1",
        VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: IMAGE,
        VIDEOFORGE_MAGE_MANIFEST_SHA256: MANIFEST,
        VIDEOFORGE_MAGE_VOLUME_ID_HASH: VOLUME,
        VIDEOFORGE_MAGE_WORKER_TOKEN: workerToken,
        VIDEOFORGE_MAGE_GPU_OFFERING_ID: V207_RUNPOD_GPU,
        RUNPOD_INIT_TIMEOUT: String(V207_RUNPOD_INIT_TIMEOUT_SECONDS),
        VIDEOFORGE_RECEIPT_KEY_ID: receiptKeyId,
        VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: receiptSecret.toString("hex"),
      },
      placement,
      initialPolicy: {
        workersMin: 0,
        workersMax: 1,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      },
      concurrentReaderPolicy: {
        workersMin: 0,
        workersMax: 2,
        gpuCount: 1,
        idleTimeout: 5,
        executionTimeoutMs: V207_RUNPOD_EXECUTION_TIMEOUT_MS,
      },
      finiteSpendCapUsd: finiteCapUsd,
      spendSnapshotUsd,
      pollIntervalMs: 10_000,
      maxPolls: 180,
      sleep,
      abortCheck: cancellation.throwIfRequested,
      onStatusCheckpoint: async (status) => {
        await persistCheckpoint("status", {
          event: "provider_status",
          status: status.status,
          job_id_hash: status.idHash,
          delay_time_ms: status.delayTimeMs,
          execution_time_ms: status.executionTimeMs,
        });
      },
    });
    let success = false;
    const generatedObjectKeys: string[] = [];
    try {
      await persistCheckpoint("initialized");
      cancellation.throwIfRequested();
      await harness.create();
      console.error("v207:create-ready");
      const createdIdentity = await harness.evidence();
      latestHarnessEvidence = createdIdentity as unknown as AnyRecord;
      if (!createdIdentity.endpointIdHash || !createdIdentity.templateIdHash) {
        throw new Error("V207_CREATED_IDENTITY_MISSING");
      }
      await persistCheckpoint("create");
      const probeAttemptId = `v207-probe-${runTag}`;
      const probe = await createBatch(
        probeAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...probe.objectKeys);
      console.error("v207:probe-ports-ready");
      await persistCheckpoint("probe-ports");
      cancellation.throwIfRequested();
      const probeJob = await harness.dispatchBatch(probe.input);
      console.error("v207:probe-dispatched");
      await persistCheckpoint("probe-dispatch");
      const probeResult = await harness.reconcile(probeJob.id);
      console.error("v207:probe-terminal");
      const probeEvidence = await verifyBatchWithDiagnostic(
        harness,
        probeResult,
        probeAttemptId,
        probe.objectKeys,
        probe.input.outputAuthority.authorities as readonly AnyRecord[],
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "owned_probe", ...probeEvidence });
      await persistCheckpoint("probe-terminal");
      await harness.confirmWarmIdle();
      await persistCheckpoint("probe-warm-idle");
      const coldAttemptId = `v207-cold-${runTag}`;
      const cold = await createBatch(
        coldAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...cold.objectKeys);
      console.error("v207:cold-ports-ready");
      await persistCheckpoint("cold-ports");
      cancellation.throwIfRequested();
      const coldJob = await harness.dispatchBatch(cold.input);
      console.error("v207:cold-dispatched");
      await persistCheckpoint("cold-dispatch");
      const coldResult = await harness.reconcile(coldJob.id);
      console.error("v207:cold-terminal");
      const coldEvidence = await verifyBatchWithDiagnostic(
        harness,
        coldResult,
        coldAttemptId,
        cold.objectKeys,
        cold.input.outputAuthority.authorities as readonly AnyRecord[],
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "cold", ...coldEvidence });
      await persistCheckpoint("cold-terminal");
      const duplicate = await harness.dispatchBatch(cold.input);
      if (duplicate.id !== coldJob.id) throw new Error("V207_DUPLICATE_DELIVERY_NOT_FENCED");
      evidence.duplicate_delivery_same_job = true;
      await harness.confirmWarmIdle();
      await persistCheckpoint("cold-warm-idle");
      const warmAttemptId = `v207-warm-${runTag}`;
      const warm = await createBatch(
        warmAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...warm.objectKeys);
      console.error("v207:warm-ports-ready");
      await persistCheckpoint("warm-ports");
      cancellation.throwIfRequested();
      const warmJob = await harness.dispatchBatch(warm.input);
      await persistCheckpoint("warm-dispatch");
      const warmResult = await harness.reconcile(warmJob.id);
      console.error("v207:warm-terminal");
      const warmEvidence = await verifyBatchWithDiagnostic(
        harness,
        warmResult,
        warmAttemptId,
        warm.objectKeys,
        warm.input.outputAuthority.authorities as readonly AnyRecord[],
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "warm", ...warmEvidence });
      await persistCheckpoint("warm-terminal");
      await harness.confirmWarmIdle();
      harness.markInitialQualificationComplete();
      cancellation.throwIfRequested();
      evidence.concurrent_config_sha256 = await harness.applyConcurrentReaderPolicy();
      await refreshHarnessCheckpoint("concurrent-policy");
      const readerAAttemptId = `v207-reader-a-${runTag}`;
      const readerBAttemptId = `v207-reader-b-${runTag}`;
      const readerA = await createBatch(
        readerAAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...readerA.objectKeys);
      const readerB = await createBatch(
        readerBAttemptId,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...readerB.objectKeys);
      await persistCheckpoint("reader-ports");
      const readerJobs = await harness.dispatchConcurrentReaders([readerA.input, readerB.input]);
      await persistCheckpoint("reader-dispatch");
      const readerResults = await harness.reconcileConcurrentReaders([
        readerJobs[0].id,
        readerJobs[1].id,
      ]);
      const readerEvidenceA = await verifyBatchWithDiagnostic(
        harness,
        readerResults[0],
        readerAAttemptId,
        readerA.objectKeys,
        readerA.input.outputAuthority.authorities as readonly AnyRecord[],
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      const readerEvidenceB = await verifyBatchWithDiagnostic(
        harness,
        readerResults[1],
        readerBAttemptId,
        readerB.objectKeys,
        readerB.input.outputAuthority.authorities as readonly AnyRecord[],
        32,
        createdIdentity.endpointIdHash,
        nonce,
        receiptKeyId,
        receiptSecret,
      );
      (evidence.batches as AnyRecord[]).push({ kind: "reader_a", ...readerEvidenceA });
      (evidence.batches as AnyRecord[]).push({ kind: "reader_b", ...readerEvidenceB });
      await persistCheckpoint("reader-terminal");
      await harness.drain();
      cancellation.throwIfRequested();
      await harness.scaleDownToInitial();
      await persistCheckpoint("reader-drained");
      const cancel = await createBatch(
        `v207-cancel-${runTag}`,
        nonce,
        workerToken,
        32,
        cancellation.throwIfRequested,
      );
      generatedObjectKeys.push(...cancel.objectKeys);
      await persistCheckpoint("cancel-ports");
      cancellation.throwIfRequested();
      const cancelJob = await harness.dispatchBatch(cancel.input);
      await persistCheckpoint("cancel-dispatch");
      const cancelled = await harness.cancel(cancelJob.id);
      if (cancelled.status !== "CANCELLED") throw new Error("V207_CANCEL_UNCONFIRMED");
      evidence.cancel_status = cancelled.status;
      await deleteGeneratedObjects(cancel.objectKeys, nonce);
      evidence.cancel_output_cleanup = "CONFIRMED";
      await persistCheckpoint("cancel-terminal");
      await harness.scaleDownToInitial();
      await harness.cleanup({ deleteIfFailed: false, failed: false });
      const finalInventory = await control.inventory();
      const endpoint = finalInventory.endpoints.find(
        (candidate) => candidate.idHash === createdIdentity.endpointIdHash,
      );
      const retainedVolumes = [...finalInventory.networkVolumes].sort((left, right) =>
        left.idHash.localeCompare(right.idHash),
      );
      const expectedVolumeHashes = [SOULX_VOLUME, VOLUME].sort();
      const terminalWorkerStatuses = new Set(["EXITED", "TERMINATED"]);
      if (
        finalInventory.runningPodCount !== 0 ||
        finalInventory.activeServerlessWorkerCount !== 0 ||
        finalInventory.pods.some(
          (pod) =>
            !pod.endpointWorker ||
            pod.endpointIdHash !== createdIdentity.endpointIdHash ||
            !terminalWorkerStatuses.has(pod.desiredStatus) ||
            pod.observedStatuses.length === 0 ||
            pod.observedStatuses.some((status) => !terminalWorkerStatuses.has(status)),
        ) ||
        finalInventory.endpoints.length !== 1 ||
        !endpoint ||
        endpoint.workersMin !== 0 ||
        endpoint.workersMax !== 1 ||
        !endpoint.workerRecordsReported ||
        endpoint.activeWorkerCount !== 0 ||
        endpoint.workerRecordCount !== endpoint.exitedWorkerCount ||
        endpoint.workerStatuses.some((status) => !terminalWorkerStatuses.has(status)) ||
        finalInventory.privateTemplateCount !== 1 ||
        JSON.stringify(retainedVolumes.map((volume) => volume.idHash)) !==
          JSON.stringify(expectedVolumeHashes) ||
        retainedVolumes.some(
          (volume) => volume.sizeGb !== 50 || volume.dataCenterId !== V207_RUNPOD_REGION,
        )
      ) {
        throw new Error("V207_FINAL_INVENTORY_INVALID");
      }
      evidence.final_inventory = {
        checked_at: finalInventory.checkedAt,
        pod_count: finalInventory.pods.length,
        endpoint_count: finalInventory.endpoints.length,
        endpoint_id_hash: endpoint.idHash,
        workers_min: endpoint.workersMin,
        workers_max: endpoint.workersMax,
        active_workers: finalInventory.activeServerlessWorkerCount,
        endpoint_worker_statuses: endpoint.workerStatuses,
        terminal_pod_statuses: finalInventory.pods.map((pod) => pod.observedStatuses),
        private_template_count: finalInventory.privateTemplateCount,
        volume_id_hashes: retainedVolumes.map((volume) => volume.idHash),
        volume_sizes_gb: retainedVolumes.map((volume) => volume.sizeGb),
        volume_regions: retainedVolumes.map((volume) => volume.dataCenterId),
      };
      evidence.spend_usd = await settledSpendSnapshotUsd();
      evidence.cumulative_endpoint_spend_usd = baseline + evidence.spend_usd;
      evidence.billing_settlement = "STABLE_THREE_READS";
      success = true;
    } catch (error) {
      evidence.error = safeQualificationError(error);
      try {
        await deleteGeneratedObjects(generatedObjectKeys, nonce);
        evidence.generated_output_rollback = "CONFIRMED";
      } catch (rollbackError) {
        evidence.generated_output_rollback = "UNCERTAIN";
        evidence.generated_output_rollback_error = safeQualificationError(rollbackError);
      }
      try {
        await harness.cleanup({ deleteIfFailed: true, failed: true });
      } catch (cleanupError) {
        evidence.cleanup_error = safeQualificationError(cleanupError);
      }
      throw error;
    } finally {
      evidence.finished_at = nowIso();
      evidence.success = success;
      evidence.harness = (await harness.evidence()) as unknown as AnyRecord;
      await writeV207EvidenceCheckpoint(evidence);
    }
  } finally {
    removeSignalHandlers();
  }
}

function safeQualificationError(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  if (SAFE_PROVIDER_CODE.test(candidate)) return candidate;
  const code = candidate.match(/^[A-Z][A-Z0-9_.-]{2,80}/u)?.[0];
  return code && SAFE_PROVIDER_CODE.test(code) ? code : "V207_QUALIFICATION_FAILED";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    // The orchestrator captures child output, but direct invocation must also remain bounded and
    // must never print provider diagnostics, signed URLs, or credentials.
    console.error(safeQualificationError(error));
    process.exitCode = 1;
  }
}
