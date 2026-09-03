import { describe, expect, it, vi } from "vitest";

import { buildPromptBatch, planPromptBatches, type PromptBatch } from "@videoforge/pipeline";

import { hostedPromptAuthority, hostedPromptBatchPlan } from "./hosted-prompt-run";
import { HostedPromptExecutionError, HostedRunwarePromptWriter } from "./runware-prompt-execution";

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

function scenes(count = 25) {
  return Array.from({ length: count }, (_, index) => ({
    scene_id: `scene_${String(index + 1).padStart(2, "0")}`,
    phrase: `literal scene ${index + 1}`,
    sentence_context: `Literal scene ${index + 1} belongs to this complete sentence.`,
    prior_context: index === 0 ? null : `literal scene ${index}`,
    next_context: index + 1 === count ? null : `literal scene ${index + 2}`,
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
    story_context: JSON.stringify({
      subject: "hydrogen peroxide household uses",
      visual_facts: ["brown hydrogen peroxide bottle", "real household surfaces"],
      continuity: ["same bottle across demonstrations"],
      resolved_references: [],
    }),
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

function successfulPromptFetcher() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    const task = request[0]!;
    const messages = task.messages as Array<{ content: string }>;
    const payload = JSON.parse(messages[0]!.content) as {
      batch_id: string;
      scenes: Array<{ scene_id: string; exact_phrase: string; in_image_shot_role: string }>;
    };
    const output = {
      batch_id: payload.batch_id,
      scenes: payload.scenes
        .map((scene) => ({
          scene_id: scene.scene_id,
          literal_subject: "an ordinary household object used in the narrated action",
          action: "shown as physical evidence",
          environment: "a real practical environment",
          in_image_shot_role: scene.in_image_shot_role,
          lighting_context: "available daylight",
          continuity_tags: [],
          prompt_core: "Natural documentary view of the narrated action as physical evidence",
        }))
        .reverse(),
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
          cost: 0.00001,
          finishReason: "stop",
          model: "deepseek:v4@flash",
        },
      ],
    });
  });
}

function adaptivePlan(batch: PromptBatch) {
  return planPromptBatches({
    batchIdPrefix: `${batch.batchId}:adaptive`,
    projectTitle: batch.sanitizedProjectTitle,
    imageStyleVersionId: batch.imageStyleVersionId,
    styleProfileHash: batch.styleProfileHash,
    plannerGuidance: batch.plannerGuidance,
    storyContext: batch.storyContext,
    continuityTags: batch.continuityTags,
    scenes: batch.scenes,
  });
}

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
    expect(authority.storyContext).toBe(
      "Subject: hydrogen peroxide household uses | Visual facts: brown hydrogen peroxide bottle; real household surfaces | Continuity: same bottle across demonstrations",
    );
    expect(authority.recordedInputHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("rejects verbose legacy context instead of forwarding chronology to every scene", () => {
    expect(() =>
      hostedPromptAuthority({
        plan: plan({
          story_context: JSON.stringify({
            summary: "Redundant summary.",
            chronology: ["first", "second", "third"],
          }),
        }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("story context is invalid");
  });

  it("omits empty optional categories from the repeated Stage 5 context", () => {
    const authority = hostedPromptAuthority({
      plan: plan({
        story_context: JSON.stringify({
          subject: "Canada thistle regrowth",
          visual_facts: [],
          continuity: [],
          resolved_references: [],
        }),
      }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    expect(authority.storyContext).toBe("Subject: Canada thistle regrowth");
  });

  it("accepts empty preserved extra keywords when their explicit apply toggle is off", () => {
    const authority = hostedPromptAuthority({
      plan: plan({ extra_prompt_keywords: "", apply_extra_prompt_keywords: false }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    expect(authority.extraPromptKeywords).toBe("");
    expect(authority.applyExtraPromptKeywords).toBe(false);
    expect(authority.recordedInputHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("accepts an arbitrary long Stage 4 scene list and derives bounded contiguous batches", () => {
    const longScenes = Array.from({ length: 140 }, (_, index) => ({
      scene_id: `long_scene_${String(index + 1).padStart(3, "0")}`,
      phrase: `literal long-form scene ${index + 1}`,
      sentence_context: `Sentence ${Math.floor(index / 4) + 1} contains scene ${index + 1}.`,
      prior_context: index === 0 ? null : `prior context ${index}`,
      next_context: index + 1 === 140 ? null : `next context ${index + 2}`,
      in_image_shot_role: "OBJECT_EVIDENCE",
      layout: index % 2 === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
    }));
    const authority = hostedPromptAuthority({
      plan: plan({
        scenes: longScenes,
        all_segments: longScenes.map((scene, index) => ({
          scene_id: scene.scene_id,
          segment_index: index,
          phrase: scene.sentence_context,
        })),
      }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const planned = hostedPromptBatchPlan(authority);
    expect(authority.scenes).toHaveLength(140);
    expect(planned.batchCount).toBeGreaterThan(1);
    expect(planned.batches.flatMap((batch) => batch.sceneIds)).toEqual(
      authority.scenes.map((scene) => scene.sceneId),
    );
    expect(planned.batches.every((batch) => batch.maxOutputTokens <= 64_000)).toBe(true);
    expect(planned.batches.every((batch) => batch.estimatedInputTokens <= 48_000)).toBe(true);
  });

  it("accepts an existing PostgreSQL UUID-shaped workspace while generated identities stay strict", () => {
    const authority = hostedPromptAuthority({
      plan: plan({ workspace_id: "78c40d01-f7af-bae1-1922-6b458da10625" }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    expect(authority.workspaceId).toBe("78c40d01-f7af-bae1-1922-6b458da10625");
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ project_id: "78c40d01-f7af-bae1-1922-6b458da10625" }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("Hosted prompt identity is invalid");
  });

  it("rejects empty extra keywords before preparation when their apply toggle is on", () => {
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ extra_prompt_keywords: "", apply_extra_prompt_keywords: true }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("enabled extra prompt keywords is invalid");
  });

  it("rejects duplicate or oversized global attributes before prompt dispatch", () => {
    for (const context of [
      {
        subject: "same subject",
        visual_facts: ["same object", "same object"],
        continuity: [],
        resolved_references: [],
      },
      {
        subject: "same subject",
        visual_facts: ["same object"],
        continuity: ["same object"],
        resolved_references: [],
      },
      {
        subject: "x".repeat(91),
        visual_facts: [],
        continuity: [],
        resolved_references: [],
      },
    ]) {
      expect(() =>
        hostedPromptAuthority({
          plan: plan({ story_context: JSON.stringify(context) }),
          identity,
          reservedCostMicroUsd: 40_000,
        }),
      ).toThrow("story context is invalid");
    }
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

  it("bounds adjacent sentence windows and reaches the fake provider transport", async () => {
    const allSegments = scenes().map((scene, index) => ({
      scene_id: scene.scene_id,
      segment_index: index,
      phrase:
        index === 0
          ? "First short sentence."
          : index === 1
            ? `${"hydrogen peroxide bottle beside a practical kitchen sink ".repeat(30)}next evidence.`
            : `Literal scene ${index + 1} is visible.`,
    }));
    const authority = hostedPromptAuthority({
      plan: plan({ all_segments: allSegments }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const batch = buildPromptBatch({
      batchId: `${authority.taskId}:batch:1`,
      projectTitle: authority.projectTitle,
      imageStyleVersionId: authority.imageStyleVersionId,
      styleProfileHash: authority.styleProfileHash,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });

    expect(batch.scenes[0]?.nextContext?.length).toBeLessThanOrEqual(1_000);
    expect(batch.scenes[1]?.sentenceContext.length).toBeLessThanOrEqual(2_000);
    expect(batch.scenes[2]?.priorContext?.length).toBeLessThanOrEqual(1_000);
    expect(batch.scenes[0]?.nextContext).toMatch(/^hydrogen peroxide bottle/u);
    expect(batch.scenes[2]?.priorContext).toMatch(/next evidence\.$/u);
    const fetcher = successfulPromptFetcher();
    const planned = adaptivePlan(batch);
    const result = await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
    ).write(batch);
    expect(fetcher).toHaveBeenCalledTimes(planned.batchCount);
    expect(result.output.scenes).toHaveLength(25);
    const dispatchedSceneIds: string[] = [];
    for (const call of fetcher.mock.calls) {
      const dispatched = JSON.parse(String(call[1]?.body)) as Array<{
        messages: Array<{ content: string }>;
        model: string;
        settings: { maxTokens: number };
      }>;
      const dispatchedPlan = JSON.parse(dispatched[0]!.messages[0]!.content) as {
        scenes: Array<{ scene_id: string }>;
      };
      expect(dispatched[0]?.model).toBe("deepseek:v4@flash");
      expect(dispatched[0]?.settings.maxTokens).toBeGreaterThanOrEqual(2_048);
      expect(dispatched[0]?.settings.maxTokens).toBeLessThanOrEqual(64_000);
      expect(dispatchedPlan.scenes.length).toBeGreaterThan(0);
      dispatchedSceneIds.push(...dispatchedPlan.scenes.map((scene) => scene.scene_id));
    }
    expect(dispatchedSceneIds).toEqual(batch.scenes.map((scene) => scene.sceneId));
  });

  it("rejects any remaining canonical prompt violation before durable preparation", () => {
    const invalidScenes = scenes().map((scene, index) =>
      index === 0 ? { ...scene, phrase: "x".repeat(1_001) } : scene,
    );
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ scenes: invalidScenes }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("Scene phrase must contain 1-1000 normalized characters");
  });
});

describe("hosted Runware prompt writer", () => {
  it("captures exact provider request/response bytes, usage, and reported cost", async () => {
    const fetcher = successfulPromptFetcher();
    const batch: PromptBatch = {
      scenePromptWriterVersion: "scene-prompt-writer-v1",
      batchId: `${ids.task}:batch:1`,
      sanitizedProjectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      plannerGuidance: "Literal editorial collage treatment.",
      storyContext:
        "Subject: hydrogen peroxide household uses | Visual facts: brown hydrogen peroxide bottle; real household surfaces | Continuity: same bottle across demonstrations",
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
    const planned = adaptivePlan(batch);
    const onBatchAccepted = vi.fn();
    const result = await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
      onBatchAccepted,
    ).write(batch);
    expect(fetcher).toHaveBeenCalledTimes(planned.batchCount);
    expect(onBatchAccepted).toHaveBeenCalledTimes(planned.batchCount);
    expect(result.output.scenes).toHaveLength(25);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.reportedCostMicroUsd).toBe(planned.batchCount * 10);
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
    expect(dispatchedPlan.scenes.length).toBeGreaterThan(0);
    expect(dispatchedPlan.scenes[0]).toEqual(
      expect.objectContaining({
        exact_phrase: "literal scene 1",
        prior_context: null,
        next_context: "literal scene 2",
      }),
    );
    expect(
      onBatchAccepted.mock.calls.flatMap(([accepted]) =>
        accepted.scenes.map((scene: { sceneOrdinal: number }) => scene.sceneOrdinal),
      ),
    ).toEqual(Array.from({ length: 25 }, (_, index) => index));
  });

  it("preserves bounded diagnostics for a definite provider rejection", async () => {
    const authority = hostedPromptAuthority({
      plan: plan(),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const batch = buildPromptBatch({
      batchId: `${authority.taskId}:batch:1`,
      projectTitle: authority.projectTitle,
      imageStyleVersionId: authority.imageStyleVersionId,
      styleProfileHash: authority.styleProfileHash,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          errors: [
            {
              code: "invalidParameter",
              parameter: "settings.maxTokens",
              message: "provider-private message must be discarded",
            },
          ],
        },
        { status: 400 },
      ),
    );

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        adaptivePlan(batch),
        fetcher,
      ).write(batch),
    ).rejects.toEqual(
      expect.objectContaining({
        name: "HostedPromptExecutionError",
        problemCode: "HOSTED_PROMPT_PROVIDER_REJECTED",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
        diagnostic: {
          stage: "http",
          httpStatus: 400,
          providerCode: "invalidParameter",
          providerParameter: "settings.maxTokens",
        },
      } satisfies Partial<HostedPromptExecutionError>),
    );
  });

  it("stops after one locally rejected scene response without retry and reports its known cost", async () => {
    const authority = hostedPromptAuthority({
      plan: plan(),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const batch = buildPromptBatch({
      batchId: `${authority.taskId}:batch:1`,
      projectTitle: authority.projectTitle,
      imageStyleVersionId: authority.imageStyleVersionId,
      styleProfileHash: authority.styleProfileHash,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const task = request[0]!;
      const messages = task.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[0]!.content) as {
        batch_id: string;
        scenes: Array<{ scene_id: string; in_image_shot_role: string }>;
      };
      return Response.json({
        data: [
          {
            taskUUID: task.taskUUID,
            text: JSON.stringify({
              batch_id: payload.batch_id,
              scenes: payload.scenes.map((scene, index) => ({
                scene_id: scene.scene_id,
                literal_subject: "generic object",
                action: index === 0 ? "show a visible logo" : "shown as physical evidence",
                environment: "generic room",
                in_image_shot_role: scene.in_image_shot_role,
                lighting_context: "daylight",
                continuity_tags: [],
                prompt_core: "Generic unrelated evidence in a room",
              })),
            }),
            usage: {
              promptTokens: 100,
              completionTokens: 100,
              totalTokens: 200,
              cachedInputTokens: 0,
            },
            cost: 0.00001,
            finishReason: "stop",
            model: "deepseek:v4@flash",
          },
        ],
      });
    });

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        adaptivePlan(batch),
        fetcher,
      ).write(batch),
    ).rejects.toEqual(
      expect.objectContaining({
        problemCode: "HOSTED_PROMPT_OUTPUT_INVALID",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
        additionalKnownCostMicroUsd: 10,
        validationDiagnostic: {
          category: "scene_quality",
          reason: "scene_quality",
          requestedSceneCount: 25,
          returnedSceneCount: 25,
          locallyValidSceneCount: 24,
          unresolvedSceneCount: 1,
        },
      } satisfies Partial<HostedPromptExecutionError>),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("persists an accepted first adaptive batch and stops once when the second output is invalid", async () => {
    const batch = buildPromptBatch({
      batchId: `${ids.task}:batch:multi`,
      projectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      plannerGuidance: "Literal editorial collage treatment.",
      storyContext: "A continuous practical household demonstration.",
      continuityTags: [],
      scenes: scenes(31).map((scene) => ({
        sceneId: scene.scene_id,
        phrase: scene.phrase,
        sentenceContext: scene.sentence_context,
        priorContext: scene.prior_context,
        nextContext: scene.next_context,
        inImageShotRole: "OBJECT_EVIDENCE",
        layout: scene.layout as "IMAGE_FULL" | "SPLIT_RIGHT_IMAGE",
      })),
    });
    const planned = adaptivePlan(batch);
    expect(planned.batchCount).toBe(2);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const task = request[0]!;
      const messages = task.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[0]!.content) as {
        batch_id: string;
        scenes: Array<{ scene_id: string; in_image_shot_role: string }>;
      };
      const secondBatch = fetcher.mock.calls.length === 2;
      return Response.json({
        data: [
          {
            taskUUID: task.taskUUID,
            text: JSON.stringify({
              batch_id: payload.batch_id,
              scenes: payload.scenes.map((scene, index) => ({
                scene_id: scene.scene_id,
                literal_subject: "a practical household object",
                action:
                  secondBatch && index === 0
                    ? "show a visible logo"
                    : "used in an ordinary physical demonstration",
                environment: "a lived-in household workspace",
                in_image_shot_role: scene.in_image_shot_role,
                lighting_context: "available window light",
                continuity_tags: [],
                prompt_core: "Natural documentary view of the practical narrated action",
              })),
            }),
            usage: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              cachedInputTokens: 0,
            },
            cost: 0.00001,
            finishReason: "stop",
            model: "deepseek:v4@flash",
          },
        ],
      });
    });
    const onBatchAccepted = vi.fn();

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        onBatchAccepted,
      ).write(batch),
    ).rejects.toEqual(
      expect.objectContaining({
        problemCode: "HOSTED_PROMPT_OUTPUT_INVALID",
        additionalKnownCostMicroUsd: 10,
      } satisfies Partial<HostedPromptExecutionError>),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onBatchAccepted).toHaveBeenCalledTimes(1);
    expect(onBatchAccepted.mock.calls[0]?.[0].reportedCostMicroUsd).toBe(10);
    expect(onBatchAccepted.mock.calls[0]?.[0].scenes).toHaveLength(
      planned.batches[0]!.sceneIds.length,
    );
  });

  it("keeps network ambiguity fail-closed without redispatching", async () => {
    const authority = hostedPromptAuthority({
      plan: plan(),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const batch = buildPromptBatch({
      batchId: `${authority.taskId}:batch:1`,
      projectTitle: authority.projectTitle,
      imageStyleVersionId: authority.imageStyleVersionId,
      styleProfileHash: authority.styleProfileHash,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });
    const fetcher = vi.fn(async () => {
      throw new Error("opaque network failure");
    });

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        adaptivePlan(batch),
        fetcher,
      ).write(batch),
    ).rejects.toEqual(
      expect.objectContaining({
        problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
        terminalState: "UNKNOWN",
        providerMayHaveCharged: true,
        diagnostic: {
          stage: "network",
          httpStatus: null,
          providerCode: null,
          providerParameter: null,
        },
      } satisfies Partial<HostedPromptExecutionError>),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
