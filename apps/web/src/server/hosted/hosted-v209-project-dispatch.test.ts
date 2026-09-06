import { sha256CanonicalJson } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";

import { handleHostedV209ProjectDispatch } from "./hosted-v209-project-dispatch";

const id = (digit: string) =>
  `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const sha = (digit: string) => `sha256:${digit.repeat(64)}` as `sha256:${string}`;
const projectId = id("4");
const scope = { user_id: id("1"), account_id: id("2"), workspace_id: id("3") };
const config = {
  environment: "production",
  gpuTransport: "QUALIFIED_EXACT",
  publicOrigin: "https://videoforge.example",
  neon: { databaseUrl: "postgres://runtime.invalid/db" },
} as never;

async function candidate(pairExists = false) {
  const revisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const mageAttemptId = "12121212-1212-4212-8212-121212121212";
  const soulxAttemptId = "34343434-3434-4434-8434-343434343434";
  const magePrefix = `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}/revision/${revisionId}/lane/mage-image/job/${mageAttemptId}`;
  const soulxPrefix = `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}/revision/${revisionId}/lane/soulx-avatar/job/${soulxAttemptId}`;
  const work = {
    mage_image: [
      {
        taskId: id("5"),
        segmentId: id("6"),
        role: "image",
        promptResultId: id("7"),
        promptSha256: sha("1"),
        compiledPrompt: { positivePrompt: "documentary still" },
        positivePromptSha256: sha("8"),
        negativePromptSha256: sha("9"),
        styleVersionId: id("8"),
        styleProfileSha256: sha("2"),
        inputReservationId: id("9"),
        outputReservationId: id("a"),
        outputPrefix: magePrefix,
      },
    ],
    soulx_avatar: [
      {
        taskId: id("b"),
        segmentId: id("c"),
        role: "avatar",
        spanAudioId: id("d"),
        spanAudioAssetId: id("1"),
        spanAudioInputReservationId: id("0"),
        spanAudioObjectKey: `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}/revision/${revisionId}/lane/input/job/${id("d")}/artifact/span-audio`,
        spanAudioContentType: "audio/wav",
        spanAudioContentLength: 288_044,
        spanAudioSampleRateHz: 48_000,
        spanAudioChannels: 1,
        spanAudioSha256: sha("3"),
        sourceVoiceoverAssetId: id("e"),
        sourceVoiceoverSha256: sha("4"),
        avatarSourceAssetId: id("f"),
        avatarSourceSha256: sha("5"),
        outputReservationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceVoiceoverObjectKey: `tenant/${scope.account_id}/workspace/${scope.workspace_id}/project/${projectId}/revision/${revisionId}/lane/input/job/${id("d")}/artifact/voiceover`,
        sourceVoiceoverContentType: "audio/wav",
        sourceVoiceoverContentLength: 96_000,
        avatarSourceObjectKey: `tenant/${scope.account_id}/workspace/${scope.workspace_id}/avatar-profile/${id("e")}/version/${id("f")}/canonical/avatar.png`,
        avatarSourceContentType: "image/png",
        avatarSourceContentLength: 1024,
        selectedStartMs: 0,
        selectedEndMsExclusive: 1_000,
        paddedStartMs: 0,
        paddedEndMsExclusive: 3_000,
        trimStartMs: 0,
        trimEndMsExclusive: 1_000,
        paddedSamples48k: 144_000,
        trimStartSample48k: 0,
        trimEndSampleExclusive48k: 48_000,
        outputPrefix: soulxPrefix,
      },
    ],
  };
  const generationRequestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const base = {
    schemaVersion: "videoforge.hosted-v209-ordinary-dispatch/v1",
    accountId: scope.account_id,
    workspaceId: scope.workspace_id,
    projectId,
    projectRevisionId: revisionId,
    generationRequestId,
    generationPlanSha256: sha("6"),
    leaseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    approvalId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    approvalSha256: sha("7"),
    expiresAt: "2026-09-06T01:40:00.000Z",
    totalCapUsd: 2,
    avatarSourceInputReservationId: "abababab-abab-4bab-8bab-abababababab",
    laneBindings: [{ lane: "mage_image" }, { lane: "soulx_avatar" }],
    pair: [{ lane: "mage_image" }, { lane: "soulx_avatar" }],
    batches: [
      { lane: "mage_image", output_prefix: magePrefix },
      { lane: "soulx_avatar", output_prefix: soulxPrefix },
    ],
    renderPlan: { output: { fps: 30 } },
    workManifestSha256: await sha256CanonicalJson(work),
    work,
  };
  return {
    ...base,
    candidateSha256: await sha256CanonicalJson(base),
    replayed: pairExists,
    pairExists,
    existingWorkflowId: pairExists ? `hosted-pair-${generationRequestId}` : null,
  };
}

function observation() {
  return {
    databaseNow: "2026-09-06T01:00:00.000Z",
    providerObservedAt: "2026-09-06T00:59:30.000Z",
    rate: {
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "LOW",
      secureReferenceRateMicroUsdPerGpuHour: 740_000,
      flexRateMicroUsdPerGpuHour: 1_116_000,
      checkedAt: "2026-09-06T00:59:30.000Z",
    },
    billing: {
      cumulativeEndpointBillingMicroUsd: 3_500_000,
      checkedAt: "2026-09-06T00:59:30.000Z",
    },
    phaseCapMicroUsd: 2_000_000,
    combinedCompletionCapMicroUsd: 17_500_000,
    redispatchAuthorized: false,
  } as const;
}

function request(body = "{}", origin = "https://videoforge.example") {
  return new Request(
    `https://videoforge.example/api/v2/hosted/projects/${projectId}/gpu-dispatch`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body,
    },
  );
}

function dependencies(value: Awaited<ReturnType<typeof candidate>>) {
  const runtime = { end: vi.fn(async () => undefined) };
  const reconciler = { end: vi.fn(async () => undefined) };
  const createPool = vi.fn().mockReturnValueOnce(runtime).mockReturnValueOnce(reconciler);
  const materialize = vi.fn(async () => value);
  const observe = vi.fn(async () => observation());
  const commitAndSchedule = vi.fn(async () => ({
    id: `hosted-pair-${value.generationRequestId}`,
    recovered: false,
  }));
  const ensureWorkflow = vi.fn(async () => ({
    id: `hosted-pair-${value.generationRequestId}`,
    recovered: true,
  }));
  return {
    runtime,
    reconciler,
    materialize,
    observe,
    commitAndSchedule,
    ensureWorkflow,
    value: {
      createPool,
      createExecutor: (pool: unknown) => pool,
      scope: vi.fn(async () => scope),
      materialize,
      observe,
      commitAndSchedule,
      ensureWorkflow,
      correlationId: () => "v209-safe-correlation",
    } as never,
  };
}

describe("ordinary authenticated V2-09 project dispatch", () => {
  it("loads only DB-owned identity, takes one observation, and schedules one workflow", async () => {
    const prepared = await candidate();
    const deps = dependencies(prepared);
    const response = await handleHostedV209ProjectDispatch(
      request(),
      { VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres://reconciler.invalid/db" } as never,
      config,
      {} as never,
      deps.value,
    );
    if (!response) throw new Error("route not matched");
    expect(response.status).toBe(202);
    expect(response.headers.get("x-videoforge-correlation-id")).toBe("v209-safe-correlation");
    expect(deps.materialize).toHaveBeenCalledWith(expect.anything(), {
      accountId: scope.account_id,
      workspaceId: scope.workspace_id,
      userId: scope.user_id,
      projectId,
    });
    expect(deps.observe).toHaveBeenCalledTimes(1);
    expect(deps.commitAndSchedule).toHaveBeenCalledTimes(1);
    expect(deps.runtime.end).toHaveBeenCalledOnce();
    expect(deps.reconciler.end).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      schema_version: "videoforge-hosted-v209-project-dispatch/v1",
      state: "SCHEDULED",
      generation_request_id: prepared.generationRequestId,
      workflow_id: `hosted-pair-${prepared.generationRequestId}`,
      correlation_id: "v209-safe-correlation",
    });
  });

  it("retrieves an existing deterministic workflow without observation or redispatch", async () => {
    const prepared = await candidate(true);
    const deps = dependencies(prepared);
    const response = await handleHostedV209ProjectDispatch(
      request(),
      { VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres://reconciler.invalid/db" } as never,
      config,
      {} as never,
      deps.value,
    );
    if (!response) throw new Error("route not matched");
    expect(response.status).toBe(200);
    expect(deps.ensureWorkflow).toHaveBeenCalledOnce();
    expect(deps.observe).not.toHaveBeenCalled();
    expect(deps.commitAndSchedule).not.toHaveBeenCalled();
  });

  it("rejects cross-origin or non-empty browser authority before database materialization", async () => {
    const prepared = await candidate();
    const crossOrigin = dependencies(prepared);
    const crossOriginResponse = await handleHostedV209ProjectDispatch(
      request("{}", "https://attacker.example"),
      {} as never,
      config,
      {} as never,
      crossOrigin.value,
    );
    expect(crossOriginResponse?.status).toBe(403);
    expect(crossOrigin.materialize).not.toHaveBeenCalled();

    const forged = dependencies(prepared);
    const forgedResponse = await handleHostedV209ProjectDispatch(
      request('{"approvalId":"forged"}'),
      {} as never,
      config,
      {} as never,
      forged.value,
    );
    expect(forgedResponse?.status).toBe(400);
    expect(forged.materialize).not.toHaveBeenCalled();
  });

  it("fails closed on candidate hash drift before provider observation", async () => {
    const prepared = { ...(await candidate()), candidateSha256: sha("f") };
    const deps = dependencies(prepared);
    const response = await handleHostedV209ProjectDispatch(
      request(),
      { VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres://reconciler.invalid/db" } as never,
      config,
      {} as never,
      deps.value,
    );
    if (!response) throw new Error("route not matched");
    expect(response.status).toBe(409);
    expect(deps.observe).not.toHaveBeenCalled();
    expect(deps.commitAndSchedule).not.toHaveBeenCalled();
  });
});
