/**
 * TEMPORARY probe 4 (delete after use): bisect the provider behaviour.
 * A: deepseek:v4@flash + 1 scene. B: gemini + 2 scenes. C: gemini + 5 scenes.
 * All built with the DEPLOYED pipeline builder (v18).
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

const apiKey = readFileSync(
  "/Users/lakshmansai/.videoforge/v2-09/runware-secret-continuation/runware-api-key",
  "utf8",
).trim();

async function probe(label: string, model: string, sceneCount: number): Promise<void> {
  const sceneSlice = first.batch.scenes.slice(0, sceneCount);
  const batch = pipeline.buildPromptBatch({
    batchId: `${authority.taskId}:batch:${label}`,
    projectTitle: authority.projectTitle,
    imageStyleVersionId: authority.imageStyleVersionId,
    styleProfileHash: authority.styleProfileHash,
    styleTreatment: authority.styleTreatment,
    plannerGuidance: authority.plannerGuidance,
    storyContext: authority.storyContext,
    continuityTags: authority.continuityTags,
    scenes: sceneSlice.map((scene) => ({ ...scene })) as never,
  });
  const request = pipeline.buildRunwarePromptRequest(batch, batch.scenes, 1, null, 1);
  const parsed = JSON.parse(request.requestBytes) as Array<Record<string, unknown>>;
  parsed[0]!.model = model;
  const body = JSON.stringify(parsed);
  const started = Date.now();
  let status = 0;
  let text = "";
  try {
    const response = await fetch("https://api.runware.ai/v1", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body,
    });
    status = response.status;
    text = await response.text();
  } catch (error) {
    console.log(`${label}: FETCH FAILED ${String((error as Error).message)}`);
    return;
  }
  const ms = Date.now() - started;
  let summary = "";
  try {
    const parsedBody = JSON.parse(text) as { data?: Array<Record<string, unknown>>; errors?: Array<Record<string, unknown>> };
    if (parsedBody.errors?.length) summary = `errors=${JSON.stringify(parsedBody.errors[0]?.code)}`;
    const item = parsedBody.data?.[0];
    if (item) summary = `cost=${item.cost} finish=${item.finishReason}`;
  } catch {
    summary = `body=${text.slice(0, 120)}`;
  }
  console.log(`${label}: scenes=${sceneCount} model=${model} bytes=${body.length} status=${status} ms=${ms} ${summary}`);
}

await probe("A", "deepseek:v4@flash", 1);
await probe("B", "google:gemini@3.5-flash", 2);
await probe("C", "google:gemini@3.5-flash", 5);
