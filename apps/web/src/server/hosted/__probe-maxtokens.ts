/**
 * TEMPORARY probe 5 (delete after use): 10-scene gemini request reproducibility
 * and whether settings.maxTokens is the discriminator for the 400.
 * D1: 10 scenes, maxTokens 8192 (repeat of the failing probe).
 * D2: 10 scenes, maxTokens 4096.
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

const apiKey = readFileSync(
  "/Users/lakshmansai/.videoforge/v2-09/runware-secret-continuation/runware-api-key",
  "utf8",
).trim();

async function send(label: string, maxTokens: number): Promise<void> {
  const parsed = JSON.parse(request.requestBytes) as Array<Record<string, unknown>> & {
    0: { model?: string; settings?: { maxTokens?: number } };
  };
  parsed[0]!.model = "google:gemini@3.5-flash";
  parsed[0]!.settings = { ...(parsed[0]!.settings as object), maxTokens };
  const body = JSON.stringify(parsed);
  const started = Date.now();
  const response = await fetch("https://api.runware.ai/v1", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body,
  });
  const text = await response.text();
  const ms = Date.now() - started;
  let summary = "";
  try {
    const parsedBody = JSON.parse(text) as {
      data?: Array<Record<string, unknown>>;
      errors?: Array<Record<string, unknown>>;
    };
    if (parsedBody.errors?.length) summary = `errors=${JSON.stringify(parsedBody.errors[0]?.code)}`;
    const item = parsedBody.data?.[0];
    if (item) {
      const usage = item.usage as { completionTokens?: number } | undefined;
      summary = `cost=${item.cost} finish=${item.finishReason} completionTokens=${usage?.completionTokens}`;
    }
  } catch {
    summary = `body=${text.slice(0, 80)}`;
  }
  console.log(`${label}: scenes=10 maxTokens=${maxTokens} status=${response.status} ms=${ms} ${summary}`);
}

await send("D1", 8192);
await send("D2", 4096);
