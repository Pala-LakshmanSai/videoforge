import { createHash } from "node:crypto";

import { SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";

export const CP07_REGION = "EU-RO-1" as const;
export const CP07_ECHO_VOLUME_SIZE_GB = 50 as const;
export const CP07_ECHO_VOLUME_RATE_USD_PER_GB_MONTH = 0.07 as const;
export const CP07_ECHO_VOLUME_MONTHLY_USD = 3.5 as const;
export const CP07_SELECTED_SOURCE_BYTES = 23_922_317_735 as const;
export const CP07_PINNED_SMALL_CONFIG_MAX_BYTES = 50_000_000 as const;
export const CP07_PREPARED_ARTIFACT_MAX_BYTES = 4_000_000_000 as const;
export const CP07_MINIMUM_HEADROOM_BYTES = 22_027_682_265 as const;

const ALLOWED_GPU_IDS = new Set([
  "NVIDIA GeForce RTX 4090",
  "NVIDIA GeForce RTX 5090",
  "NVIDIA L4",
  "NVIDIA RTX PRO 4000 Blackwell",
  "NVIDIA RTX PRO 4500 Blackwell",
  "NVIDIA RTX PRO 6000 Blackwell Server Edition",
]);
const AVAILABILITY = new Set(["LOW", "MEDIUM", "HIGH"]);

type RecordValue = Record<string, unknown>;
type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface Cp07Inventory {
  readonly checkedAt: string;
  readonly pods: readonly { readonly idHash: string }[];
  readonly endpoints: readonly unknown[];
  readonly privateTemplateCount: number;
  readonly networkVolumes: readonly { readonly idHash: string; readonly sizeGb: number | null }[];
  readonly runningPodCount: number;
  readonly activeServerlessWorkerCount: number;
}

export interface Cp07GpuCandidate {
  readonly offeringId: string;
  readonly displayName: string;
  readonly region: typeof CP07_REGION;
  readonly secureCloud: true;
  readonly availability: "LOW" | "MEDIUM" | "HIGH";
  readonly rateUsdPerHour: number;
  readonly vramGb: number;
}

export class Cp07PreflightError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "Cp07PreflightError";
  }
}

const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export function parseCp07Catalog(value: unknown): readonly Cp07GpuCandidate[] {
  const body = record(value);
  const gpus = Array.isArray(body?.gpus) ? body.gpus : [];
  const candidates: Cp07GpuCandidate[] = [];
  for (const item of gpus) {
    const gpu = record(item);
    const offeringId = typeof gpu?.id === "string" ? gpu.id : "";
    if (!ALLOWED_GPU_IDS.has(offeringId)) continue;
    const dataCenters = Array.isArray(gpu?.dataCenters) ? gpu.dataCenters : [];
    const region = dataCenters.map(record).find((candidate) => candidate?.id === CP07_REGION);
    const availability =
      typeof region?.availability === "string"
        ? region.availability
        : typeof gpu?.availability === "string"
          ? gpu.availability
          : "";
    const price = finite(record(gpu?.price)?.secure);
    const memory = finite(gpu?.memory);
    const maximum = finite(record(gpu?.maxCount)?.secure);
    if (
      gpu?.manufacturer !== "NVIDIA" ||
      gpu?.secure !== true ||
      region === undefined ||
      !AVAILABILITY.has(availability) ||
      price === null ||
      price <= 0 ||
      memory === null ||
      memory < 24 ||
      maximum === null ||
      maximum < 1
    ) {
      continue;
    }
    candidates.push({
      offeringId,
      displayName: typeof gpu.name === "string" ? gpu.name : offeringId,
      region: CP07_REGION,
      secureCloud: true,
      availability: availability as Cp07GpuCandidate["availability"],
      rateUsdPerHour: price,
      vramGb: memory,
    });
  }
  return Object.freeze(
    candidates.sort(
      (left, right) =>
        left.rateUsdPerHour - right.rateUsdPerHour ||
        left.offeringId.localeCompare(right.offeringId),
    ),
  );
}

export async function fetchCp07Catalog(
  apiKey: string,
  fetchPort: FetchPort = fetch,
): Promise<readonly Cp07GpuCandidate[]> {
  const url =
    "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=POD&count=1&cloud=SECURE";
  const response = await fetchPort(url, {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Cp07PreflightError("CP07_CATALOG_READ_FAILED");
  const candidates = parseCp07Catalog(await response.json());
  if (candidates.length === 0) {
    throw new Cp07PreflightError("CP07_NO_COMPATIBLE_EU_RO_1_GPU_AVAILABLE");
  }
  return candidates;
}

export async function runCp07ReadOnlyPreflight(input: {
  readonly apiKey: string;
  readonly assertAccount: (apiKey: string) => Promise<{ readonly accountIdHash: string }>;
  readonly inventory: () => Promise<Cp07Inventory>;
  readonly fetchCatalog: () => Promise<readonly Cp07GpuCandidate[]>;
  readonly checkedAt: string;
}): Promise<RecordValue> {
  const account = await input.assertAccount(input.apiKey);
  if (account.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Cp07PreflightError("CP07_ACCOUNT_IDENTITY_MISMATCH");
  }
  const [inventory, gpuCandidates] = await Promise.all([input.inventory(), input.fetchCatalog()]);
  if (
    inventory.pods.length !== 0 ||
    inventory.runningPodCount !== 0 ||
    inventory.endpoints.length !== 0 ||
    inventory.privateTemplateCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0
  ) {
    throw new Cp07PreflightError("CP07_EXISTING_COMPUTE_PRESENT");
  }
  if (inventory.networkVolumes.length !== 1 || inventory.networkVolumes[0]?.sizeGb !== 50) {
    throw new Cp07PreflightError("CP07_EXPECTED_SINGLE_MAGE_VOLUME_MISMATCH");
  }
  const body = {
    schema_version: "videoforge.cp07-read-only-preflight/v1",
    checkpoint: "CP-07",
    checked_at: input.checkedAt,
    external_spend_usd: 0,
    provider_mutations: 0,
    account: { owner: "sujal", account_id_sha256: account.accountIdHash },
    inventory: {
      checked_at: inventory.checkedAt,
      pods: 0,
      endpoints: 0,
      private_templates: 0,
      active_serverless_workers: 0,
      network_volumes: 1,
      retained_mage_volume_id_sha256: inventory.networkVolumes[0]?.idHash,
      retained_mage_volume_size_gb: 50,
      echo_volume_exists: false,
    },
    echo_artifact: {
      selected_runtime_blob_bytes: CP07_SELECTED_SOURCE_BYTES,
      pinned_small_config_max_bytes: CP07_PINNED_SMALL_CONFIG_MAX_BYTES,
      prepared_artifact_max_bytes: CP07_PREPARED_ARTIFACT_MAX_BYTES,
      proposed_volume_size_gb: CP07_ECHO_VOLUME_SIZE_GB,
      minimum_post_preparation_headroom_bytes: CP07_MINIMUM_HEADROOM_BYTES,
    },
    volume_pricing: {
      source: "https://docs.runpod.io/storage/network-volumes",
      standard_network_volume_rate_usd_per_gb_month: CP07_ECHO_VOLUME_RATE_USD_PER_GB_MONTH,
      proposed_ongoing_charge_usd_per_month: CP07_ECHO_VOLUME_MONTHLY_USD,
    },
    gpu_candidates: gpuCandidates,
  };
  return {
    ...body,
    evidence_sha256: `sha256:${createHash("sha256").update(JSON.stringify(body)).digest("hex")}`,
  };
}
