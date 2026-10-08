import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "@videoforge/pipeline";
import { buildKieScenePrompt } from "../providers/kie-image-prompt";
import { sha256 } from "./crypto";
import {
  compileAndPersistHostedPromptBatch,
  hostedPromptAuthority,
  hostedPromptBatchPlan,
} from "./hosted-prompt-run";
import {
  dispatchOneHostedPromptBatch,
  hostedPromptBatchPlanHash,
  recoverClaimedHostedPromptBatch,
} from "./runware-prompt-execution";

const apiKey = "isolated-fixture-key-no-network";
const digest = `sha256:${"a".repeat(64)}` as const;
const uuid = (value: number) => `66000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const profile = JSON.parse(
  readFileSync("../../project-context/evidence/natural_documentary_image_style_v1.json", "utf8"),
);

async function scope(index: number) {
  // Identical scene IDs deliberately recur across all six short, independent projects.
  const scenes = ["cleans a shelf", "holds a cotton cloth"].map((action, ordinal) => ({
    scene_id: `shared-scene-${ordinal}`,
    phrase: `Tenant ${index} worker ${action}.`,
    sentence_context: `Tenant ${index} worker ${action} inside the workshop.`,
    prior_context: null,
    next_context: null,
    in_image_shot_role: "HUMAN_MEDIUM",
    layout: ordinal === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
  }));
  const identity = {
    runId: uuid(index * 100 + 1),
    taskId: uuid(index * 100 + 2),
    attemptId: uuid(index * 100 + 3),
    outboxId: uuid(index * 100 + 4),
    executionProfileId: uuid(index * 100 + 5),
    reservationCostEventId: uuid(index * 100 + 6),
    claimTokenHash: digest,
  };
  const authority = hostedPromptAuthority({
    identity,
    reservedCostMicroUsd: 500_000,
    plan: {
      workspace_id: uuid(index * 100 + 7),
      project_id: uuid(index * 100 + 8),
      revision_id: uuid(index * 100 + 9),
      project_title: `Tenant ${index}`,
      revision_state: "LOCKED",
      timeline_id: uuid(index * 100 + 10),
      timeline_hash: digest,
      image_style_version_id: uuid(999),
      revision_style_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      style_state: "PUBLISHED",
      style_profile_hash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      profile_payload: profile,
      story_context: JSON.stringify({
        subject: `Tenant ${index} workshop`,
        visual_facts: ["worker cleaning a shelf"],
        continuity: [],
        resolved_references: [],
      }),
      all_segments: scenes.map((scene, ordinal) => ({ ...scene, segment_index: ordinal })),
      extra_prompt_keywords: null,
      apply_extra_prompt_keywords: false,
      existing_run_state: null,
      scenes,
    },
  });
  const plan = hostedPromptBatchPlan(authority);
  expect(plan.batchCount).toBe(1);
  return {
    accountId: uuid(index * 100 + 11),
    userId: uuid(index * 100 + 12),
    runId: identity.runId,
    authority,
    plan,
    persistedBinding: {
      plannedBatchCount: plan.batchCount,
      plannedSceneCount: plan.totalScenes,
      batchPlanHash: await hostedPromptBatchPlanHash(plan),
    },
  };
}

type Claim = Parameters<Parameters<typeof dispatchOneHostedPromptBatch>[0]["claim"]>[0];
type Receipt = Parameters<
  NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
>[0];

describe("six independent hosted prompt executions", () => {
  it("keeps reverse-completing responses, receipts, costs and compilation scoped to each run", async () => {
    const scopes = await Promise.all(Array.from({ length: 6 }, (_, index) => scope(index + 1)));
    const pending = new Map<string, () => void>();
    let allArrived!: () => void;
    const barrier = new Promise<void>((resolve) => {
      allArrived = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const wire = JSON.parse(String(init?.body));
      const payload = JSON.parse(
        wire.messages.find((message: { role: string }) => message.role === "user").content,
      );
      await new Promise<void>((resolve) => {
        pending.set(payload.project_title, resolve);
        if (pending.size === 6) allArrived();
      });
      const index = Number(payload.project_title.split(" ")[1]);
      return Response.json({
        id: `chatcmpl-tenant-${index}`,
        model: "openai:gpt@6-luna",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: JSON.stringify({
                batch_id: payload.batch_id,
                scenes: payload.scenes
                  .map((scene: { scene_id: string; in_image_shot_role: string }) => ({
                    scene_id: scene.scene_id,
                    literal_subject: `Tenant ${index} worker`,
                    action: `Tenant ${index} cleans a shelf`,
                    environment: `Tenant ${index} workshop`,
                    in_image_shot_role: scene.in_image_shot_role,
                    lighting_context: "Daylight",
                    continuity_tags: [],
                    prompt_core: `Tenant ${index} scene`,
                  }))
                  .reverse(),
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 1_000 * index,
          completion_tokens: 200 * index,
          total_tokens: 1_200 * index,
        },
      });
    });
    const claims = new Map<string, Claim>();
    const receipts = new Map<string, Receipt>();
    const completed: number[] = [];
    const inputs = scopes.map((owner) => ({
      apiKey,
      plan: owner.plan,
      persistedBinding: owner.persistedBinding,
      batchOrdinal: 0,
      remainingReservationMicroUsd: 500_000,
      // The DB claim decision is a port here; native claim isolation is tested
      // separately. This verifies production dispatch honors a losing claim.
      claim: async (claim: Claim) => {
        if (claims.has(owner.runId)) return false;
        claims.set(owner.runId, claim);
        return true;
      },
      recordResult: async (receipt: Receipt) => {
        expect(receipt.requestHash).toBe(claims.get(owner.runId)!.requestHash);
        expect(receipt.taskUUID).toBe(claims.get(owner.runId)!.taskUUID);
        receipts.set(owner.runId, receipt);
      },
      fetcher,
    }));
    const executions = inputs.map((input, index) =>
      dispatchOneHostedPromptBatch(input).then((result) => {
        completed.push(index + 1);
        return result;
      }),
    );
    await barrier;
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(receipts.size).toBe(0);
    expect(await dispatchOneHostedPromptBatch(inputs[0]!)).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(6);
    for (let index = 6; index >= 1; index--) {
      pending.get(`Tenant ${index}`)!();
      await executions[index - 1];
    }
    const results = await Promise.all(executions);
    expect(completed).toEqual([6, 5, 4, 3, 2, 1]);
    expect(new Set([...claims.values()].map((claim) => claim.taskUUID)).size).toBe(6);
    expect(new Set([...claims.values()].map((claim) => claim.requestHash)).size).toBe(6);
    expect(new Set(scopes.map((owner) => owner.accountId)).size).toBe(6);
    expect(results.reduce((sum, result) => sum + result!.reportedCostMicroUsd, 0)).toBe(4_200);
    const noNetwork = vi.fn<typeof fetch>(async () => {
      throw new Error("Recovery must not submit");
    });
    for (const [index, result] of results.entries()) {
      const owner = scopes[index]!;
      const receipt = receipts.get(owner.runId)!;
      expect(result!.reportedCostMicroUsd).toBe(200 * (index + 1));
      expect(result!.responseHash).toBe(await sha256(receipt.result.outputText));
      expect(result!.responseBytes).toBe(receipt.result.outputText);
      expect(result!.scenes.map((scene) => scene.writerOutput.scene_id)).toEqual([
        "shared-scene-0",
        "shared-scene-1",
      ]);
      for (const row of result!.scenes)
        expect(row.writerOutput.literal_subject).toBe(`Tenant ${index + 1} worker`);
      const persist = vi.fn<NonNullable<Parameters<typeof compileAndPersistHostedPromptBatch>[2]>>(
        async (batch) => {
          for (const scene of batch.scenes) {
            const wire = buildKieScenePrompt(scene.compiledPrompt);
            expect(wire).toContain(`Tenant ${index + 1} worker`);
            expect(wire.length).toBeLessThanOrEqual(800);
            expect(scene.compiledPrompt.promptCompilerVersion).toBe("prompt-compiler-v7");
          }
        },
      );
      await compileAndPersistHostedPromptBatch(
        owner.authority,
        result!,
        persist,
        "local-evidence-v3",
      );
      expect(persist).toHaveBeenCalledOnce();
      const recovery = {
        ...inputs[index]!,
        ...claims.get(owner.runId)!,
        reservationMicroUsd: 500_000,
        fetcher: noNetwork,
      };
      expect(
        await recoverClaimedHostedPromptBatch({ ...recovery, recordedResult: receipt.result }),
      ).toEqual(result);
      // Even with colliding scene IDs, a different tenant's paid receipt is
      // rejected by the sealed request wire hash before scene normalization.
      const foreign = receipts.get(scopes[(index + 1) % 6]!.runId)!;
      await expect(
        recoverClaimedHostedPromptBatch({ ...recovery, recordedResult: foreign.result }),
      ).rejects.toThrow();
      await expect(
        recoverClaimedHostedPromptBatch({ ...recovery, recordedResult: null }),
      ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN" });
    }
    expect(noNetwork).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(receipts.size).toBe(6);
  });
});
