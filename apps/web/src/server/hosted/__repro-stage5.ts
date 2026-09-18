/**
 * TEMPORARY repro script (delete after use). Runs the route's pure path against
 * /tmp/vf-prompt-plan.json with the same module resolution the deployed bundle
 * uses (apps/web src + @videoforge/pipeline dist).
 */
import { readFileSync } from "node:fs";

import { hostedPromptAuthority, hostedPromptBatchPlan } from "./hosted-prompt-run";
import { hostedPromptBatchPlanDocument } from "./hosted-prompt-run";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";

const plan = JSON.parse(readFileSync("/tmp/vf-prompt-plan.json", "utf8")) as Record<string, unknown>;

const uuid = (): string => crypto.randomUUID();
const identity = {
  runId: uuid(),
  taskId: uuid(),
  attemptId: uuid(),
  outboxId: uuid(),
  executionProfileId: uuid(),
  reservationCostEventId: uuid(),
  claimTokenHash: await sha256(`hosted-prompt-claim:${uuid()}`),
};

try {
  const authority = hostedPromptAuthority({
    plan,
    identity,
    reservedCostMicroUsd: 40_000,
    redispatchApproved: true,
  });
  console.log("AUTHORITY OK scenes=", authority.scenes.length, "inputHash=", authority.recordedInputHash);
  const batchPlan = hostedPromptBatchPlan(authority);
  const doc = hostedPromptBatchPlanDocument(batchPlan);
  const hash = await sha256(canonicalJson(doc));
  console.log(
    "BATCHPLAN OK batches=",
    batchPlan.batchCount,
    "scenes=",
    batchPlan.totalScenes,
    "hash=",
    hash,
  );
  console.log(
    "DB hash   : sha256:aa76d692cc46ebaec9bada576b75465e9345ddb5c899397e0d6acbb271ddf81f",
  );
  console.log(
    "probe hash: sha256:422fd636b190940b315fa8392c934e5648e581b25d8a2cbeba3e6744381c889f",
  );
} catch (error) {
  const e = error as Error & { code?: unknown; path?: unknown; stage?: unknown };
  console.log("THROW name=", e?.name, "| code=", e?.code ?? "-", "| path=", JSON.stringify(e?.path ?? null));
  console.log("THROW message=", e?.message);
  console.log((e?.stack ?? "").split("\n").slice(0, 8).join("\n"));
}
