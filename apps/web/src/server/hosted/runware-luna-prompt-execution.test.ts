import {
  derivePromptStyleTreatment,
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
} from "@videoforge/pipeline";
import { buildRunwarePromptRequest, planPromptBatches } from "@videoforge/pipeline/prompts";
import { describe, expect, it, vi } from "vitest";
import type { HostedNeonPool } from "./configuration";
import { recordPromptResponse } from "./hosted-prompt-route";

import {
  HostedPromptArchivedOutputInvalidError,
  dispatchOneHostedPromptBatch,
  hostedPromptBatchPlanHash,
  recoverClaimedHostedPromptBatch,
} from "./runware-prompt-execution";

const digest = `sha256:${"a".repeat(64)}` as const;
const styleTreatment = derivePromptStyleTreatment(
  {
    medium_family: "documentary photography",
    realism: "physically believable still image",
    subject_treatment: "ordinary people and objects",
    camera_language: "restrained observational framing",
    image_framing: "crop-safe contextual framing",
    shot_scale_preferences: ["environmental wide", "hands and action"],
    lighting: "available practical light",
    color: { descriptors: ["true-to-life"], approximate_hex: [] },
    contrast_and_exposure: "natural contrast",
    depth_of_field: "natural lens depth",
    texture_and_grain: "tactile material detail",
    human_rendering: "believable anatomy",
    environment_and_material_detail: "credible real-world materials",
    imperfection_profile: ["ordinary wear"],
    mood: ["observational"],
    continuity_rules: ["preserve continuity"],
    must_include: ["physical evidence"],
    must_avoid: ["visible writing"],
    flexible_properties: ["weather"],
  },
  NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
);

function makePlan() {
  return planPromptBatches({
    literalCharacterLimit: 240,
    batchIdPrefix: "luna-integration-test",
    projectTitle: "Kitchen jars",
    imageStyleVersionId: "10000000-0000-4000-8000-000000000001",
    styleProfileHash: NATURAL_DOCUMENTARY_STYLE_PROFILE_HASH,
    styleTreatment,
    plannerGuidance: "Ground scenes in visible evidence.",
    storyContext: "Subject: a glass jar on a kitchen table",
    continuityTags: [],
    scenes: [
      {
        sceneId: "scene_01",
        phrase: "A glass jar rests on the kitchen table.",
        sentenceContext: "A glass jar rests on the kitchen table.",
        priorContext: null,
        nextContext: null,
        inImageShotRole: "OBJECT_EVIDENCE",
        layout: "IMAGE_FULL",
      },
    ],
    options: { requestPolicy: "runware-luna-grounded-v1", maxOutputTokens: 6_144 },
  });
}

function completionResponse(
  request: RequestInit | undefined,
  options: { finishReason?: string; refusal?: string; outputText?: string } = {},
): Response {
  const body = JSON.parse(String(request?.body)) as {
    model: string;
    messages: { role: string; content: string }[];
  };
  const payload = JSON.parse(body.messages[1]!.content) as {
    batch_id: string;
    story_context: string;
    scenes: { scene_id: string; exact_phrase: string; in_image_shot_role: string }[];
  };
  const output =
    options.outputText ??
    JSON.stringify({
      batch_id: payload.batch_id,
      scenes: payload.scenes.map((scene) => ({
        scene_id: scene.scene_id,
        literal_subject: "A glass jar on a kitchen table.",
        action: "Resting on the wooden table.",
        environment: "An ordinary kitchen table.",
        in_image_shot_role: scene.in_image_shot_role,
        lighting_context: "Available daylight",
        continuity_tags: [],
        prompt_core: "A glass jar rests on a kitchen table beside ordinary household objects",
      })),
    });
  return Response.json({
    id: "chatcmpl-luna_fixture",
    model: body.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: output,
          ...(options.refusal ? { refusal: options.refusal } : {}),
        },
        finish_reason: options.finishReason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: 400,
      completion_tokens: 180,
      total_tokens: 580,
      prompt_tokens_details: { cached_tokens: 40, cache_write_tokens: 15 },
      completion_tokens_details: { reasoning_tokens: 20 },
    },
  });
}

async function fixture() {
  const plan = makePlan();
  const persistedBinding = {
    plannedBatchCount: plan.batchCount,
    plannedSceneCount: plan.totalScenes,
    batchPlanHash: await hostedPromptBatchPlanHash(plan),
  };
  return { plan, persistedBinding };
}

const dispatch = async (
  fetcher: typeof fetch,
  recordResult: NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>,
) => {
  const { plan, persistedBinding } = await fixture();
  const accepted = await dispatchOneHostedPromptBatch({
    apiKey: "runware-test-key-at-least-twenty-characters",
    plan,
    persistedBinding,
    batchOrdinal: 0,
    remainingReservationMicroUsd: 250_000,
    claim: async () => true,
    recordResult,
    fetcher,
  });
  return { accepted, plan, persistedBinding };
};

describe("Runware Luna hosted prompt execution", () => {
  it.each(["receipt", "commit", "commit-unknown", "socket-ended", "connect-timeout"])(
    "retains a known response through a transient %s failure without another provider POST",
    async (failurePoint) => {
      let attempt = 0;
      const payloads: unknown[][] = [];
      const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
        if (sql === "BEGIN") attempt += 1;
        if (sql.includes("videoforge_record_hosted_prompt_response")) {
          payloads.push(parameters!);
          if (failurePoint === "receipt" && attempt === 1)
            throw Object.assign(new Error("database disconnected"), { code: "08006" });
          if (failurePoint === "socket-ended" && attempt === 1)
            throw new Error("Connection terminated unexpectedly");
          if (failurePoint === "connect-timeout" && attempt === 1)
            throw new Error("timeout exceeded when trying to connect");
        }
        if (failurePoint === "commit" && sql === "COMMIT" && attempt === 1)
          throw Object.assign(new Error("commit reply lost"), { code: "ECONNRESET" });
        if (failurePoint === "commit-unknown" && sql === "COMMIT" && attempt === 1)
          throw Object.assign(new Error("statement completion unknown"), { code: "40003" });
        return { rows: [], rowCount: 0 };
      });
      const release = vi.fn();
      const pool = { connect: async () => ({ query, release }) } as unknown as HostedNeonPool;
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => completionResponse(init));
      const result = await dispatch(fetcher, (receipt) =>
        recordPromptResponse(pool, "account", "run", receipt),
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.accepted?.scenes).toHaveLength(1);
      expect(payloads).toHaveLength(2);
      expect(payloads[1]).toEqual(payloads[0]);
      expect(release).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { code: "23514", attempts: 1 },
    { code: "42501", attempts: 1 },
    { code: "08006", attempts: 3 },
  ])("bounds receipt persistence and preserves failure $code", async ({ code, attempts }) => {
    const error = Object.assign(new Error("database failure"), { code });
    const connect = vi.fn(async () => {
      throw error;
    });
    const pool = { connect } as unknown as HostedNeonPool;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => completionResponse(init));
    await expect(
      dispatch(fetcher, (receipt) => recordPromptResponse(pool, "account", "run", receipt)),
    ).rejects.toBe(error);
    expect(connect).toHaveBeenCalledTimes(attempts);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not hide an invalid receipt when rollback also loses its connection", async () => {
    const permanent = Object.assign(new Error("receipt drift"), { code: "23514" });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("videoforge_record_hosted_prompt_response")) throw permanent;
      if (sql === "ROLLBACK")
        throw Object.assign(new Error("socket closed"), { code: "ECONNRESET" });
      return { rows: [], rowCount: 0 };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    const pool = { connect } as unknown as HostedNeonPool;
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => completionResponse(init));
    await expect(
      dispatch(fetcher, (receipt) => recordPromptResponse(pool, "account", "run", receipt)),
    ).rejects.toBeInstanceOf(AggregateError);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("posts one compatible completion and persists its normalized receipt before accepting", async () => {
    const events: string[] = [];
    const receipts: Parameters<
      NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
    >[0][] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      const wire = JSON.parse(String(init?.body));
      expect(wire.model).toBe("openai:gpt@6-luna");
      expect(wire.reasoning_effort).toBe("low");
      return completionResponse(init);
    });
    const result = await dispatch(fetcher, async (receipt) => {
      events.push("persist");
      receipts.push(receipt);
    });
    events.push("accepted");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.accepted?.scenes).toHaveLength(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.result).toMatchObject({
      status: "succeeded",
      responseId: "chatcmpl-luna_fixture",
      costBasis: "PINNED_RATE_ESTIMATE",
      costUsd: 0.000127,
      estimatedCostMicroUsd: 127,
      finishReason: "stop",
      usage: { cacheWriteTokens: 15, reasoningTokens: 20, outputTokens: 180 },
    });
    expect(receipts[0]!.result.wireHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(events).toEqual(["persist", "accepted"]);
  });

  it("keeps a lost POST ambiguous and never replays it", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("socket closed after request write");
    });
    const recordResult = vi.fn(async () => {});
    await expect(dispatch(fetcher, recordResult)).rejects.toMatchObject({
      code: "post_outcome_unknown",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recordResult).not.toHaveBeenCalled();
  });

  it("persists malformed output before validation and recovers only from that receipt", async () => {
    const { plan, persistedBinding } = await fixture();
    const receipts: Parameters<
      NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
    >[0][] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
      completionResponse(init, { outputText: "not JSON" }),
    );
    await expect(
      dispatchOneHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan,
        persistedBinding,
        batchOrdinal: 0,
        remainingReservationMicroUsd: 250_000,
        claim: async () => true,
        recordResult: async (receipt) => {
          receipts.push(receipt);
        },
        fetcher,
      }),
    ).rejects.toMatchObject({ validationDiagnostic: { reason: "json_parse" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.result).toMatchObject({
      status: "succeeded",
      responseId: "chatcmpl-luna_fixture",
      outputText: "not JSON",
    });

    const planRequest = buildRunwarePromptRequest(
      plan.batches[0]!.batch,
      plan.batches[0]!.batch.scenes,
      1,
      null,
      1,
      "runware-luna-grounded-v1",
    );
    const noHttp = vi.fn(async () => {
      throw new Error("Recovery must use the durable normalized receipt");
    });
    await expect(
      recoverClaimedHostedPromptBatch({
        apiKey: "runware-test-key-at-least-twenty-characters",
        plan,
        persistedBinding,
        batchOrdinal: 0,
        taskUUID: planRequest.request.taskUUID,
        requestBytes: planRequest.requestBytes,
        requestHash: planRequest.requestSha256,
        reservationMicroUsd: 250_000,
        recordedResult: receipts[0]!.result,
        fetcher: noHttp,
      }),
    ).rejects.toBeInstanceOf(HostedPromptArchivedOutputInvalidError);
    expect(noHttp).not.toHaveBeenCalled();
  });

  it("requires a saved receipt for recovery, then validates its wire hash without HTTP", async () => {
    const receipts: Parameters<
      NonNullable<Parameters<typeof dispatchOneHostedPromptBatch>[0]["recordResult"]>
    >[0][] = [];
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => completionResponse(init));
    const { accepted, plan, persistedBinding } = await dispatch(fetcher, async (receipt) => {
      receipts.push(receipt);
    });
    const task = JSON.parse(accepted!.requestBytes)[0];
    const noHttp = vi.fn(async () => {
      throw new Error("Luna has no safe task-polling endpoint");
    });
    const recoveryArgs = {
      apiKey: "runware-test-key-at-least-twenty-characters",
      plan,
      persistedBinding,
      batchOrdinal: 0,
      taskUUID: task.taskUUID,
      requestBytes: accepted!.requestBytes,
      requestHash: accepted!.requestHash,
      reservationMicroUsd: 250_000,
      fetcher: noHttp,
    };
    await expect(recoverClaimedHostedPromptBatch(recoveryArgs)).rejects.toMatchObject({
      problemCode: "HOSTED_PROMPT_EXECUTION_UNKNOWN",
    });
    expect(noHttp).not.toHaveBeenCalled();
    await expect(
      recoverClaimedHostedPromptBatch({ ...recoveryArgs, recordedResult: receipts[0]!.result }),
    ).resolves.toMatchObject({ responseHash: accepted!.responseHash });
    expect(noHttp).not.toHaveBeenCalled();
    await expect(
      recoverClaimedHostedPromptBatch({
        ...recoveryArgs,
        recordedResult: { ...receipts[0]!.result, wireHash: digest },
      }),
    ).rejects.toMatchObject({ problemCode: "HOSTED_PROMPT_INPUT_INVALID" });
    expect(noHttp).not.toHaveBeenCalled();
  });

  it.each([
    ["length", undefined],
    ["stop", "I cannot provide this content."],
  ])(
    "stops known incomplete/refused completion (%s) without correction",
    async (finishReason, refusal) => {
      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) =>
        completionResponse(init, { finishReason, refusal }),
      );
      const recordResult = vi.fn(async () => {});
      await expect(dispatch(fetcher, recordResult)).rejects.toMatchObject({
        problemCode: "HOSTED_PROMPT_PROVIDER_REJECTED",
        additionalKnownCostMicroUsd: expect.any(Number),
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(recordResult).toHaveBeenCalledTimes(1);
    },
  );
});
