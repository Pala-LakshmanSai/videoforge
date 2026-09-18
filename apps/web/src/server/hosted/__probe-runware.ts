/**
 * TEMPORARY probe (delete after use). Builds the request with the DEPLOYED
 * pipeline build (packages/pipeline/dist) and sends it to Runware to observe
 * the provider's answer for the model the deployed bundle actually pins.
 */
import { readFileSync } from "node:fs";

import { hostedPromptAuthority, hostedPromptBatchPlan } from "./hosted-prompt-run";
import { sha256 } from "./crypto";

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

const pipeline = await import("@videoforge/pipeline/prompts");
const authority = hostedPromptAuthority({
  plan,
  identity,
  reservedCostMicroUsd: 40_000,
  redispatchApproved: true,
});
const batchPlan = hostedPromptBatchPlan(authority);
const first = batchPlan.batches[0]!;
const request = pipeline.buildRunwarePromptRequest(first.batch, first.batch.scenes, 1, null, 1);
const body = request.requestBytes;

const apiKey = readFileSync(
  "/Users/lakshmansai/.videoforge/v2-09/runware-secret-continuation/runware-api-key",
  "utf8",
).trim();

const model = JSON.parse(body)[0].model;
console.log("bundle model constant:", model);
console.log("settings.maxTokens:", JSON.parse(body)[0].settings.maxTokens, "bytes:", body.length);

const started = Date.now();
const response = await fetch("https://api.runware.ai/v1", {
  method: "POST",
  headers: {
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
  },
  body,
});
const text = await response.text();
console.log("elapsed_ms:", Date.now() - started, "status:", response.status);
console.log("body_head:", text.slice(0, 1200));
