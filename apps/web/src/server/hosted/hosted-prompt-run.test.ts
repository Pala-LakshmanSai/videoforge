import { describe, expect, it, vi } from "vitest";

import type { PromptBatch } from "@videoforge/pipeline";

import { hostedPromptAuthority } from "./hosted-prompt-run";
import { HostedRunwarePromptWriter } from "./runware-prompt-execution";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  revision: "10000000-0000-4000-8000-000000000003",
  timeline: "10000000-0000-4000-8000-000000000004",
  style: "10000000-0000-4000-8000-000000000005",
  run: "10000000-0000-4000-8000-000000000006",
  task: "10000000-0000-4000-8000-000000000007",
  attempt: "10000000-0000-4000-8000-000000000008",
  outbox: "10000000-0000-4000-8000-000000000009",
  profile: "10000000-0000-4000-8000-000000000010",
  reservation: "10000000-0000-4000-8000-000000000011",
} as const;
const digest = `sha256:${"a".repeat(64)}` as const;

function scenes() {
  return Array.from({ length: 25 }, (_, index) => ({
    scene_id: `scene_${String(index + 1).padStart(2, "0")}`,
    phrase: `literal scene ${index + 1}`,
    sentence_context: `Literal scene ${index + 1} belongs to this complete sentence.`,
    prior_context: index === 0 ? null : `literal scene ${index}`,
    next_context: index === 24 ? null : `literal scene ${index + 2}`,
    in_image_shot_role: "OBJECT_EVIDENCE",
    layout: index % 2 === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
  }));
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    workspace_id: ids.workspace,
    project_id: ids.project,
    revision_id: ids.revision,
    project_title: "Hydrogen peroxide",
    revision_state: "LOCKED",
    timeline_id: ids.timeline,
    timeline_hash: digest,
    image_style_version_id: ids.style,
    revision_style_hash: digest,
    style_state: "PUBLISHED",
    style_profile_hash: digest,
    profile_payload: {
      prompt_profile: {
        planner_guidance: "Literal editorial collage treatment.",
        positive_suffix: "tactile paper collage",
        negative_suffix: "visible text",
        full_image_guidance: "16:9 frame with primary evidence inside the center-safe area",
        split_image_guidance: "8:9 right panel with the primary evidence centered",
      },
    },
    story_context: JSON.stringify({ summary: "A literal sequence of numbered scenes." }),
    all_segments: scenes().map((scene, index) => ({
      scene_id: scene.scene_id,
      segment_index: index,
      phrase: scene.sentence_context,
    })),
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    spend_cap_usd: 1,
    existing_run_state: null,
    scenes: scenes(),
    ...overrides,
  };
}

const identity = {
  runId: ids.run,
  taskId: ids.task,
  attemptId: ids.attempt,
  outboxId: ids.outbox,
  executionProfileId: ids.profile,
  reservationCostEventId: ids.reservation,
  claimTokenHash: digest,
} as const;

describe("hosted prompt authority", () => {
  it("binds the exact current plan, published style, single claim, and 4-cent reservation", () => {
    const authority = hostedPromptAuthority({
      plan: plan(),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    expect(authority.scenes).toHaveLength(25);
    expect(authority.taskState).toBe("RUNNING");
    expect(authority.outboxState).toBe("ACKNOWLEDGED");
    expect(authority.reservedCostMicroUsd).toBe(40_000);
    expect(authority.recordedInputHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects an already-claimed plan or insufficient project cap", () => {
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ existing_run_state: "UNKNOWN" }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("not executable");
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ spend_cap_usd: 0.01 }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("not executable");
  });
});

describe("hosted Runware prompt writer", () => {
  it("captures exact provider request/response bytes, usage, and reported cost", async () => {
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const task = request[0]!;
      const messages = task.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[0]!.content) as {
        batch_id: string;
        scenes: Array<{ scene_id: string; exact_phrase: string; in_image_shot_role: string }>;
      };
      const output = {
        batch_id: payload.batch_id,
        scenes: payload.scenes.map((scene) => ({
          scene_id: scene.scene_id,
          literal_subject: scene.exact_phrase,
          action: "shown as physical evidence",
          environment: "a real practical environment",
          in_image_shot_role: scene.in_image_shot_role,
          lighting_context: "available daylight",
          continuity_tags: [],
          prompt_core: `${scene.exact_phrase}, shown as literal physical evidence`,
        })),
      };
      return Response.json({
        data: [
          {
            taskUUID: task.taskUUID,
            text: JSON.stringify(output),
            usage: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              cachedInputTokens: 0,
            },
            cost: 0.001,
            finishReason: "stop",
            model: "openai:gpt@5-nano",
          },
        ],
      });
    });
    const batch: PromptBatch = {
      scenePromptWriterVersion: "scene-prompt-writer-v1",
      batchId: `${ids.task}:batch:1`,
      sanitizedProjectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      plannerGuidance: "Literal editorial collage treatment.",
      storyContext: JSON.stringify({ summary: "A literal sequence of numbered scenes." }),
      continuityTags: [],
      scenes: scenes().map((scene) => ({
        sceneId: scene.scene_id,
        phrase: scene.phrase,
        sentenceContext: scene.sentence_context,
        priorContext: scene.prior_context,
        nextContext: scene.next_context,
        inImageShotRole: "OBJECT_EVIDENCE",
        layout: scene.layout as "IMAGE_FULL" | "SPLIT_RIGHT_IMAGE",
      })),
    };
    const result = await new HostedRunwarePromptWriter("configured-test-key-value", fetcher).write(
      batch,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.output.scenes).toHaveLength(25);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.reportedCostMicroUsd).toBe(1_000);
    expect(result.attempts[0]?.requestHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.attempts[0]?.responseHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    const dispatched = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Array<{
      messages: Array<{ content: string }>;
    }>;
    const dispatchedPlan = JSON.parse(dispatched[0]!.messages[0]!.content) as {
      image_style_version_id: string;
      style_profile_hash: string;
      planner_guidance: string;
      story_context: string;
      scenes: Array<{
        exact_phrase: string;
        prior_context: string | null;
        next_context: string | null;
      }>;
    };
    expect(dispatchedPlan.image_style_version_id).toBe(ids.style);
    expect(dispatchedPlan.style_profile_hash).toBe(digest);
    expect(dispatchedPlan.planner_guidance).toBe(batch.plannerGuidance);
    expect(dispatchedPlan.story_context).toBe(batch.storyContext);
    expect(dispatchedPlan.scenes[0]).toEqual(
      expect.objectContaining({
        exact_phrase: "literal scene 1",
        prior_context: null,
        next_context: "literal scene 2",
      }),
    );
  });
});
