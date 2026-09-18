/**
 * TEMPORARY replay (delete after use): drive runHostedPromptExecution with the
 * exact 502 provider response observed live, using the same module resolution
 * the deployed bundle uses, and print the error that escapes.
 */
import { readFileSync } from "node:fs";

import { hostedPromptAuthority, hostedPromptBatchPlan, runHostedPromptExecution } from "./hosted-prompt-run";
import { hostedPromptBatchPlanDocument as documentFromRun } from "./hosted-prompt-run";
import { sha256 } from "./crypto";
import { canonicalJson } from "./submission";

const PROVIDER_502_BODY = JSON.stringify({
  errors: [
    {
      code: "providerUnavailable",
      message:
        "runware-deepseek-v4-flash unavailable. Additional information: <html><head><title>502 Bad Gateway</title></head></html>",
      taskUUID: "78cc13a7-5157-46c2-87df-704e939457e9",
    },
  ],
});

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

const authority = hostedPromptAuthority({ plan, identity, reservedCostMicroUsd: 40_000, redispatchApproved: true });
const batchPlan = hostedPromptBatchPlan(authority);
const batchPlanHash = await sha256(canonicalJson(documentFromRun(batchPlan)));
console.log("plan batches:", batchPlan.batchCount, "scenes:", batchPlan.totalScenes);

const fetcher = (async () =>
  new Response(PROVIDER_502_BODY, { status: 502, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

try {
  await runHostedPromptExecution({
    scope: { workspaceId: authority.workspaceId, actorUserId: identity.taskId },
    authority,
    batchPlan,
    persistedBatchPlanBinding: {
      plannedBatchCount: batchPlan.batchCount,
      plannedSceneCount: batchPlan.totalScenes,
      batchPlanHash,
    },
    command: {
      projectId: authority.projectId,
      revisionId: authority.revisionId,
      timelineId: authority.timelineId,
      taskId: identity.taskId,
      attemptId: identity.attemptId,
      outboxId: identity.outboxId,
      presentedClaimTokenHash: identity.claimTokenHash,
    },
    apiKey: "probe-key-not-used-with-fake-fetcher",
    persist: async () => undefined,
    persistBatch: async () => undefined,
    fetcher,
  });
  console.log("NO THROW (unexpected)");
} catch (error) {
  const e = error as Error & {
    problemCode?: unknown;
    terminalState?: unknown;
    providerMayHaveCharged?: unknown;
    diagnostic?: unknown;
    code?: unknown;
    name?: string;
  };
  console.log("THROWN name:", e?.name);
  console.log("  constructor:", e?.constructor?.name);
  console.log("  problemCode:", e?.problemCode, "| terminalState:", e?.terminalState, "| mayHaveCharged:", e?.providerMayHaveCharged);
  console.log("  diagnostic:", JSON.stringify(e?.diagnostic));
  console.log("  code:", e?.code);
}
