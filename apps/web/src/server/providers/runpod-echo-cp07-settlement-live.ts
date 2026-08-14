import { createHash } from "node:crypto";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const startTime = "2026-08-14T17:44:08.000Z";
const endTime = new Date().toISOString();
const query = new URLSearchParams({
  bucketSize: "hour",
  grouping: "podId",
  startTime,
  endTime,
});
const response = await fetch(`https://rest.runpod.io/v1/billing/pods?${query.toString()}`, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`CP07_BILLING_READ_FAILED_${response.status}`);
const value = (await response.json()) as unknown;
if (!Array.isArray(value)) throw new Error("CP07_BILLING_RESPONSE_INVALID");
const rows = value.map((candidate) => {
  if (typeof candidate !== "object" || candidate === null) {
    throw new Error("CP07_BILLING_RESPONSE_INVALID");
  }
  const row = candidate as Record<string, unknown>;
  if (
    typeof row.podId !== "string" ||
    !Number.isFinite(Number(row.amount)) ||
    !Number.isFinite(Number(row.timeBilledMs))
  ) {
    throw new Error("CP07_BILLING_RESPONSE_INVALID");
  }
  return {
    pod_id_sha256: `sha256:${createHash("sha256").update(row.podId).digest("hex")}`,
    gpu_type_id: row.gpuTypeId,
    amount_usd: Number(row.amount),
    time_billed_ms: Number(row.timeBilledMs),
  };
});
process.stdout.write(`${JSON.stringify({ checked_at: endTime, start_time: startTime, rows })}\n`);
