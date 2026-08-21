import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSujalRunPodApiKeyFromKeychain, SUJAL_RUNPOD_ACCOUNT_ID_SHA256 } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";
import {
  RunPodControlClient,
  V207_RUNPOD_MAGE_VOLUME_SIZE_GB,
  V207_RUNPOD_REGION,
  type RunPodInventory,
} from "./runpod-control";
import {
  V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
  V207_FAILED_CLEANUP_VOLUME_ID_HASH,
} from "./runpod-v207-failed-cleanup";

const BILLING_START = "2026-08-20T00:00:00.000Z" as const;
const ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD = 0.12480033212341368 as const;

type FetchPort = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const endpointBillingAmount = async (apiKey: string, fetchPort: FetchPort): Promise<number> => {
  const query = new URLSearchParams({
    bucketSize: "hour",
    grouping: "endpointId",
    startTime: BILLING_START,
    endTime: new Date().toISOString(),
  });
  const response = await fetchPort(`https://rest.runpod.io/v1/billing/endpoints?${query}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("V207_RECONCILIATION_BILLING_READ_FAILED");
  const value = (await response.json()) as unknown;
  if (!Array.isArray(value)) throw new Error("V207_RECONCILIATION_BILLING_RESPONSE_INVALID");
  let amount = 0;
  for (const row of value) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("V207_RECONCILIATION_BILLING_ROW_INVALID");
    }
    const candidate = Number((row as Record<string, unknown>).amount);
    if (!Number.isFinite(candidate) || candidate < 0) {
      throw new Error("V207_RECONCILIATION_BILLING_AMOUNT_INVALID");
    }
    amount += candidate;
  }
  return amount;
};

const validateZeroComputeAndVolumes = (inventory: RunPodInventory): void => {
  const expectedVolumeHashes = [
    V207_FAILED_CLEANUP_SOULX_VOLUME_ID_HASH,
    V207_FAILED_CLEANUP_VOLUME_ID_HASH,
  ].sort();
  const actualVolumeHashes = inventory.networkVolumes.map((volume) => volume.idHash).sort();
  if (
    inventory.pods.length !== 0 ||
    inventory.endpoints.length !== 0 ||
    inventory.privateTemplateCount !== 0 ||
    inventory.runningPodCount !== 0 ||
    inventory.activeServerlessWorkerCount !== 0 ||
    inventory.networkVolumes.length !== 2 ||
    actualVolumeHashes.some((hash, index) => hash !== expectedVolumeHashes[index]) ||
    inventory.networkVolumes.some(
      (volume) =>
        volume.sizeGb !== V207_RUNPOD_MAGE_VOLUME_SIZE_GB ||
        volume.dataCenterId !== V207_RUNPOD_REGION,
    )
  ) {
    throw new Error("V207_RECONCILIATION_INVENTORY_MISMATCH");
  }
};

export interface V207ReadonlyReconciliationResult {
  readonly schema_version: "videoforge.v2-07-readonly-reconciliation/v1";
  readonly checked_at: string;
  readonly account_id_sha256: typeof SUJAL_RUNPOD_ACCOUNT_ID_SHA256;
  readonly provider_mutations: 0;
  readonly gpu_jobs_submitted: 0;
  readonly inventory: {
    readonly pods: 0;
    readonly endpoints: 0;
    readonly private_templates: 0;
    readonly active_serverless_workers: 0;
    readonly running_pods: 0;
    readonly retained_volumes: RunPodInventory["networkVolumes"];
  };
  readonly billing: {
    readonly baseline_endpoint_spend_usd: typeof ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD;
    readonly final_endpoint_spend_usd: number;
    readonly attempt_17_incremental_spend_usd: number;
    readonly settlement: "THREE_STABLE_READS";
  };
}

export async function reconcileV207Readonly(input: {
  readonly accountIdHash: string;
  readonly inventory: () => Promise<RunPodInventory>;
  readonly billingAmount: () => Promise<number>;
  readonly wait?: (milliseconds: number) => Promise<void>;
}): Promise<V207ReadonlyReconciliationResult> {
  if (input.accountIdHash !== SUJAL_RUNPOD_ACCOUNT_ID_SHA256) {
    throw new Error("V207_RECONCILIATION_ACCOUNT_MISMATCH");
  }
  const wait = input.wait ?? sleep;
  let finalInventory: RunPodInventory | null = null;
  let priorBilling: number | null = null;
  let finalBilling = Number.NaN;
  for (let read = 0; read < 3; read += 1) {
    const [inventory, billing] = await Promise.all([input.inventory(), input.billingAmount()]);
    validateZeroComputeAndVolumes(inventory);
    if (!Number.isFinite(billing) || billing < ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD) {
      throw new Error("V207_RECONCILIATION_BILLING_INVALID");
    }
    if (priorBilling !== null && Math.abs(billing - priorBilling) >= 0.000_001) {
      throw new Error("V207_RECONCILIATION_BILLING_UNSETTLED");
    }
    finalInventory = inventory;
    finalBilling = billing;
    priorBilling = billing;
    if (read < 2) await wait(10_000);
  }
  if (finalInventory === null) throw new Error("V207_RECONCILIATION_INVENTORY_MISSING");
  const result: V207ReadonlyReconciliationResult = {
    schema_version: "videoforge.v2-07-readonly-reconciliation/v1",
    checked_at: finalInventory.checkedAt,
    account_id_sha256: SUJAL_RUNPOD_ACCOUNT_ID_SHA256,
    provider_mutations: 0,
    gpu_jobs_submitted: 0,
    inventory: {
      pods: 0,
      endpoints: 0,
      private_templates: 0,
      active_serverless_workers: 0,
      running_pods: 0,
      retained_volumes: finalInventory.networkVolumes,
    },
    billing: {
      baseline_endpoint_spend_usd: ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD,
      final_endpoint_spend_usd: finalBilling,
      attempt_17_incremental_spend_usd: Math.max(
        0,
        finalBilling - ATTEMPT_17_BASELINE_ENDPOINT_SPEND_USD,
      ),
      settlement: "THREE_STABLE_READS",
    },
  };
  return Object.freeze(result);
}

export async function runConfiguredV207ReadonlyReconciliation(): Promise<V207ReadonlyReconciliationResult> {
  const apiKey = await loadSujalRunPodApiKeyFromKeychain();
  const account = await assertSujalRunPodAccount(apiKey);
  const control = new RunPodControlClient({ apiKey });
  return reconcileV207Readonly({
    accountIdHash: account.accountIdHash,
    inventory: () => control.inventory(),
    billingAmount: () => endpointBillingAmount(apiKey, globalThis.fetch),
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void runConfiguredV207ReadonlyReconciliation()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      const code = error instanceof Error ? error.message : "V207_RECONCILIATION_FAILED";
      process.stderr.write(
        `${/^V207_[A-Z0-9_]+$/u.test(code) ? code : "V207_RECONCILIATION_FAILED"}\n`,
      );
      process.exitCode = 1;
    });
}
