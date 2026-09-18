/**
 * TEMPORARY probe 2 (delete after use): identical deployed request shape, but
 * with the model the src pins (google:gemini@3.5-flash), to observe the
 * provider's successful answer: model field, cost, usage, finishReason.
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
const authority = hostedPromptAuthority({ plan, identity, reservedCostMicroUsd: 40_000, redispatchApproved: true });
const batchPlan = hostedPromptBatchPlan(authority);
const first = batchPlan.batches[0]!;
const request = pipeline.buildRunwarePromptRequest(first.batch, first.batch.scenes, 1, null, 1);
const parsed = JSON.parse(request.requestBytes) as Array<Record<string, unknown>>;
parsed[0]!.model = "google:gemini@3.5-flash";
const body = JSON.stringify(parsed);

const apiKey = readFileSync(
  "/Users/lakshmansai/.videoforge/v2-09/runware-secret-continuation/runware-api-key",
  "utf8",
).trim();

const started = Date.now();
const response = await fetch("https://api.runware.ai/v1", {
  method: "POST",
  headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
  body,
});
const text = await response.text();
console.log("elapsed_ms:", Date.now() - started, "status:", response.status);
try {
  const parsedBody = JSON.parse(text) as {
    data?: Array<Record<string, unknown>>;
    errors?: unknown;
  };
  if (parsedBody.errors) console.log("errors:", JSON.stringify(parsedBody.errors).slice(0, 600));
  const item = parsedBody.data?.[0];
  if (item) {
    console.log(
      "model:",
      item.model,
      "| finishReason:",
      item.finishReason,
      "| cost:",
      item.cost,
      "| usage:",
      JSON.stringify(item.usage),
    );
    const out = typeof item.text === "string" ? (JSON.parse(item.text) as { scenes?: unknown[] }) : null;
    console.log("text is JSON, scenes:", out?.scenes?.length);
  }
} catch {
  console.log("raw body_head:", text.slice(0, 600));
}
