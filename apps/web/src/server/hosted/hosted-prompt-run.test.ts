import { readFileSync } from "node:fs";
import { promptExecutionInputHash } from "@videoforge/control-plane/prompts";
import { NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH } from "@videoforge/pipeline";
import { promptStyleTreatmentPositiveSuffix } from "@videoforge/pipeline/prompts";
import * as promptRuntime from "@videoforge/pipeline/prompts";
import { buildKieScenePrompt } from "../providers/kie-image-prompt";
import { describe, expect, it, vi } from "vitest";

import {
  buildPromptBatch,
  derivePromptStyleTreatment,
  planPromptBatches,
  SCENE_PROMPT_WRITER_VERSION,
  type PromptBatch,
} from "@videoforge/pipeline";

import {
  hostedPromptAuthority,
  HOSTED_LUNA_PROMPT_BATCH_MAX_OUTPUT_TOKENS,
  compileAndPersistHostedPromptBatch,
  hostedPromptBatchPlan,
  recoverHostedPromptBatchPlan,
  hostedPromptBatchPlanDocument,
  runHostedPromptExecution,
} from "./hosted-prompt-run";
import {
  hostedPromptBatchPlanHash,
  hostedPromptReservationMicroUsd,
  HostedPromptExecutionError,
  HostedPromptArchivedOutputUnavailableError,
  HostedPromptCapacityPausedError,
  HostedRunwarePromptWriter,
  recoverClaimedHostedPromptBatch,
  dispatchOneHostedPromptBatch,
  type HostedAcceptedPromptBatch,
  type HostedRecoveredPromptBatch,
} from "./runware-prompt-execution";

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

it("sizes new prompt reservations and preserves an existing run's cap", () => {
  expect(hostedPromptReservationMicroUsd(2, null)).toBe(500_000);
  expect(hostedPromptReservationMicroUsd(32, null)).toBe(8_000_000);
  expect(hostedPromptReservationMicroUsd(40, null)).toBe(8_000_000);
  expect(hostedPromptReservationMicroUsd(32, 2_000_000)).toBe(2_000_000);
  expect(() => hostedPromptReservationMicroUsd(0, null)).toThrow(RangeError);
  expect(() => hostedPromptReservationMicroUsd(32, 8_000_001)).toThrow(RangeError);
});

const visualProfile = {
  medium_family: "documentary photography",
  realism: "physically believable still image",
  subject_treatment: "natural subject treatment with ordinary scale and materials",
  camera_language: "restrained observational camera language",
  image_framing: "crop-safe contextual framing",
  shot_scale_preferences: ["environmental wide", "hands and action"],
  lighting: "available practical light with natural shadow detail",
  color: { descriptors: ["true-to-life", "restrained saturation"], approximate_hex: [] },
  contrast_and_exposure: "soft natural contrast with recoverable highlights",
  depth_of_field: "natural lens depth with enough environmental context",
  texture_and_grain: "tactile material detail with restrained grain",
  human_rendering: "believable anatomy and natural everyday imperfection",
  environment_and_material_detail: "credible real-world surfaces and material response",
  imperfection_profile: ["uneven exposure", "ordinary wear"],
  mood: ["observational", "grounded"],
  continuity_rules: ["preserve subject continuity"],
  must_include: ["physically visible evidence"],
  must_avoid: ["visible writing"],
  flexible_properties: ["weather and background detail"],
} as const;

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
      visual_profile: visualProfile,
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
      phrase: scene.phrase,
    })),
    extra_prompt_keywords: null,
    apply_extra_prompt_keywords: false,
    spend_cap_usd: null,
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

type PromptFixtureScene = {
  scene_id: string;
  exact_phrase: string;
  scene_phrase_context: string;
  prior_scene_phrase: string | null;
  next_scene_phrase: string | null;
  in_image_shot_role: string;
};

type PromptFixtureSceneOutput = {
  scene_id: string;
  literal_subject: string;
  action: string;
  environment: string;
  in_image_shot_role: string;
  lighting_context: string;
  continuity_tags: string[];
  prompt_core: string;
};

/**
 * Keep fake provider rows grounded in the same v12 source anchors that the
 * real writer receives. These fixtures intentionally use the synthetic
 * narration in `scenes()`, while the tests below mutate only the behavior
 * they are meant to exercise (forbidden content, second-batch invalidity, or
 * a cross-batch duplicate core).
 */
function groundedPromptFixtureScene(
  scene: PromptFixtureScene,
  overrides: Partial<PromptFixtureSceneOutput> = {},
  storyContext = "",
): PromptFixtureSceneOutput {
  const bounded = (value: string, maximum: number): string => {
    const normalized = value.trim();
    if (normalized.length <= maximum) return normalized;
    return normalized.slice(0, maximum).replace(/\s+\S*$/u, "");
  };
  const exactPhrase = scene.exact_phrase.trim();
  const sentenceContext = bounded(scene.scene_phrase_context, 120);
  const sourceContext = [
    sentenceContext,
    scene.prior_scene_phrase?.trim().slice(-80),
    scene.next_scene_phrase?.trim().slice(0, 80),
    bounded(storyContext, 120),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
  const boundedSourceContext = bounded(sourceContext, 180);
  const groundedStoryContext = bounded(storyContext, 180);
  const groundedFacts = `${boundedSourceContext} ${exactPhrase}`.trim();
  return {
    scene_id: scene.scene_id,
    literal_subject: `${exactPhrase} household ${sentenceContext}`,
    action: groundedStoryContext,
    environment: groundedStoryContext,
    in_image_shot_role: scene.in_image_shot_role,
    lighting_context: "available daylight",
    continuity_tags: [],
    prompt_core: `${groundedFacts} ${groundedFacts}`,
    ...overrides,
  };
}

function successfulPromptFetcher() {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
    const task = request[0]!;
    const messages = task.messages as Array<{ content: string }>;
    const payload = JSON.parse(messages[0]!.content) as {
      batch_id: string;
      story_context: string;
      scenes: PromptFixtureScene[];
    };
    const output = {
      batch_id: payload.batch_id,
      scenes: payload.scenes
        .map((scene) => groundedPromptFixtureScene(scene, {}, payload.story_context))
        .reverse(),
    };
    return Response.json({
      data: [
        {
          taskType: "textInference",
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
          model: task.model,
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
    styleTreatment: batch.styleTreatment,
    plannerGuidance: batch.plannerGuidance,
    storyContext: batch.storyContext,
    continuityTags: batch.continuityTags,
    scenes: batch.scenes,
  });
}

describe("versioned prompt request recovery", () => {
  function authorityFor(natural: boolean) {
    const base = hostedPromptAuthority({
      plan: plan({ scenes: scenes(20) }),
      identity,
      reservedCostMicroUsd: 2_000_000,
    });
    if (!natural) return base;
    const profile = JSON.parse(
      readFileSync(
        "../../project-context/evidence/natural_documentary_image_style_v1.json",
        "utf8",
      ),
    );
    const treatment = derivePromptStyleTreatment(
      profile.visual_profile,
      NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    );
    return {
      ...base,
      styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      styleTreatment: treatment,
      style: {
        positiveSuffix: promptStyleTreatmentPositiveSuffix(treatment),
        negativeSuffix: profile.prompt_profile.negative_suffix,
        fullImageGuidance: profile.prompt_profile.full_image_guidance,
        splitImageGuidance: profile.prompt_profile.split_image_guidance,
      },
    };
  }

  it("recovers legacy when newer instruction cannot fit and stops at its exact match", async () => {
    const base = authorityFor(false);
    const authority = { ...base, scenes: [base.scenes[0]!] };
    const legacy = hostedPromptBatchPlan(authority, "legacy");
    const binding = {
      plannedBatchCount: legacy.batchCount,
      plannedSceneCount: legacy.totalScenes,
      batchPlanHash: await hostedPromptBatchPlanHash(legacy),
    };
    const original = promptRuntime.planPromptBatches;
    const seen: unknown[] = [];
    const planner = vi.spyOn(promptRuntime, "planPromptBatches").mockImplementation((input) => {
      seen.push(input.options?.requestPolicy);
      return original(
        input.options?.requestPolicy === "physical-placement-v2"
          ? {
              ...input,
              options: {
                ...input.options,
                maxInputTokens: legacy.batches[0]!.estimatedInputTokens,
              },
            }
          : input,
      );
    });
    try {
      // Exercises an actual planner budget rejection, not an invented provider error.
      expect(await recoverHostedPromptBatchPlan(authority, binding)).toEqual(legacy);
      expect(seen).toEqual([
        "runware-luna-grounded-v2",
        "runware-luna-grounded-v1",
        "grounded-scenes-v1",
        "validated-scenes-v1",
        "no-graphics-async-v1",
        "no-graphics-v2",
        "no-graphics-v1",
        "physical-placement-v2",
        "legacy",
      ]);
      seen.length = 0;
      authorityFor(false);
      expect(seen).toEqual(["legacy"]);
      const defect = new Error("unexpected planner defect");
      planner.mockImplementation(() => {
        throw defect;
      });
      await expect(recoverHostedPromptBatchPlan(authority, binding)).rejects.toBe(defect);
    } finally {
      planner.mockRestore();
    }
  });

  it("selects Luna for fresh plans with the preserved ten-scene and output ceilings", () => {
    const planned = hostedPromptBatchPlan(authorityFor(true));
    expect(planned.requestPolicy).toBe("runware-luna-grounded-v2");
    expect(planned.batches.every((batch) => batch.batch.scenes.length <= 10)).toBe(true);
    expect(
      planned.batches.every(
        (batch) => batch.maxOutputTokens <= HOSTED_LUNA_PROMPT_BATCH_MAX_OUTPUT_TOKENS,
      ),
    ).toBe(true);
  });

  it("dispatches, repairs, recovers, compiles and hands off a full 152-scene Luna stage without replay", async () => {
    const roles = [
      "ENVIRONMENTAL_WIDE",
      "HUMAN_MEDIUM",
      "HANDS_ACTION",
      "OBJECT_EVIDENCE",
      "MACRO_DETAIL",
      "REACTION_RESULT",
    ] as const;
    const stageScenes = Array.from({ length: 152 }, (_, index) => {
      const role = roles[index % roles.length]!;
      const human = role === "HUMAN_MEDIUM" || role === "REACTION_RESULT";
      const handAction = role === "HANDS_ACTION";
      const phrase =
        human || handAction
          ? "A cook places a glass jar on the kitchen table."
          : "A glass jar rests on the kitchen table.";
      return {
        scene_id: `scene_${String(index + 1).padStart(3, "0")}`,
        phrase,
        sentence_context: phrase,
        prior_context: index === 0 ? null : phrase,
        next_context: index === 151 ? null : phrase,
        in_image_shot_role: role,
        layout: index % 2 === 0 ? "IMAGE_FULL" : "SPLIT_RIGHT_IMAGE",
      };
    });
    const authority = hostedPromptAuthority({
      plan: plan({
        project_title: "Kitchen jars",
        story_context: JSON.stringify({
          subject: "A cook and a glass jar in a home kitchen",
          visual_facts: ["glass jar", "wooden kitchen table", "ordinary home kitchen"],
          continuity: ["same glass jar"],
          resolved_references: [],
        }),
        scenes: stageScenes,
        all_segments: stageScenes.map((scene, segment_index) => ({
          scene_id: scene.scene_id,
          segment_index,
          phrase: scene.phrase,
        })),
      }),
      identity,
      reservedCostMicroUsd: 8_000_000,
    });
    const batchPlan = hostedPromptBatchPlan(authority);
    const binding = {
      plannedBatchCount: batchPlan.batchCount,
      plannedSceneCount: batchPlan.totalScenes,
      batchPlanHash: await hostedPromptBatchPlanHash(batchPlan),
    };
    expect(batchPlan.requestPolicy).toBe("runware-luna-grounded-v2");
    expect(batchPlan.batches).toHaveLength(16);
    expect(
      new Set(
        batchPlan.batches.flatMap((batch) =>
          batch.batch.scenes.map((scene) => scene.inImageShotRole),
        ),
      ).size,
    ).toBe(6);
    expect(
      new Set(batchPlan.batches.flatMap((batch) => batch.batch.scenes.map((scene) => scene.layout)))
        .size,
    ).toBe(2);
    const cappedScene = batchPlan.batches
      .flatMap((entry) =>
        entry.batch.scenes.map((scene) => ({
          entry,
          scene,
          limit: entry.batch.literalCharacterLimits?.[scene.sceneId],
        })),
      )
      .find(
        (candidate) =>
          candidate.limit !== undefined &&
          candidate.limit >= 174 &&
          candidate.scene.inImageShotRole === "OBJECT_EVIDENCE",
      )!;
    const legacyPlan = hostedPromptBatchPlan(authority, "runware-luna-grounded-v1");
    const legacyEntry = legacyPlan.batches.find((entry) =>
      entry.sceneIds.includes(cappedScene.scene.sceneId),
    )!;
    const literals = {
      literal_subject: "A clear glass jar on a kitchen table.",
      action: "The jar rests on the wooden table.",
      environment:
        "A home kitchen surrounds the wooden table, with a large window, a counter, and daylight on the surface.",
    };
    expect(
      literals.literal_subject.length + literals.action.length + literals.environment.length,
    ).toBe(174);
    expect(cappedScene.limit).toBeGreaterThanOrEqual(174);
    // v38's sealed shared cap for this failing case was 168 characters.
    const sealedV38Batch = { ...legacyEntry.batch, literalCharacterLimit: 168 };
    const cappedWriterOutput = {
      scene_id: cappedScene.scene.sceneId,
      ...literals,
      in_image_shot_role: cappedScene.scene.inImageShotRole,
      lighting_context: "available daylight",
      continuity_tags: [],
      prompt_core: "A clear glass jar rests on a kitchen table inside an ordinary home kitchen.",
    };
    const legacyRows = legacyEntry.batch.scenes.map((scene) =>
      scene.sceneId === cappedScene.scene.sceneId
        ? cappedWriterOutput
        : {
            scene_id: scene.sceneId,
            literal_subject: "A glass jar on the kitchen table.",
            action: scene.phrase,
            environment: "Ordinary home kitchen around the wooden table.",
            in_image_shot_role: scene.inImageShotRole,
            lighting_context: "available daylight",
            continuity_tags: [],
            prompt_core: "A glass jar is in an ordinary home kitchen.",
          },
    );
    const legacyRepair = promptRuntime.buildRunwarePromptCorrection(
      sealedV38Batch,
      JSON.stringify({ batch_id: sealedV38Batch.batchId, scenes: legacyRows }),
      "runware-luna-grounded-v1",
    );
    expect(legacyRepair?.failedSceneIds).toContain(cappedScene.scene.sceneId);
    expect(
      legacyRepair?.failures.some((failure) => failure.reason === "literal_character_limit"),
    ).toBe(true);
    const compiled174 = promptRuntime.compileImagePrompt({
      compilerPolicy: "local-evidence-v1",
      expectedScene: cappedScene.scene,
      writerOutput: cappedWriterOutput,
      style: authority.style,
      styleProfileHash: authority.styleProfileHash,
      extraPromptKeywords: authority.extraPromptKeywords,
      applyExtraPromptKeywords: authority.applyExtraPromptKeywords,
    });
    expect(
      buildKieScenePrompt(compiled174, {
        handAnatomy: cappedScene.scene.inImageShotRole === "HANDS_ACTION",
      }).length,
    ).toBeLessThanOrEqual(800);

    const claims: Array<{ taskUUID: string; requestBytes: string; requestHash: string }> = [];
    const receipts = new Map<
      string,
      Extract<
        import("@videoforge/pipeline/prompts").RunwarePromptTransportResult,
        { status: "succeeded" }
      >
    >();
    const sourceOutputByScene = new Map<string, PromptFixtureSceneOutput>();
    let providerCalls = 0;
    const fetcher: typeof fetch = async (_url, init) => {
      providerCalls += 1;
      const request = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: string }>;
      };
      const payload = JSON.parse(
        request.messages.find((message) => message.role === "user")!.content,
      ) as {
        batch_id: string;
        scenes: PromptFixtureScene[];
        correction?: { failed_scene_ids: string[] };
      };
      const correctionIds = payload.correction?.failed_scene_ids;
      const selected = correctionIds
        ? payload.scenes.filter((scene) => correctionIds.includes(scene.scene_id))
        : payload.scenes;
      const rows = selected.map((scene) => {
        const row = (() => {
          if (
            scene.in_image_shot_role === "HUMAN_MEDIUM" ||
            scene.in_image_shot_role === "REACTION_RESULT"
          )
            return {
              scene_id: scene.scene_id,
              literal_subject: "A cook's visible torso and connected arm beside a glass jar.",
              action: "Places the glass jar on the table.",
              environment: "Beside the jar, seen from the side.",
              in_image_shot_role: scene.in_image_shot_role,
              lighting_context: "Available daylight.",
              continuity_tags: [],
              prompt_core: "A cook places a glass jar on the kitchen table.",
            };
          if (scene.in_image_shot_role === "HANDS_ACTION")
            return {
              scene_id: scene.scene_id,
              literal_subject: "A cook's hand grips a glass jar.",
              action: "Places the jar on the table.",
              environment: "On a wooden kitchen table.",
              in_image_shot_role: scene.in_image_shot_role,
              lighting_context: "Available daylight.",
              continuity_tags: [],
              prompt_core: "A cook places a glass jar on the kitchen table.",
            };
          return {
            scene_id: scene.scene_id,
            literal_subject: "A glass jar on a kitchen table.",
            action: "Rests upright on the table.",
            environment: "An ordinary home kitchen.",
            in_image_shot_role: scene.in_image_shot_role,
            lighting_context: "Available daylight.",
            continuity_tags: [],
            prompt_core: "A glass jar rests on the kitchen table.",
          };
        })();
        if (
          providerCalls === 1 &&
          !correctionIds &&
          scene.scene_id === batchPlan.batches[0]!.batch.scenes[0]!.sceneId
        )
          row.literal_subject = "A glass jar with a printed logo.";
        if (!correctionIds && providerCalls === 1) sourceOutputByScene.set(scene.scene_id, row);
        return row;
      });
      const outputText = JSON.stringify({ batch_id: payload.batch_id, scenes: rows });
      return Response.json({
        id: `chatcmpl-fullstage_${providerCalls}`,
        model: request.model,
        choices: [
          { index: 0, message: { role: "assistant", content: outputText }, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: 400,
          completion_tokens: 180,
          total_tokens: 580,
          prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
          completion_tokens_details: { reasoning_tokens: 20 },
        },
      });
    };

    const acceptedBatches: HostedRecoveredPromptBatch[] = [];
    const compiledByScene = new Map<
      string,
      import("@videoforge/pipeline/prompts").CompiledImagePrompt
    >();
    const noHttp = vi.fn(async () => {
      throw new Error("Saved Luna responses must recover without HTTP.");
    }) as unknown as typeof fetch;
    for (const [batchOrdinal, entry] of batchPlan.batches.entries()) {
      const claim = async (value: {
        taskUUID: string;
        requestBytes: string;
        requestHash: string;
      }) => {
        claims.push(value);
        return true;
      };
      const recordResult = async (value: {
        requestHash: string;
        result: Extract<
          import("@videoforge/pipeline/prompts").RunwarePromptTransportResult,
          { status: "succeeded" }
        >;
      }) => {
        receipts.set(value.requestHash, value.result);
      };
      let accepted: HostedAcceptedPromptBatch | null = null;
      let retryOfRequestHash: string | null = null;
      let sourceRecordedResult: Extract<
        import("@videoforge/pipeline/prompts").RunwarePromptTransportResult,
        { status: "succeeded" }
      > | null = null;
      if (batchOrdinal === 0) {
        try {
          accepted = await dispatchOneHostedPromptBatch({
            apiKey: "configured-test-key-value",
            plan: batchPlan,
            persistedBinding: binding,
            batchOrdinal,
            remainingReservationMicroUsd: 8_000_000,
            claim,
            recordResult,
            fetcher,
          });
          expect.fail("The deliberately marked product should be rejected locally.");
        } catch (error) {
          expect(promptRuntime.runwarePromptValidationDiagnostic(error)).not.toBeNull();
          if (claims.length === 0) throw error;
          sourceRecordedResult = receipts.get(claims[0]!.requestHash)!;
          expect(sourceRecordedResult).toBeDefined();
          const correction = promptRuntime.buildRunwarePromptCorrection(
            entry.batch,
            sourceRecordedResult!.outputText,
            batchPlan.requestPolicy,
          );
          expect(correction?.failedSceneIds).toEqual([entry.batch.scenes[0]!.sceneId]);
          retryOfRequestHash = claims[0]!.requestHash;
          accepted = await dispatchOneHostedPromptBatch({
            apiKey: "configured-test-key-value",
            plan: batchPlan,
            persistedBinding: binding,
            batchOrdinal,
            remainingReservationMicroUsd: 8_000_000,
            retryOfRequestHash: retryOfRequestHash as `sha256:${string}`,
            correction: correction!,
            claim,
            recordResult,
            fetcher,
          });
        }
      } else {
        accepted = await dispatchOneHostedPromptBatch({
          apiKey: "configured-test-key-value",
          plan: batchPlan,
          persistedBinding: binding,
          batchOrdinal,
          remainingReservationMicroUsd: 8_000_000,
          claim,
          recordResult,
          fetcher,
        });
      }
      expect(accepted).not.toBeNull();
      if (batchOrdinal === 0) {
        expect(accepted!.scenes[1]!.writerOutput).toEqual(
          sourceOutputByScene.get(accepted!.scenes[1]!.scene.sceneId),
        );
      }
      const savedClaim = claims.at(-1)!;
      const savedResult = receipts.get(savedClaim.requestHash)!;
      const recovered = await recoverClaimedHostedPromptBatch({
        apiKey: "configured-test-key-value",
        plan: batchPlan,
        persistedBinding: binding,
        batchOrdinal,
        taskUUID: savedClaim.taskUUID,
        requestBytes: savedClaim.requestBytes,
        requestHash: savedClaim.requestHash as `sha256:${string}`,
        reservationMicroUsd: 8_000_000,
        retryOfRequestHash: retryOfRequestHash as `sha256:${string}` | null,
        sourceRecordedResult,
        recordedResult: savedResult,
        fetcher: noHttp,
      });
      expect(recovered.scenes.map((scene) => scene.scene.sceneId)).toEqual(entry.sceneIds);
      const persisted: Parameters<
        NonNullable<Parameters<typeof runHostedPromptExecution>[0]["persistBatch"]>
      >[0][] = [];
      await compileAndPersistHostedPromptBatch(
        { ...authority, compilerPolicy: "local-evidence-v1" },
        recovered,
        async (batch) => {
          persisted.push(batch);
        },
      );
      for (const scene of persisted[0]!.scenes) {
        expect(
          buildKieScenePrompt(scene.compiledPrompt, { handAnatomy: true }).length,
        ).toBeLessThanOrEqual(800);
        compiledByScene.set(scene.sceneId, scene.compiledPrompt);
      }
      acceptedBatches.push({
        ...recovered,
        retryOfRequestHash: retryOfRequestHash as `sha256:${string}` | null,
        scenes: recovered.scenes.map(({ sceneOrdinal, scene, writerOutput }) => ({
          sceneOrdinal,
          sceneId: scene.sceneId,
          writerOutput,
        })),
      });
    }
    expect(providerCalls).toBe(17);
    expect(receipts.size).toBe(17);
    expect(compiledByScene.size).toBe(152);
    for (const [index, saved] of acceptedBatches.entries()) {
      const entry = batchPlan.batches[index]!;
      expect(saved.batchOrdinal, `batch ${index} ordinal`).toBe(index);
      expect(saved.firstSceneOrdinal, `batch ${index} first scene`).toBe(entry.sceneStartIndex);
      expect(
        saved.scenes.map((scene) => scene.sceneId),
        `batch ${index} IDs`,
      ).toEqual(entry.sceneIds);
      expect(
        saved.scenes.map((scene) => scene.sceneOrdinal),
        `batch ${index} ordinals`,
      ).toEqual(entry.batch.scenes.map((_, sceneIndex) => entry.sceneStartIndex + sceneIndex));
      expect(Number.isSafeInteger(saved.reportedCostMicroUsd), `batch ${index} cost`).toBe(true);
      expect(Number.isSafeInteger(saved.inputTokens), `batch ${index} input`).toBe(true);
      expect(Number.isSafeInteger(saved.outputTokens), `batch ${index} output`).toBe(true);
      const body = JSON.parse(saved.requestBytes) as Array<{
        messages: Array<{ role: string; content: string }>;
      }>;
      const payload = JSON.parse(
        body[0]!.messages.find((message) => message.role === "user")!.content,
      ) as {
        correction?: { source_output_text?: string };
      };
      const correction = payload.correction
        ? promptRuntime.buildRunwarePromptCorrection(
            entry.batch,
            payload.correction.source_output_text!,
            batchPlan.requestPolicy,
          )!
        : undefined;
      const expectedRequest = promptRuntime.buildRunwarePromptRequest(
        entry.batch,
        entry.batch.scenes,
        saved.retryOfRequestHash ? 2 : 1,
        saved.retryOfRequestHash ?? null,
        1,
        batchPlan.requestPolicy,
        false,
        correction,
      );
      expect(saved.requestBytes).toBe(expectedRequest.requestBytes);
      expect(saved.requestHash).toBe(expectedRequest.requestSha256);
    }
    const noSubmit = vi.fn(async () => {
      throw new Error("Every provider response is already durably recoverable.");
    });
    const handedOff = await runHostedPromptExecution({
      scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
      authority: { ...authority, compilerPolicy: "local-evidence-v1" },
      batchPlan,
      persistedBatchPlanBinding: binding,
      command: {
        projectId: authority.projectId,
        revisionId: authority.revisionId,
        timelineId: authority.timelineId,
        taskId: authority.taskId,
        attemptId: authority.attemptId,
        outboxId: authority.outboxId,
        presentedClaimTokenHash: authority.claimTokenHash,
      },
      apiKey: "configured-test-key-value",
      persist: async () => undefined,
      fetcher: noHttp,
      acceptedCompiledPrompts: compiledByScene,
      continuation: {
        reservationMicroUsd: 8_000_000,
        acceptedBatches,
        beforeBatchSubmit: noSubmit,
      },
    });
    expect(handedOff.compiledPrompts).toHaveLength(152);
    expect([...compiledByScene.values()].every((prompt) => prompt.positivePrompt.length > 0)).toBe(
      true,
    );
    expect(noSubmit).not.toHaveBeenCalled();
  }, 30_000);

  it("budgets Luna literals against the real Kie builder for custom styles and HANDS_ACTION", () => {
    const base = authorityFor(false);
    const custom = {
      ...base,
      style: { ...base.style, positiveSuffix: "soft tactile film grain ".repeat(16) },
      scenes: base.scenes.map((scene) => ({ ...scene, inImageShotRole: "HANDS_ACTION" as const })),
    };
    const legacy = hostedPromptBatchPlan(custom, "grounded-scenes-v1");
    expect(legacy.batches[0]?.batch.literalCharacterLimit).toBeUndefined();
    const legacyScene = legacy.batches[0]!.batch.scenes[0]!;
    const overflowing = promptRuntime.compileImagePrompt({
      compilerPolicy: custom.compilerPolicy,
      expectedScene: legacyScene,
      writerOutput: {
        scene_id: legacyScene.sceneId,
        literal_subject: "x".repeat(240),
        action: "y".repeat(240),
        environment: "z".repeat(240),
        in_image_shot_role: legacyScene.inImageShotRole,
        lighting_context: "available daylight",
        continuity_tags: [],
        prompt_core: "A supported physical scene.",
      },
      style: custom.style,
      styleProfileHash: custom.styleProfileHash,
      extraPromptKeywords: custom.extraPromptKeywords,
      applyExtraPromptKeywords: custom.applyExtraPromptKeywords,
    });
    expect(() => buildKieScenePrompt(overflowing, { handAnatomy: true })).toThrow("INPUT_INVALID");

    const luna = hostedPromptBatchPlan(custom);
    expect(luna.batches[0]?.batch.literalCharacterLimit).toBeUndefined();
    const scene = luna.batches[0]!.batch.scenes[0]!;
    const budget = luna.batches[0]?.batch.literalCharacterLimits?.[scene.sceneId];
    expect(budget).toBeGreaterThanOrEqual(90);
    const subjectLength = Math.min(240, Math.max(1, Math.floor(budget! / 3)));
    const literalSubject = "s".repeat(subjectLength);
    const remaining = budget! - literalSubject.length;
    const action = "a".repeat(Math.min(240, Math.max(1, Math.floor(remaining / 2))));
    const environment = "e".repeat(Math.min(240, remaining - action.length));
    const compiled = promptRuntime.compileImagePrompt({
      compilerPolicy: custom.compilerPolicy,
      expectedScene: scene,
      writerOutput: {
        scene_id: scene.sceneId,
        literal_subject: literalSubject,
        action,
        environment,
        in_image_shot_role: scene.inImageShotRole,
        lighting_context: "available daylight",
        continuity_tags: [],
        prompt_core: "A supported physical scene.",
      },
      style: custom.style,
      styleProfileHash: custom.styleProfileHash,
      extraPromptKeywords: custom.extraPromptKeywords,
      applyExtraPromptKeywords: custom.applyExtraPromptKeywords,
    });
    expect(buildKieScenePrompt(compiled, { handAnatomy: true }).length).toBeLessThanOrEqual(800);
  });

  it.each([false, true])("pins legacy plan hash for natural=%s", async (natural) => {
    const legacy = hostedPromptBatchPlan(authorityFor(natural), "legacy");
    expect(hostedPromptBatchPlanDocument(legacy)).not.toHaveProperty("request_policy");
    expect(await hostedPromptBatchPlanHash(legacy)).toBe(
      natural
        ? "sha256:59e6f6f57323819b4ff45c01f0918dcd73877afe4f3171a4db7ebe5f31302f83"
        : "sha256:09dc0a31c0f2d4f33617175545a4d718378a0cdb548d0328c7b0c2870bb1cc18",
    );
  });

  it.each(["physical-placement-v2", "no-graphics-v1", "no-graphics-v2"] as const)(
    "recovers exact v2 repair for sealed %s without inference",
    async (policy) => {
      const plan = hostedPromptBatchPlan(authorityFor(true), policy);
      const binding = {
        plannedBatchCount: plan.batchCount,
        plannedSceneCount: plan.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(plan),
      };
      const original = promptRuntime.buildRunwarePromptRequest(
        plan.batches[0]!.batch,
        plan.batches[0]!.batch.scenes,
        1,
        null,
        1,
        policy,
      );
      const results: Parameters<
        NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
      >[0][] = [];
      const fetcher = successfulPromptFetcher();
      const saved = await dispatchOneHostedPromptBatch({
        contentRepair: "no-text-v2",
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan,
        persistedBinding: binding,
        batchOrdinal: 0,
        remainingReservationMicroUsd: 250_000,
        retryOfRequestHash: original.requestSha256,
        claim: async () => true,
        recordResult: async (result) => {
          results.push(result);
        },
        fetcher,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      fetcher.mockClear();
      const task = JSON.parse(saved!.requestBytes)[0];
      const restored = await recoverClaimedHostedPromptBatch({
        apiKey: "unused",
        plan,
        persistedBinding: binding,
        batchOrdinal: 0,
        taskUUID: task.taskUUID,
        requestBytes: saved!.requestBytes,
        requestHash: saved!.requestHash,
        reservationMicroUsd: 250_000,
        retryOfRequestHash: original.requestSha256,
        recordedResult: results[0]!.result,
        fetcher,
      });
      expect(restored.scenes).toEqual(saved!.scenes);
      expect(fetcher).not.toHaveBeenCalled();
      await expect(
        recoverClaimedHostedPromptBatch({
          apiKey: "unused",
          plan,
          persistedBinding: binding,
          batchOrdinal: 0,
          taskUUID: task.taskUUID,
          requestBytes: saved!.requestBytes.replace("NO TEXT-BEARING ACTIONS:", "UNTRUSTED:"),
          requestHash: saved!.requestHash,
          reservationMicroUsd: 250_000,
          retryOfRequestHash: original.requestSha256,
          recordedResult: results[0]!.result,
          fetcher,
        }),
      ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("separates a completed billed redacted archive from invalid generated output", async () => {
    const plan = hostedPromptBatchPlan(authorityFor(true), "no-graphics-v2");
    const original = promptRuntime.buildRunwarePromptRequest(
      plan.batches[0]!.batch,
      plan.batches[0]!.batch.scenes,
      1,
      null,
      1,
      "no-graphics-v2",
    );
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual([
        { taskType: "getTaskDetails", taskUUID: original.request.taskUUID },
      ]);
      return Response.json({
        data: [
          {
            taskType: "getTaskDetails",
            taskUUID: original.request.taskUUID,
            request: JSON.parse(original.requestBytes),
            response: {
              data: [
                {
                  taskType: "textInference",
                  taskUUID: original.request.taskUUID,
                  model: original.request.model,
                  text: "```json\n{\n...[REDACTED 6476 bytes]...\n}\n```",
                  finishReason: "stop",
                  cost: 0.07613,
                  usage: {
                    promptTokens: 4745,
                    completionTokens: 7668,
                    totalTokens: 12413,
                    cachedInputTokens: 0,
                  },
                },
              ],
            },
          },
        ],
      });
    });
    const recovery = recoverClaimedHostedPromptBatch({
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan,
      persistedBinding: {
        plannedBatchCount: plan.batchCount,
        plannedSceneCount: plan.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(plan),
      },
      batchOrdinal: 0,
      taskUUID: original.request.taskUUID,
      requestBytes: original.requestBytes,
      requestHash: original.requestSha256,
      reservationMicroUsd: 4_000_000,
      fetcher,
    });
    await expect(recovery).rejects.toBeInstanceOf(HostedPromptArchivedOutputUnavailableError);
    await expect(recovery).rejects.toMatchObject({
      knownCostMicroUsd: 76_130,
      responseHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      message: "HOSTED_PROMPT_ARCHIVE_UNAVAILABLE",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("passes an exact HTTP400 credit reservation refusal to the recoverable capacity route boundary", async () => {
    const planned = hostedPromptBatchPlan(authorityFor(false), "validated-scenes-v1");
    const onCapacityRefused = vi.fn(async () => {}),
      recordResult = vi.fn(async () => {});
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const [task] = JSON.parse(String(init?.body));
      return Response.json(
        {
          data: [],
          errors: [
            {
              taskType: "textInference",
              taskUUID: task.taskUUID,
              code: "concurrentRequestLimitExceeded",
              message:
                "Insufficient available balance. Some of your credits are currently reserved for requests in progress. Please wait...",
            },
          ],
        },
        { status: 400 },
      );
    });
    const operation = dispatchOneHostedPromptBatch({
      apiKey: "configured-test-key-value",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      remainingReservationMicroUsd: 2_000_000,
      claim: async () => true,
      onCapacityRefused,
      recordResult,
      fetcher,
    });
    await expect(operation).rejects.toBeInstanceOf(HostedPromptCapacityPausedError);
    await expect(operation).rejects.toMatchObject({
      message: "HOSTED_PROMPT_PROVIDER_CAPACITY_WAIT",
      refusal: {
        taskUUID: expect.any(String),
        responseHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onCapacityRefused).toHaveBeenCalledTimes(1);
    expect(recordResult).not.toHaveBeenCalled();
  });

  it.each(["validated-scenes-v1", "grounded-scenes-v1"] as const)(
    "finalizes and recompiles a recovered %s Natural prefix through the durable service without HTTP or compiler drift",
    async (policy) => {
      const base = authorityFor(true),
        authority = { ...base, recordedInputHash: promptExecutionInputHash(base) };
      const batchPlan = hostedPromptBatchPlan(authority, policy);
      const persistedBatchPlanBinding = {
        plannedBatchCount: batchPlan.batchCount,
        plannedSceneCount: batchPlan.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(batchPlan),
      };
      const command = {
        projectId: authority.projectId,
        revisionId: authority.revisionId,
        timelineId: authority.timelineId,
        taskId: authority.taskId,
        attemptId: authority.attemptId,
        outboxId: authority.outboxId,
        presentedClaimTokenHash: authority.claimTokenHash,
      };
      const batches: Parameters<
        NonNullable<Parameters<typeof runHostedPromptExecution>[0]["persistBatch"]>
      >[0][] = [];
      const providerFixture = successfulPromptFetcher();
      const boundedFixture: typeof fetch = async (url, init) => {
        const response = await providerFixture(url, init),
          envelope = (await response.json()) as { data: [{ text: string }] };
        const task = JSON.parse(String(init?.body))[0],
          payload = JSON.parse(task.messages[0].content);
        const document = JSON.parse(envelope.data[0].text);
        document.scenes = document.scenes.map((row: { scene_id: string }) => ({
          ...row,
          literal_subject: payload.scenes.find(
            (scene: PromptFixtureScene) => scene.scene_id === row.scene_id,
          ).exact_phrase,
          action: "At rest",
          environment: "An ordinary room",
        }));
        envelope.data[0].text = JSON.stringify(document);
        return Response.json(envelope);
      };
      const first = await runHostedPromptExecution({
        scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
        authority,
        batchPlan,
        persistedBatchPlanBinding,
        command,
        apiKey: "configured-test-key-value",
        persist: async () => undefined,
        persistBatch: async (batch) => {
          batches.push(batch);
        },
        fetcher: boundedFixture,
      });
      const version = policy === "grounded-scenes-v1" ? "prompt-compiler-v5" : "prompt-compiler-v4";
      expect(
        first.compiledPrompts.every((prompt) => prompt.promptCompilerVersion === version),
      ).toBe(true);
      expect(
        batches
          .flatMap((batch) => batch.scenes)
          .every((scene) => scene.compiledPrompt.promptCompilerVersion === version),
      ).toBe(true);
      const recovered = await recoverHostedPromptBatchPlan(authority, persistedBatchPlanBinding);
      const noSubmit = vi.fn(async () => {
        throw new Error("Accepted prefix cannot submit");
      });
      const resumed = await runHostedPromptExecution({
        scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
        authority: { ...authority, compilerPolicy: "local-evidence-v1" },
        batchPlan: recovered,
        persistedBatchPlanBinding,
        command,
        apiKey: "configured-test-key-value",
        persist: async () => undefined,
        fetcher: noSubmit,
        acceptedCompiledPrompts: new Map(
          first.compiledPrompts.map((prompt) => [prompt.sceneId, prompt]),
        ),
        continuation: {
          reservationMicroUsd: authority.reservedCostMicroUsd,
          beforeBatchSubmit: noSubmit,
          acceptedBatches: batches.map((batch) => ({
            ...batch,
            scenes: batch.scenes.map(({ sceneOrdinal, sceneId, writerOutput }) => ({
              sceneOrdinal,
              sceneId,
              writerOutput,
            })),
          })),
        },
      });
      expect(resumed.compiledPrompts).toEqual(first.compiledPrompts);
      expect(noSubmit).not.toHaveBeenCalled();
    },
  );

  it("compiles fresh v32 Natural batches with v5 while legacy compilation stays v4", async () => {
    const authority = authorityFor(true),
      planned = hostedPromptBatchPlan(authority, "grounded-scenes-v1");
    const accepted = await dispatchOneHostedPromptBatch({
      apiKey: "configured-test-key-value",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      remainingReservationMicroUsd: 2_000_000,
      claim: async () => true,
      fetcher: successfulPromptFetcher(),
    });
    expect(accepted).not.toBeNull();
    const captured: NonNullable<Parameters<typeof compileAndPersistHostedPromptBatch>[2]> = vi.fn(
      async () => {},
    );
    await compileAndPersistHostedPromptBatch(authority, accepted!, captured, "local-evidence-v1");
    await compileAndPersistHostedPromptBatch(authority, accepted!, captured);
    const fresh = vi.mocked(captured).mock.calls[0]![0],
      legacy = vi.mocked(captured).mock.calls[1]![0];
    expect(
      fresh.scenes.every(
        (scene) => scene.compiledPrompt.promptCompilerVersion === "prompt-compiler-v5",
      ),
    ).toBe(true);
    expect(
      legacy.scenes.every(
        (scene) => scene.compiledPrompt.promptCompilerVersion === "prompt-compiler-v4",
      ),
    ).toBe(true);
    expect(fresh.scenes.map((scene) => scene.writerOutput)).toEqual(
      legacy.scenes.map((scene) => scene.writerOutput),
    );
    expect(fresh.requestHash).toBe(legacy.requestHash);
    expect(fresh.responseHash).toBe(legacy.responseHash);
    expect(authority.compilerPolicy).toBeUndefined();
  });

  it("v31 repairs only rejected scenes, preserves good rows, and recovers sealed correction without HTTP", async () => {
    const authority = authorityFor(false);
    const preservedSemanticScene = {
      ...authority.scenes[1]!,
      phrase: "A chef is not stirring soup in a kitchen.",
      sentenceContext: "A chef is not stirring soup in a kitchen.",
      priorContext: null,
      nextContext: null,
    };
    const planned = hostedPromptBatchPlan(
      {
        ...authority,
        scenes: authority.scenes.map((scene, index) =>
          index === 1 ? preservedSemanticScene : scene,
        ),
      },
      "validated-scenes-v1",
    );
    const entry = planned.batches[0]!;
    const binding = {
      plannedBatchCount: planned.batchCount,
      plannedSceneCount: planned.totalScenes,
      batchPlanHash: await hostedPromptBatchPlanHash(planned),
    };
    const original = promptRuntime.buildRunwarePromptRequest(
      entry.batch,
      entry.batch.scenes,
      1,
      null,
      1,
      "validated-scenes-v1",
    );
    const payload = JSON.parse(original.request.messages[0]!.content);
    const rows = payload.scenes.map((scene: PromptFixtureScene) =>
      groundedPromptFixtureScene(scene, {}, payload.story_context),
    );
    rows[0].action = "Reading a printed label on a bottle.";
    rows[1] = {
      ...rows[1],
      literal_subject: "A chef",
      action: "Stirring soup",
      environment: "A kitchen",
    };
    const source = {
      status: "succeeded" as const,
      outputText: JSON.stringify({ batch_id: entry.batch.batchId, scenes: rows }),
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300, cachedInputTokens: 0 },
      costUsd: 0.01,
      finishReason: "stop",
      providerModel: original.request.model,
      latencyMs: 0,
    };
    const correction = promptRuntime.buildRunwarePromptCorrection(entry.batch, source.outputText)!;
    expect(correction.failedSceneIds).toEqual([entry.sceneIds[0]]);
    const freshCorrection = promptRuntime.buildRunwarePromptCorrection(
      entry.batch,
      source.outputText,
      "grounded-scenes-v1",
    )!;
    expect(freshCorrection.failedSceneIds).toEqual(
      expect.arrayContaining([entry.sceneIds[0], entry.sceneIds[1]]),
    );
    expect(freshCorrection.failures).toContainEqual({
      sceneId: entry.sceneIds[1],
      field: "action",
      reason: "explicit_negation_conflict",
    });
    const noHttp = vi.fn(async () => {
      throw new Error("Recovery must not use HTTP");
    });
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "configured-test-key-value",
        plan: planned,
        persistedBinding: binding,
        batchOrdinal: 0,
        taskUUID: original.request.taskUUID,
        requestBytes: original.requestBytes,
        requestHash: original.requestSha256,
        reservationMicroUsd: 2_000_000,
        recordedResult: source,
        fetcher: noHttp,
      }),
    ).rejects.toMatchObject({ correction });
    const results: Parameters<
      NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
    >[0][] = [];
    const fetcher = successfulPromptFetcher();
    const accepted = (await dispatchOneHostedPromptBatch({
      apiKey: "configured-test-key-value",
      plan: planned,
      persistedBinding: binding,
      batchOrdinal: 0,
      remainingReservationMicroUsd: 2_000_000,
      retryOfRequestHash: original.requestSha256,
      correction,
      contentRepair: "no-text-v2",
      claim: async () => true,
      recordResult: async (result) => {
        results.push(result);
      },
      fetcher,
    }))!;
    const sealed = JSON.parse(accepted.requestBytes)[0];
    const repairedPayload = JSON.parse(sealed.messages[0].content);
    expect(repairedPayload.scenes.map((scene: PromptFixtureScene) => scene.scene_id)).toEqual(
      correction.failedSceneIds,
    );
    expect(accepted.scenes).toHaveLength(entry.sceneIds.length);
    expect(JSON.parse(accepted.responseBytes).scenes).toHaveLength(1);
    const recovered = await recoverClaimedHostedPromptBatch({
      apiKey: "configured-test-key-value",
      plan: planned,
      persistedBinding: binding,
      batchOrdinal: 0,
      taskUUID: sealed.taskUUID,
      requestBytes: accepted.requestBytes,
      requestHash: accepted.requestHash,
      reservationMicroUsd: 2_000_000,
      retryOfRequestHash: original.requestSha256,
      recordedResult: results[0]!.result,
      sourceRecordedResult: source,
      fetcher: noHttp,
    });
    expect(recovered.scenes).toEqual(accepted.scenes);
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "configured-test-key-value",
        plan: planned,
        persistedBinding: binding,
        batchOrdinal: 0,
        taskUUID: sealed.taskUUID,
        requestBytes: accepted.requestBytes,
        requestHash: accepted.requestHash,
        reservationMicroUsd: 2_000_000,
        retryOfRequestHash: original.requestSha256,
        recordedResult: results[0]!.result,
        sourceRecordedResult: { ...source, outputText: "changed" },
        fetcher: noHttp,
      }),
    ).rejects.toThrow();
    const continued = await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
      undefined,
      binding,
      {
        beforeBatchSubmit: async () => {},
        acceptedBatches: [
          {
            ...accepted,
            retryOfRequestHash: original.requestSha256,
            scenes: accepted.scenes.map((scene) => ({
              sceneOrdinal: scene.sceneOrdinal,
              sceneId: scene.scene.sceneId,
              writerOutput: scene.writerOutput,
            })),
          },
        ],
      },
    ).write({ ...entry.batch, scenes: planned.batches.flatMap((part) => part.batch.scenes) });
    expect(continued.output.scenes.slice(0, entry.sceneIds.length)).toEqual(
      accepted.scenes.map((scene) => scene.writerOutput),
    );
    expect(noHttp).not.toHaveBeenCalled();
  });

  for (const natural of [false, true]) {
    it.each([
      "legacy",
      "physical-placement-v1",
      "physical-placement-v2",
      "no-graphics-v1",
      "no-graphics-v2",
      "no-graphics-async-v1",
      "validated-scenes-v1",
      "grounded-scenes-v1",
    ] as const)(
      `selects sealed %s policy, recovers without inference, and resumes unchanged (natural=${natural})`,
      async (policy) => {
        const authority = authorityFor(natural);
        const planned = hostedPromptBatchPlan(authority, policy);
        const binding = {
          plannedBatchCount: planned.batchCount,
          plannedSceneCount: planned.totalScenes,
          batchPlanHash: await hostedPromptBatchPlanHash(planned),
        };
        const recoveredPlan = await recoverHostedPromptBatchPlan(authority, binding);
        expect(recoveredPlan).toEqual(planned);
        expect(hostedPromptBatchPlan(authority).requestPolicy).toBe("runware-luna-grounded-v2");
        const fetcher = successfulPromptFetcher();
        const results: Parameters<
          NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
        >[0][] = [];
        const accepted = await dispatchOneHostedPromptBatch({
          apiKey: "runware-test-key-at-least-twenty-characters",
          plan: recoveredPlan,
          persistedBinding: binding,
          batchOrdinal: 0,
          remainingReservationMicroUsd: 2_000_000,
          claim: async () => true,
          recordResult: async (result) => {
            results.push(result);
          },
          fetcher,
        });
        expect(accepted).not.toBeNull();
        expect(fetcher).toHaveBeenCalledTimes(1);
        const saved = accepted!;
        const task = JSON.parse(saved.requestBytes)[0];
        fetcher.mockClear();
        const restored = await recoverClaimedHostedPromptBatch({
          apiKey: "runware-test-key-at-least-twenty-characters",
          plan: recoveredPlan,
          persistedBinding: binding,
          batchOrdinal: 0,
          taskUUID: task.taskUUID,
          requestBytes: saved.requestBytes,
          requestHash: saved.requestHash,
          reservationMicroUsd: 2_000_000,
          recordedResult: results[0]!.result,
          fetcher,
        });
        expect(restored.scenes).toEqual(saved.scenes);
        expect(fetcher).not.toHaveBeenCalled();
        const fullBatch = {
          ...planned.batches[0]!.batch,
          scenes: planned.batches.flatMap((entry) => entry.batch.scenes),
        };
        const continued = await new HostedRunwarePromptWriter(
          "configured-test-key-value",
          recoveredPlan,
          fetcher,
          undefined,
          binding,
          {
            reservationMicroUsd: 2_000_000,
            acceptedBatches: [
              {
                ...saved,
                scenes: saved.scenes.map(({ sceneOrdinal, scene, writerOutput }) => ({
                  sceneOrdinal,
                  sceneId: scene.sceneId,
                  writerOutput,
                })),
              },
            ],
            beforeBatchSubmit: async () => {},
          },
        ).write(fullBatch);
        expect(continued.output.scenes.slice(0, saved.scenes.length)).toEqual(
          saved.scenes.map((scene) => scene.writerOutput),
        );
        expect(fetcher).toHaveBeenCalledTimes(planned.batchCount - 1);
        for (const [, init] of fetcher.mock.calls) {
          expect(JSON.parse(String(init?.body))[0].settings.systemPrompt).toBe(
            task.settings.systemPrompt,
          );
        }
        fetcher.mockClear();
        const replacementClaim = vi.fn(async () => true);
        await expect(
          dispatchOneHostedPromptBatch({
            apiKey: "runware-test-key-at-least-twenty-characters",
            plan: recoveredPlan,
            persistedBinding: binding,
            batchOrdinal: 0,
            remainingReservationMicroUsd: 249_999,
            retryOfRequestHash: saved.requestHash,
            claim: replacementClaim,
            fetcher,
          }),
        ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
        expect(replacementClaim).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
        const replacement = await dispatchOneHostedPromptBatch({
          contentRepair: true,
          apiKey: "runware-test-key-at-least-twenty-characters",
          plan: recoveredPlan,
          persistedBinding: binding,
          batchOrdinal: 0,
          remainingReservationMicroUsd: 2_000_000,
          retryOfRequestHash: saved.requestHash,
          claim: replacementClaim,
          fetcher,
        });
        expect(replacementClaim).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledTimes(1);
        const replacementTask = JSON.parse(replacement!.requestBytes)[0];
        expect(replacementTask.taskUUID).not.toBe(task.taskUUID);
        expect(replacementTask.settings.systemPrompt).toBe(
          policy === "no-graphics-v1" ||
            policy === "no-graphics-v2" ||
            policy === "no-graphics-async-v1" ||
            policy === "validated-scenes-v1" ||
            policy === "grounded-scenes-v1"
            ? task.settings.systemPrompt
            : `${task.settings.systemPrompt}\n${promptRuntime.PROMPT_CONTENT_REPAIR_INSTRUCTION}`,
        );
        const recordResult = results[0]!.result;
        const correctedResult = { ...recordResult, outputText: replacement!.responseBytes };
        await expect(
          recoverClaimedHostedPromptBatch({
            apiKey: "unused",
            plan: recoveredPlan,
            persistedBinding: binding,
            batchOrdinal: 0,
            taskUUID: replacementTask.taskUUID,
            requestBytes: replacement!.requestBytes,
            requestHash: replacement!.requestHash,
            retryOfRequestHash: saved.requestHash,
            reservationMicroUsd: 2_000_000,
            recordedResult: correctedResult,
            fetcher: async () => {
              throw new Error("Must not fetch a recorded correction");
            },
          }),
        ).resolves.toMatchObject({
          requestBytes: replacement!.requestBytes,
          responseBytes: replacement!.responseBytes,
        });
        expect(JSON.parse(replacementTask.messages[0].content).attempt_index).toBe(2);
        fetcher.mockClear();
        await expect(
          recoverHostedPromptBatchPlan(authority, { ...binding, batchPlanHash: digest }),
        ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
        const claim = vi.fn(async () => true);
        await expect(
          dispatchOneHostedPromptBatch({
            apiKey: "runware-test-key-at-least-twenty-characters",
            plan: {
              ...recoveredPlan,
              requestPolicy: policy === "legacy" ? "physical-placement-v2" : "legacy",
            },
            persistedBinding: binding,
            batchOrdinal: 0,
            remainingReservationMicroUsd: 2_000_000,
            claim,
            fetcher,
          }),
        ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
        expect(claim).not.toHaveBeenCalled();
        expect(fetcher).not.toHaveBeenCalled();
      },
    );
  }
});

describe("hosted prompt authority", () => {
  it("rejects impossible Natural Documentary fixed budgets as unpaid input failures before planning", () => {
    const profile = JSON.parse(
      readFileSync(
        "../../project-context/evidence/natural_documentary_image_style_v1.json",
        "utf8",
      ),
    );
    const base = hostedPromptAuthority({ plan: plan(), identity, reservedCostMicroUsd: 8_000_000 });
    const treatment = derivePromptStyleTreatment(
      profile.visual_profile,
      NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    );
    const authority = {
      ...base,
      styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
      styleTreatment: treatment,
      style: {
        positiveSuffix: promptStyleTreatmentPositiveSuffix(treatment),
        negativeSuffix: profile.prompt_profile.negative_suffix,
        fullImageGuidance: profile.prompt_profile.full_image_guidance,
        splitImageGuidance: profile.prompt_profile.split_image_guidance,
      },
      extraPromptKeywords: "x".repeat(500),
      applyExtraPromptKeywords: true,
    };
    try {
      hostedPromptBatchPlan(authority);
      expect.fail("Budget should reject before a request can be claimed");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedPromptExecutionError);
      expect(error).toMatchObject({
        problemCode: "HOSTED_PROMPT_INPUT_INVALID",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
      });
    }
    const planned = hostedPromptBatchPlan({ ...authority, applyExtraPromptKeywords: false });
    expect(
      Object.values(planned.batches[0]?.batch.literalCharacterLimits ?? {}).every(
        (limit) => limit >= 90,
      ),
    ).toBe(true);
  });
  it("finalizes a long accepted prefix without submitting another provider request", async () => {
    const plannedScenes = scenes(327);
    const authority = hostedPromptAuthority({
      plan: plan({
        scenes: plannedScenes,
        all_segments: plannedScenes.map((scene, index) => ({
          scene_id: scene.scene_id,
          segment_index: index,
          phrase: scene.phrase,
        })),
      }),
      identity,
      reservedCostMicroUsd: 8_000_000,
    });
    const batchPlan = hostedPromptBatchPlan(authority, "grounded-scenes-v1");
    const persistedBatchPlanBinding = {
      plannedBatchCount: batchPlan.batchCount,
      plannedSceneCount: batchPlan.totalScenes,
      batchPlanHash: await hostedPromptBatchPlanHash(batchPlan),
    };
    const command = {
      projectId: authority.projectId,
      revisionId: authority.revisionId,
      timelineId: authority.timelineId,
      taskId: authority.taskId,
      attemptId: authority.attemptId,
      outboxId: authority.outboxId,
      presentedClaimTokenHash: authority.claimTokenHash,
    };
    const batches: Parameters<
      NonNullable<Parameters<typeof runHostedPromptExecution>[0]["persistBatch"]>
    >[0][] = [];
    const fetcher = successfulPromptFetcher();
    const first = await runHostedPromptExecution({
      scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
      authority,
      batchPlan,
      persistedBatchPlanBinding,
      command,
      apiKey: "configured-test-key-value",
      persist: async () => undefined,
      persistBatch: async (batch) => {
        batches.push(batch);
      },
      fetcher,
    });
    expect(batchPlan.batchCount).toBeGreaterThan(30);
    expect(first.compiledPrompts).toHaveLength(327);
    expect(batches).toHaveLength(batchPlan.batchCount);
    const noPost = vi.fn();
    const persist = vi.fn(async () => undefined);
    const resumed = await runHostedPromptExecution({
      scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
      authority,
      batchPlan,
      persistedBatchPlanBinding,
      continuation: {
        reservationMicroUsd: 8_000_000,
        acceptedBatches: batches.map((batch) => ({
          ...batch,
          scenes: batch.scenes.map(({ sceneOrdinal, sceneId, writerOutput }) => ({
            sceneOrdinal,
            sceneId,
            writerOutput,
          })),
        })),
        beforeBatchSubmit: async () => {
          noPost();
          throw new Error("unexpected submit");
        },
      },
      acceptedCompiledPrompts: new Map(
        first.compiledPrompts.map((prompt) => [prompt.sceneId, prompt]),
      ),
      command,
      apiKey: "configured-test-key-value",
      persist,
      fetcher: noPost,
    });
    expect(resumed.compiledPrompts).toHaveLength(327);
    expect(persist).toHaveBeenCalledOnce();
    expect(noPost).not.toHaveBeenCalled();
  });

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
          phrase: scene.phrase,
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

  it("admits unlimited and legacy finite plans but rejects an already-claimed plan", () => {
    expect(() =>
      hostedPromptAuthority({
        plan: plan(),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).not.toThrow();
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
    ).not.toThrow();
  });

  it("keeps punctuation-free Stage 4 fragments local without transcript-scale duplication", () => {
    const fragmentScenes = scenes().map((scene, index) => ({
      ...scene,
      phrase: `deterministic narration fragment ${index + 1} without terminal punctuation`,
    }));
    const allSegments = fragmentScenes.map((scene, index) => ({
      scene_id: scene.scene_id,
      segment_index: index,
      phrase: scene.phrase,
    }));
    const authority = hostedPromptAuthority({
      plan: plan({ scenes: fragmentScenes, all_segments: allSegments }),
      identity,
      reservedCostMicroUsd: 40_000,
    });

    expect(authority.scenes.map((scene) => scene.sentenceContext)).toEqual(
      fragmentScenes.map((scene) => scene.phrase),
    );
    expect(authority.scenes[0]).toMatchObject({
      priorContext: null,
      nextContext: fragmentScenes[1]!.phrase,
    });
    expect(authority.scenes[12]).toMatchObject({
      priorContext: fragmentScenes[11]!.phrase,
      nextContext: fragmentScenes[13]!.phrase,
    });
    expect(authority.scenes.at(-1)).toMatchObject({
      priorContext: fragmentScenes.at(-2)!.phrase,
      nextContext: null,
    });
    const completeTranscript = fragmentScenes.map((scene) => scene.phrase).join(" ");
    expect(authority.scenes.every((scene) => scene.sentenceContext !== completeTranscript)).toBe(
      true,
    );
  });

  it("rejects a Stage 5 scene phrase that drifts from its Stage 4 transcript fragment", () => {
    const driftedScenes = scenes().map((scene, index) =>
      index === 4 ? { ...scene, phrase: "rewritten semantic claim" } : scene,
    );
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ scenes: driftedScenes }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("Hosted prompt scene phrase does not match its transcript segment");
  });

  it("rejects reordered image scenes before provider planning", () => {
    expect(() =>
      hostedPromptAuthority({
        plan: plan({ scenes: [...scenes()].reverse() }),
        identity,
        reservedCostMicroUsd: 40_000,
      }),
    ).toThrow("Hosted prompt scene order does not match its transcript segments");
  });

  it("bounds immediate adjacent fragments and reaches the fake provider transport", async () => {
    const imageScenes = scenes();
    const bridgePhrase = `${"hydrogen peroxide bottle beside a practical kitchen sink ".repeat(30)}next evidence.`;
    const allSegments = [
      {
        scene_id: imageScenes[0]!.scene_id,
        phrase: imageScenes[0]!.phrase,
      },
      {
        scene_id: "avatar_bridge",
        phrase: bridgePhrase,
      },
      ...imageScenes.slice(1).map((scene) => ({
        scene_id: scene.scene_id,
        phrase: scene.phrase,
      })),
    ].map((segment, index) => ({ ...segment, segment_index: index }));
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
      styleTreatment: authority.styleTreatment,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });

    expect(batch.scenes[0]?.sentenceContext).toBe("literal scene 1");
    expect(batch.scenes[0]?.priorContext).toBeNull();
    expect(batch.scenes[0]?.nextContext?.length).toBeLessThanOrEqual(1_000);
    expect(batch.scenes[1]?.sentenceContext).toBe("literal scene 2");
    expect(batch.scenes[1]?.priorContext?.length).toBeLessThanOrEqual(1_000);
    expect(batch.scenes[1]?.nextContext).toBe("literal scene 3");
    expect(batch.scenes[0]?.nextContext).toMatch(/^hydrogen peroxide bottle/u);
    expect(batch.scenes[1]?.priorContext).toMatch(/next evidence\.$/u);
    expect(batch.scenes.at(-1)?.nextContext).toBeNull();
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
      expect(dispatched[0]?.model).toBe("google:gemini@3.5-flash");
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
        plan: plan({
          scenes: invalidScenes,
          all_segments: invalidScenes.map((scene, index) => ({
            scene_id: scene.scene_id,
            segment_index: index,
            phrase: scene.phrase,
          })),
        }),
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
      scenePromptWriterVersion: SCENE_PROMPT_WRITER_VERSION,
      batchId: `${ids.task}:batch:1`,
      sanitizedProjectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      styleTreatment: derivePromptStyleTreatment(visualProfile, digest),
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
      style_treatment: Record<string, unknown>;
      story_context: string;
      scenes: Array<{
        exact_phrase: string;
        prior_scene_phrase: string | null;
        next_scene_phrase: string | null;
      }>;
    };
    expect(dispatchedPlan.image_style_version_id).toBe(ids.style);
    expect(dispatchedPlan.style_profile_hash).toBe(digest);
    expect(dispatchedPlan.style_treatment).toEqual(
      expect.objectContaining({
        schema_version: "image-style-treatment/v2",
        style_profile_hash: digest,
        image_framing: "crop-safe contextual framing",
        shot_scale_preferences: ["environmental wide", "hands and action"],
      }),
    );
    expect(dispatchedPlan.story_context).toBe(batch.storyContext);
    expect(dispatchedPlan.scenes.length).toBeGreaterThan(0);
    expect(dispatchedPlan.scenes[0]).toEqual(
      expect.objectContaining({
        exact_phrase: "literal scene 1",
        prior_scene_phrase: null,
        next_scene_phrase: "literal scene 2",
      }),
    );
    expect(
      onBatchAccepted.mock.calls.flatMap(([accepted]) =>
        accepted.scenes.map((scene: { sceneOrdinal: number }) => scene.sceneOrdinal),
      ),
    ).toEqual(Array.from({ length: 25 }, (_, index) => index));
  });

  it("rejects tampered adaptive grouping before dispatch even when flattened scene IDs still match", async () => {
    const sourceScenes = scenes(31);
    const authority = hostedPromptAuthority({
      plan: plan({
        scenes: sourceScenes,
        all_segments: sourceScenes.map((scene, index) => ({
          scene_id: scene.scene_id,
          segment_index: index,
          phrase: scene.phrase,
        })),
      }),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const batch = buildPromptBatch({
      batchId: `${authority.taskId}:batch:1`,
      projectTitle: authority.projectTitle,
      imageStyleVersionId: authority.imageStyleVersionId,
      styleProfileHash: authority.styleProfileHash,
      styleTreatment: authority.styleTreatment,
      plannerGuidance: authority.plannerGuidance,
      storyContext: authority.storyContext,
      continuityTags: authority.continuityTags,
      scenes: authority.scenes,
    });
    const planned = adaptivePlan(batch);
    expect(planned.batchCount).toBeGreaterThan(1);
    const first = planned.batches[0]!;
    const second = planned.batches[1]!;
    expect(first.batch.scenes.length).toBeGreaterThan(1);
    expect(second.batch.scenes.length).toBeGreaterThan(0);

    const rebuild = (source: PromptBatch, sceneRows: readonly PromptBatch["scenes"][number][]) =>
      buildPromptBatch({
        batchId: source.batchId,
        projectTitle: source.sanitizedProjectTitle,
        imageStyleVersionId: source.imageStyleVersionId,
        styleProfileHash: source.styleProfileHash,
        styleTreatment: source.styleTreatment,
        plannerGuidance: source.plannerGuidance,
        storyContext: source.storyContext,
        continuityTags: source.continuityTags,
        scenes: sceneRows,
      });
    const firstScenes = [...first.batch.scenes];
    const secondScenes = [...second.batch.scenes];
    const movedFromFirst = firstScenes.pop()!;
    const movedFromSecond = secondScenes.shift()!;
    const alteredFirst = rebuild(first.batch, [...firstScenes, movedFromSecond]);
    const alteredSecond = rebuild(second.batch, [movedFromFirst, ...secondScenes]);
    const tamperedPlan = {
      ...planned,
      batches: Object.freeze([
        Object.freeze({ ...first, batch: alteredFirst }),
        Object.freeze({ ...second, batch: alteredSecond }),
        ...planned.batches.slice(2),
      ]),
    };
    expect(tamperedPlan.batches.flatMap((entry) => entry.sceneIds)).toEqual(
      planned.batches.flatMap((entry) => entry.sceneIds),
    );

    const fetcher = successfulPromptFetcher();
    await expect(
      new HostedRunwarePromptWriter("configured-test-key-value", tamperedPlan, fetcher, undefined, {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      }).write(batch),
    ).rejects.toEqual(
      expect.objectContaining({
        problemCode: "HOSTED_PROMPT_INPUT_INVALID",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
      } satisfies Partial<HostedPromptExecutionError>),
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses to enter hosted prompt execution without preparation batch metadata", async () => {
    const authority = hostedPromptAuthority({
      plan: plan(),
      identity,
      reservedCostMicroUsd: 40_000,
    });
    const fetcher = vi.fn();
    const persist = vi.fn(async () => undefined);

    await expect(
      runHostedPromptExecution({
        scope: { workspaceId: authority.workspaceId, actorUserId: ids.workspace },
        authority,
        batchPlan: hostedPromptBatchPlan(authority, "grounded-scenes-v1"),
        command: {
          projectId: authority.projectId,
          revisionId: authority.revisionId,
          timelineId: authority.timelineId,
          taskId: authority.taskId,
          attemptId: authority.attemptId,
          outboxId: authority.outboxId,
          presentedClaimTokenHash: authority.claimTokenHash,
        },
        apiKey: "configured-test-key-value",
        persist,
        fetcher,
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        problemCode: "HOSTED_PROMPT_INPUT_INVALID",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
      } satisfies Partial<HostedPromptExecutionError>),
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
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
      styleTreatment: authority.styleTreatment,
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

  it.each([
    "show a visible logo",
    "Pointing at a blueprint layout of a residential development",
    "depicting the narration-supported visible moment",
  ])(
    "rejects unusable required action without retry and reports known cost: %s",
    async (action) => {
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
        styleTreatment: authority.styleTreatment,
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
          story_context: string;
          scenes: PromptFixtureScene[];
        };
        return Response.json({
          data: [
            {
              taskUUID: task.taskUUID,
              text: JSON.stringify({
                batch_id: payload.batch_id,
                scenes: payload.scenes.map((scene, index) =>
                  groundedPromptFixtureScene(
                    scene,
                    index === 0 ? { action } : {},
                    payload.story_context,
                  ),
                ),
              }),
              usage: {
                promptTokens: 100,
                completionTokens: 100,
                totalTokens: 200,
                cachedInputTokens: 0,
              },
              cost: 0.00001,
              finishReason: "stop",
              model: "google:gemini@3.5-flash",
            },
          ],
        });
      });

      const onBatchAccepted = vi.fn();
      await expect(
        new HostedRunwarePromptWriter(
          "configured-test-key-value",
          adaptivePlan(batch),
          fetcher,
          onBatchAccepted,
        ).write(batch),
      ).rejects.toMatchObject({
        name: "HostedPromptExecutionError",
        problemCode: "HOSTED_PROMPT_OUTPUT_INVALID",
        terminalState: "FAILED",
        providerMayHaveCharged: false,
        additionalKnownCostMicroUsd: 10,
        validationDiagnostic: {
          category: "scene_quality",
          reason: "scene_quality",
          unresolvedSceneCount: 1,
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(onBatchAccepted).not.toHaveBeenCalled();
    },
  );

  it("preserves accepted prefix and known invalid cost before distinct bounded replacement", async () => {
    const batch = buildPromptBatch({
      batchId: `${ids.task}:batch:multi`,
      projectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      styleTreatment: {
        schema_version: "image-style-treatment/v2",
        style_profile_hash: digest,
        medium_family: "documentary photography",
        realism: "physically believable still image",
        camera_language: "restrained observational camera language",
        image_framing: "crop-safe contextual framing",
        shot_scale_preferences: ["environmental wide"],
        lighting: "available practical light",
        palette: { descriptors: ["true-to-life"], approximate_hex: [] },
        contrast_and_exposure: "soft natural contrast",
        depth_of_field: "natural lens depth",
        texture_and_grain: "tactile material detail",
        imperfection_profile: ["ordinary wear"],
        mood: ["observational"],
      },
      plannerGuidance: "Literal editorial collage treatment.",
      storyContext: "A continuous practical household demonstration.",
      continuityTags: [],
      scenes: scenes(20).map((scene) => ({
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
        story_context: string;
        scenes: PromptFixtureScene[];
      };
      const secondBatch = fetcher.mock.calls.length === 2;
      return Response.json({
        data: [
          {
            taskUUID: task.taskUUID,
            text: JSON.stringify({
              batch_id: payload.batch_id,
              scenes: payload.scenes.map((scene, index) =>
                groundedPromptFixtureScene(
                  scene,
                  secondBatch && index === 0 ? { action: "show a visible logo" } : {},
                  payload.story_context,
                ),
              ),
            }),
            usage: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              cachedInputTokens: 0,
            },
            cost: 0.00001,
            finishReason: "stop",
            model: "google:gemini@3.5-flash",
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
    ).rejects.toMatchObject({
      problemCode: "HOSTED_PROMPT_OUTPUT_INVALID",
      terminalState: "FAILED",
      providerMayHaveCharged: false,
      additionalKnownCostMicroUsd: 10,
      validationDiagnostic: { category: "scene_quality", reason: "scene_quality" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onBatchAccepted).toHaveBeenCalledTimes(1);
    expect(onBatchAccepted.mock.calls[0]?.[0].reportedCostMicroUsd).toBe(10);
    expect(onBatchAccepted.mock.calls[0]?.[0].scenes).toHaveLength(
      planned.batches[0]!.sceneIds.length,
    );

    const first = onBatchAccepted.mock.calls[0]![0] as HostedAcceptedPromptBatch;
    const originalTask = JSON.parse(first.requestBytes)[0] as { taskUUID: string };
    const retrieval = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Array<{
        taskType: string;
        taskUUID: string;
      }>;
      expect(request).toEqual([{ taskType: "getTaskDetails", taskUUID: originalTask.taskUUID }]);
      return Response.json({
        data: [
          {
            taskType: "getTaskDetails",
            taskUUID: originalTask.taskUUID,
            request: JSON.parse(first.requestBytes),
            response: {
              data: [
                {
                  taskType: "textInference",
                  taskUUID: originalTask.taskUUID,
                  text: first.responseBytes,
                  cost: 0.00001,
                  finishReason: "stop",
                  model: "google:gemini@3.5-flash",
                  usage: {
                    promptTokens: 100,
                    completionTokens: 200,
                    totalTokens: 300,
                    cachedInputTokens: 0,
                  },
                },
              ],
            },
          },
        ],
      });
    });
    const restored = await recoverClaimedHostedPromptBatch({
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      taskUUID: originalTask.taskUUID,
      requestBytes: first.requestBytes,
      requestHash: first.requestHash,
      reservationMicroUsd: 2_000_000,
      fetcher: retrieval,
    });
    expect(retrieval).toHaveBeenCalledTimes(1);
    const invalidRetrieval = vi.fn(async () =>
      Response.json({
        data: [
          {
            taskType: "getTaskDetails",
            taskUUID: originalTask.taskUUID,
            request: JSON.parse(first.requestBytes),
            response: {
              data: [
                {
                  taskType: "textInference",
                  taskUUID: originalTask.taskUUID,
                  text: '{"batch_id":"incomplete","scenes":[{"prompt":}',
                  cost: 0.073,
                  finishReason: "stop",
                  model: "google:gemini@3.5-flash",
                  usage: {
                    promptTokens: 100,
                    completionTokens: 8873,
                    totalTokens: 8973,
                    cachedInputTokens: 0,
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan: planned,
        persistedBinding: {
          plannedBatchCount: planned.batchCount,
          plannedSceneCount: planned.totalScenes,
          batchPlanHash: await hostedPromptBatchPlanHash(planned),
        },
        batchOrdinal: 0,
        taskUUID: originalTask.taskUUID,
        requestBytes: first.requestBytes,
        requestHash: first.requestHash,
        reservationMicroUsd: 2_000_000,
        fetcher: invalidRetrieval,
      }),
    ).rejects.toMatchObject({
      name: "HostedPromptArchivedOutputInvalidError",
      knownCostMicroUsd: 73_000,
      validationDiagnostic: { category: "malformed_json", reason: "json_parse" },
    });
    expect(invalidRetrieval).toHaveBeenCalledTimes(1);
    const claimRejected = vi.fn(async () => false);
    fetcher.mockClear();
    await expect(
      dispatchOneHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan: planned,
        persistedBinding: {
          plannedBatchCount: planned.batchCount,
          plannedSceneCount: planned.totalScenes,
          batchPlanHash: await hostedPromptBatchPlanHash(planned),
        },
        batchOrdinal: 0,
        remainingReservationMicroUsd: 2_000_000,
        claim: claimRejected,
        fetcher,
      }),
    ).resolves.toBeNull();
    expect(claimRejected).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
    const claimAccepted = vi.fn(async () => true);
    const privateResults: Parameters<
      NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
    >[0][] = [];
    const submitted = await dispatchOneHostedPromptBatch({
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      remainingReservationMicroUsd: 2_000_000,
      claim: claimAccepted,
      recordResult: async (result) => {
        privateResults.push(result);
      },
      fetcher,
    });
    expect(claimAccepted).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(submitted).toMatchObject({ batchOrdinal: 0, reportedCostMicroUsd: 10 });
    expect(privateResults).toHaveLength(1);
    fetcher.mockClear();
    const fromPrivateResponse = await recoverClaimedHostedPromptBatch({
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      taskUUID: privateResults[0]!.taskUUID,
      requestBytes: submitted!.requestBytes,
      requestHash: submitted!.requestHash,
      reservationMicroUsd: 2_000_000,
      recordedResult: privateResults[0]!.result,
      fetcher,
    });
    expect(fromPrivateResponse).toEqual(submitted);
    expect(fetcher).not.toHaveBeenCalled();
    const invalidNativeResult = vi.fn(async () =>
      Response.json({
        data: [
          {
            taskUUID: originalTask.taskUUID,
            text: "invalid JSON retained privately",
            cost: 0.00001,
            finishReason: "stop",
            model: "google:gemini@3.5-flash",
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, cachedInputTokens: 0 },
          },
        ],
      }),
    );
    const invalidRecords: typeof privateResults = [];
    await expect(
      dispatchOneHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan: planned,
        persistedBinding: {
          plannedBatchCount: planned.batchCount,
          plannedSceneCount: planned.totalScenes,
          batchPlanHash: await hostedPromptBatchPlanHash(planned),
        },
        batchOrdinal: 0,
        remainingReservationMicroUsd: 2_000_000,
        claim: async () => true,
        recordResult: async (value) => {
          invalidRecords.push(value);
        },
        fetcher: invalidNativeResult,
      }),
    ).rejects.toThrow();
    expect(invalidRecords).toHaveLength(1);
    expect(invalidRecords[0]!.result.outputText).toBe("invalid JSON retained privately");
    expect(invalidNativeResult).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    const replacement = await dispatchOneHostedPromptBatch({
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan: planned,
      persistedBinding: {
        plannedBatchCount: planned.batchCount,
        plannedSceneCount: planned.totalScenes,
        batchPlanHash: await hostedPromptBatchPlanHash(planned),
      },
      batchOrdinal: 0,
      remainingReservationMicroUsd: 2_000_000,
      retryOfRequestHash: first.requestHash,
      claim: async () => true,
      fetcher,
    });
    expect(replacement).not.toBeNull();
    expect(JSON.parse(replacement!.requestBytes)[0].taskUUID).not.toBe(originalTask.taskUUID);
    expect(
      JSON.parse(JSON.parse(replacement!.requestBytes)[0].messages[0].content).attempt_index,
    ).toBe(2);
    expect(replacement!.requestHash).not.toBe(first.requestHash);
    fetcher.mockClear();
    const replacementPrefix = {
      ...replacement!,
      retryOfRequestHash: first.requestHash,
      scenes: replacement!.scenes.map(({ sceneOrdinal, scene, writerOutput }) => ({
        sceneOrdinal,
        sceneId: scene.sceneId,
        writerOutput,
      })),
    };
    await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
      undefined,
      undefined,
      {
        reservationMicroUsd: 2_000_000,
        acceptedBatches: [replacementPrefix],
        beforeBatchSubmit: async () => {},
      },
    ).write(batch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockClear();
    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        undefined,
        undefined,
        {
          reservationMicroUsd: 2_000_000,
          acceptedBatches: [{ ...replacementPrefix, retryOfRequestHash: null }],
          beforeBatchSubmit: async () => {},
        },
      ).write(batch),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(restored).toMatchObject({
      batchOrdinal: 0,
      responseHash: first.responseHash,
      reportedCostMicroUsd: 10,
    });
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan: planned,
        persistedBinding: {
          plannedBatchCount: planned.batchCount,
          plannedSceneCount: planned.totalScenes,
          batchPlanHash: await hostedPromptBatchPlanHash(planned),
        },
        batchOrdinal: 0,
        taskUUID: originalTask.taskUUID,
        requestBytes: first.requestBytes,
        requestHash: digest,
        reservationMicroUsd: 2_000_000,
        fetcher: retrieval,
      }),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(retrieval).toHaveBeenCalledTimes(1);
    const recovered = {
      ...first,
      scenes: first.scenes.map(({ sceneOrdinal, scene, writerOutput }) => ({
        sceneOrdinal,
        sceneId: scene.sceneId,
        writerOutput,
      })),
    };
    fetcher.mockClear();
    const claim = vi.fn(async (_request: unknown) => {});
    const continued = await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
      undefined,
      undefined,
      { reservationMicroUsd: 2_000_000, acceptedBatches: [recovered], beforeBatchSubmit: claim },
    ).write(batch);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim.mock.calls[0]![0]).toMatchObject({ batchOrdinal: 1 });
    expect(continued.output.scenes).toHaveLength(20);
    expect(continued.attempts[0]?.reportedCostMicroUsd).toBe(20);

    fetcher.mockClear();
    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        undefined,
        undefined,
        {
          acceptedBatches: [{ ...recovered, requestHash: digest }],
          beforeBatchSubmit: claim,
        },
      ).write(batch),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        undefined,
        undefined,
        {
          acceptedBatches: [recovered],
          beforeBatchSubmit: async () => {
            throw new Error("claim uncertain");
          },
        },
      ).write(batch),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        undefined,
        undefined,
        {
          acceptedBatches: [recovered],
          beforeBatchSubmit: async () => {
            throw new HostedPromptExecutionError(
              "HOSTED_PROMPT_PROVIDER_CREDITS_LOW",
              "UNKNOWN",
              true,
              null,
            );
          },
        },
      ).write(batch),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_PROVIDER_CREDITS_LOW" });
    expect(fetcher).not.toHaveBeenCalled();

    await expect(
      new HostedRunwarePromptWriter(
        "configured-test-key-value",
        planned,
        fetcher,
        undefined,
        undefined,
        {
          reservationMicroUsd: 250_009,
          acceptedBatches: [recovered],
          beforeBatchSubmit: claim,
        },
      ).write(batch),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a normalized prompt core reused by a later adaptive batch", async () => {
    const batch = buildPromptBatch({
      batchId: `${ids.task}:batch:cross-batch-duplicate`,
      projectTitle: "Hydrogen peroxide",
      imageStyleVersionId: ids.style,
      styleProfileHash: digest,
      styleTreatment: {
        schema_version: "image-style-treatment/v2",
        style_profile_hash: digest,
        medium_family: "documentary photography",
        realism: "physically believable still image",
        camera_language: "restrained observational camera language",
        image_framing: "crop-safe contextual framing",
        shot_scale_preferences: ["environmental wide"],
        lighting: "available practical light",
        palette: { descriptors: ["true-to-life"], approximate_hex: [] },
        contrast_and_exposure: "soft natural contrast",
        depth_of_field: "natural lens depth",
        texture_and_grain: "tactile material detail",
        imperfection_profile: ["ordinary wear"],
        mood: ["observational"],
      },
      plannerGuidance: "Literal editorial collage treatment.",
      storyContext: "A continuous practical household demonstration.",
      continuityTags: [],
      scenes: scenes(20).map((scene) => ({
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
    const firstSceneId = planned.batches[0]!.sceneIds[0]!;
    const firstSceneOrdinal = Number(firstSceneId.slice(-2));
    const firstPromptCore = groundedPromptFixtureScene(
      {
        scene_id: firstSceneId,
        exact_phrase: `literal scene ${firstSceneOrdinal}`,
        scene_phrase_context: `Literal scene ${firstSceneOrdinal} belongs to this complete sentence.`,
        prior_scene_phrase: null,
        next_scene_phrase: `literal scene ${firstSceneOrdinal + 1}`,
        in_image_shot_role: "OBJECT_EVIDENCE",
      },
      {},
      "A continuous practical household demonstration.",
    ).prompt_core;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Array<Record<string, unknown>>;
      const task = request[0]!;
      const messages = task.messages as Array<{ content: string }>;
      const payload = JSON.parse(messages[0]!.content) as {
        batch_id: string;
        story_context: string;
        scenes: PromptFixtureScene[];
      };
      const secondBatch = fetcher.mock.calls.length === 2;
      return Response.json({
        data: [
          {
            taskUUID: task.taskUUID,
            text: JSON.stringify({
              batch_id: payload.batch_id,
              scenes: payload.scenes.map((scene, index) =>
                groundedPromptFixtureScene(
                  scene,
                  secondBatch && index === 0
                    ? {
                        prompt_core: `  ${firstPromptCore.toLocaleUpperCase("en-US").replaceAll(" ", "   ")}  `,
                      }
                    : {},
                  payload.story_context,
                ),
              ),
            }),
            usage: {
              promptTokens: 100,
              completionTokens: 200,
              totalTokens: 300,
              cachedInputTokens: 0,
            },
            cost: 0.00001,
            finishReason: "stop",
            model: "google:gemini@3.5-flash",
          },
        ],
      });
    });
    const onBatchAccepted = vi.fn();

    const result = await new HostedRunwarePromptWriter(
      "configured-test-key-value",
      planned,
      fetcher,
      onBatchAccepted,
    ).write(batch);

    expect(result.output.scenes).toHaveLength(20);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onBatchAccepted).toHaveBeenCalledTimes(2);
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
      styleTreatment: authority.styleTreatment,
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
