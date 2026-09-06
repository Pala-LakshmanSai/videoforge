import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";
import { digestUtf8 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import { materializeV209OrdinaryWorkerRequest } from "./hosted-v209-ordinary-worker-request";

const issuedAt = "2026-09-06T01:00:00.000Z";
const soulxExpiresAt = "2026-09-06T02:00:00.000Z";
const mageExpiresAt = "2026-09-06T03:00:00.000Z";
const accountId = "account-a";
const workspaceId = "workspace-a";
const attemptId = "attempt-a";
const outputPrefix =
  "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/attempt-a";

function signer(expiresAt: string) {
  return {
    sign: vi.fn(async (input: Record<string, unknown>) => ({
      method: "GET",
      url: `https://signed.example/${String(input.objectKey)}?at=${issuedAt}`,
      requiredHeaders: {},
      expiresAt,
      contentType: input.contentType,
      contentLength: input.contentLength,
      checksumSha256: input.checksumSha256,
    })),
    signGenerated: vi.fn(async (input: Record<string, unknown>) => ({
      method: "PUT",
      url: `https://signed.example/${String(input.objectKey)}?at=${issuedAt}`,
      requiredHeaders: { "content-type": String(input.contentType) },
      expiresAt,
      contentType: input.contentType,
      maxContentLength: input.maxContentLength,
    })),
  };
}

function envelope(
  lane: "mage_image" | "soulx_avatar",
  count: number,
  prefix: string,
  reservations: readonly string[],
  expiresAt: string,
) {
  return {
    ...structuredClone(validEnvelope),
    tenant: { account_id: accountId, workspace_id: workspaceId },
    work: { ...validEnvelope.work, attempt_id: attemptId, lane, item_count: count },
    artifacts: {
      ...validEnvelope.artifacts,
      output_prefix: prefix,
      transfer_port_reservation_ids: reservations,
    },
    limits: { ...validEnvelope.limits, expires_at: expiresAt, max_items: count },
  };
}

describe("ordinary V2-09 immutable worker request", () => {
  it("builds the exact Mage handler body with prompts and generated PUTs only", async () => {
    const positive = "authentic documentary still";
    const negative = "text, logo, watermark";
    const outputReservationId = "mage-output-a";
    const work = [
      {
        taskId: "mage-task-a",
        outputPrefix,
        outputReservationId,
        positivePromptSha256: digestUtf8(positive),
        negativePromptSha256: digestUtf8(negative),
        compiledPrompt: {
          positivePrompt: positive,
          negativePrompt: negative,
          positivePromptSha256: digestUtf8(positive),
          negativePromptSha256: digestUtf8(negative),
        },
      },
    ];
    const ports = signer(mageExpiresAt);
    const result = await materializeV209OrdinaryWorkerRequest(
      {
        lane: "mage_image",
        accountId,
        workspaceId,
        attemptId,
        issuedAt,
        expiresAt: mageExpiresAt,
        envelope: envelope("mage_image", 1, outputPrefix, [outputReservationId], mageExpiresAt),
        work,
      },
      ports as never,
    );
    expect(result.requestBodySha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.body).toMatchObject({
      batch: {
        attempt_id: attemptId,
        items: [
          {
            scene_id: "mage-task-a",
            positive_prompt: positive,
            negative_prompt: negative,
            width: 1280,
            height: 720,
          },
        ],
      },
      ports: { inputs: [], outputs: [] },
      input_get_urls: [],
    });
    expect(ports.sign).not.toHaveBeenCalled();
    expect(ports.signGenerated).toHaveBeenCalledOnce();
  });

  it("builds SoulX with one avatar GET, exact 48k span GETs, and sample bounds", async () => {
    const prefix = outputPrefix.replace("mage-image", "soulx-avatar");
    const avatarReservation = "avatar-input-a";
    const spanReservation = "span-input-a";
    const outputReservation = "soulx-output-a";
    const work = [
      {
        taskId: "soulx-task-a",
        outputPrefix: prefix,
        outputReservationId: outputReservation,
        avatarSourceAssetId: "avatar-asset-a",
        avatarSourceObjectKey:
          "tenant/account-a/workspace/workspace-a/avatar-profile/profile-a/version/version-a/canonical/avatar.png",
        avatarSourceContentType: "image/png",
        avatarSourceContentLength: 1024,
        avatarSourceSha256: `sha256:${"1".repeat(64)}`,
        spanAudioAssetId: "span-asset-a",
        spanAudioInputReservationId: spanReservation,
        spanAudioObjectKey:
          "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/span-a/artifact/audio",
        spanAudioContentType: "audio/wav",
        spanAudioContentLength: 288044,
        spanAudioSha256: `sha256:${"2".repeat(64)}`,
        spanAudioSampleRateHz: 48000,
        spanAudioChannels: 1,
        paddedSamples48k: 144000,
        trimStartSample48k: 9600,
        trimEndSampleExclusive48k: 105600,
      },
    ];
    const ports = signer(soulxExpiresAt);
    const result = await materializeV209OrdinaryWorkerRequest(
      {
        lane: "soulx_avatar",
        accountId,
        workspaceId,
        attemptId,
        issuedAt,
        expiresAt: soulxExpiresAt,
        envelope: envelope("soulx_avatar", 1, prefix, [
          avatarReservation,
          spanReservation,
          outputReservation,
        ], soulxExpiresAt),
        work,
        avatarSourceInputReservationId: avatarReservation,
      },
      ports as never,
    );
    expect(result.body).toMatchObject({
      batch: {
        schema_version: "videoforge-soulx-span-batch/v1",
        avatar_source: { port_reservation_id: avatarReservation },
        spans: [
          {
            item_id: "soulx-task-a",
            audio_port_reservation_id: spanReservation,
            padded_samples_48k: 144000,
            trim_start_sample_48k: 9600,
            trim_end_sample_exclusive_48k: 105600,
          },
        ],
      },
    });
    expect(ports.sign).toHaveBeenCalledTimes(2);
    expect(ports.signGenerated).toHaveBeenCalledOnce();
  });

  it("fails before signing when a 16k span is supplied", async () => {
    const ports = signer(soulxExpiresAt);
    await expect(
      materializeV209OrdinaryWorkerRequest(
        {
          lane: "soulx_avatar",
          accountId,
          workspaceId,
          attemptId,
          issuedAt,
          expiresAt: soulxExpiresAt,
          envelope: envelope("soulx_avatar", 1, outputPrefix, ["output-a"], soulxExpiresAt),
          work: [
            {
              taskId: "soulx-task-a",
              outputPrefix,
              outputReservationId: "output-a",
              spanAudioSampleRateHz: 16000,
            },
          ],
          avatarSourceInputReservationId: "avatar-input-a",
        },
        ports as never,
      ),
    ).rejects.toThrow("HOSTED_V209_ORDINARY_WORKER_REQUEST_INVALID");
    expect(ports.sign).not.toHaveBeenCalled();
    expect(ports.signGenerated).not.toHaveBeenCalled();
  });

  it("rejects a one-hour Mage authority before signing", async () => {
    const ports = signer(soulxExpiresAt);
    await expect(
      materializeV209OrdinaryWorkerRequest(
        {
          lane: "mage_image",
          accountId,
          workspaceId,
          attemptId,
          issuedAt,
          expiresAt: soulxExpiresAt,
          envelope: envelope("mage_image", 1, outputPrefix, ["output-a"], soulxExpiresAt),
          work: [{ taskId: "mage-task-a", outputPrefix, outputReservationId: "output-a" }],
        },
        ports as never,
      ),
    ).rejects.toThrow("HOSTED_V209_ORDINARY_WORKER_REQUEST_INVALID");
    expect(ports.sign).not.toHaveBeenCalled();
    expect(ports.signGenerated).not.toHaveBeenCalled();
  });
});
