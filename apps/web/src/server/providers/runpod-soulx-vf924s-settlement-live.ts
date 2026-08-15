import { createHash } from "node:crypto";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain";
import { assertSujalRunPodAccount } from "./runpod-account";

const ACCOUNT_HASH = "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const START_TIME = "2026-08-15T07:32:00.000Z";

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const apiKey = await loadSujalRunPodApiKeyFromKeychain();
const account = await assertSujalRunPodAccount(apiKey);
if (account.accountIdHash !== ACCOUNT_HASH) throw new Error("VF924S_SETTLEMENT_ACCOUNT_MISMATCH");

const endTime = new Date().toISOString();
const query = new URLSearchParams({
  bucketSize: "hour",
  grouping: "podId",
  startTime: START_TIME,
  endTime,
});
const response = await fetch(`https://rest.runpod.io/v1/billing/pods?${query.toString()}`, {
  headers: { authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`VF924S_SETTLEMENT_READ_FAILED:${response.status}`);
const value = (await response.json()) as unknown;
if (!Array.isArray(value)) throw new Error("VF924S_SETTLEMENT_RESPONSE_INVALID");
const rows = value.map((candidate) => {
  const item = record(candidate);
  const amount = typeof item?.amount === "number" ? item.amount : Number(item?.amount);
  if (typeof item?.podId !== "string" || !Number.isFinite(amount) || amount < 0) {
    throw new Error("VF924S_SETTLEMENT_RESPONSE_INVALID");
  }
  return {
    pod_id_sha256: `sha256:${createHash("sha256").update(item.podId).digest("hex")}`,
    amount_usd: amount,
  };
});
const byPod = new Map<string, number>();
for (const row of rows) {
  byPod.set(row.pod_id_sha256, (byPod.get(row.pod_id_sha256) ?? 0) + row.amount_usd);
}
const pods = [...byPod.entries()]
  .map(([pod_id_sha256, amount_usd]) => ({ pod_id_sha256, amount_usd }))
  .sort((left, right) => left.pod_id_sha256.localeCompare(right.pod_id_sha256));
process.stdout.write(
  `${JSON.stringify({
    schema_version: "videoforge.soulx-flashhead-pro-vf924s-settlement/v1",
    checked_at: endTime,
    start_time: START_TIME,
    account_id_sha256: ACCOUNT_HASH,
    pod_count: pods.length,
    pods,
    settled_total_usd: pods.reduce((sum, pod) => sum + pod.amount_usd, 0),
  })}\n`,
);
