/**
 * TEMPORARY probe 6 (delete after use): the SRC (v19) builder + gemini, with
 * the full 10-scene first batch, to see whether a rebuilt bundle's request is
 * accepted by the provider.
 */
import { readFileSync } from "node:fs";

import { hostedPromptAuthority, hostedPromptBatchPlan } from "./hosted-prompt-run";
import { sha256 } from "./crypto";

const src = await import("../../../../../packages/pipeline/src/prompts/runware-deepseek-writer.js");

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
const first = batchPlan.batches[0]!;
const request = src.buildRunwarePromptRequest(first.batch, first.batch.scenes, 1, null, 1);
const parsed = JSON.parse(request.requestBytes) as Array<Record<string, unknown>>;
console.log("src model constant:", parsed[0]!.model, "requestVersion:", request.requestVersion);
console.log("maxTokens:", (parsed[0]!.settings as { maxTokens: number }).maxTokens, "bytes:", request.requestBytes.length);

const apiKey = readFileSync(
  "/Users/lakshmansai/.videoforge/v2-09/runware-secret-continuation/runware-api-key",
  "utf8",
).trim();

const started = Date.now();
const response = await fetch("https://api.runware.ai/v1", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body: request.requestBytes,
});
const text = await response.text();
const ms = Date.now() - started;
let summary = "";
try {
  const parsedBody = JSON.parse(text) as {
    data?: Array<Record<string, unknown>>;
    errors?: Array<Record<string, unknown>>;
  };
  if (parsedBody.errors?.length) summary = `errors=${JSON.stringify(parsedBody.errors[0]).slice(0, 300)}`;
  const item = parsedBody.data?.[0];
  if (item) summary = `cost=${item.cost} finish=${item.finishReason} model=${item.model}`;
} catch {
  summary = `body=${text.slice(0, 200)}`;
}
console.log(`src-v19 10-scene: status=${response.status} ms=${ms} ${summary}`);
