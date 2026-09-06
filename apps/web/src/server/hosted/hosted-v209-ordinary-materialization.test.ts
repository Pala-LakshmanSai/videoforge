import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";
import { digestUtf8 } from "@videoforge/control-plane";
import { sha256CanonicalJson } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";

import { createHostedEnvelopePairSigner } from "./hosted-envelope-signer";
import { HostedSqlV209OrdinaryLaneMaterializer } from "./hosted-v209-ordinary-materialization";

const issuedAt = "2026-09-06T01:00:00.000Z";
const sha = (digit: string) => `sha256:${digit.repeat(64)}`;

function unsignedEnvelope(lane: "mage_image" | "soulx_avatar", reservations: readonly string[]) {
  const value = structuredClone(validEnvelope) as Record<string, unknown>;
  delete value.authority_sha256;
  delete value.signature;
  value.dispatch_token = `${lane}-dispatch-token-${"x".repeat(24)}`;
  value.work = {
    ...(value.work as object),
    attempt_id: `${lane}-attempt`,
    generation_request_id: "generation-request",
    task_id: `${lane}-task`,
    lane,
    item_count: 1,
  };
  value.artifacts = {
    ...(value.artifacts as object),
    output_prefix: `tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/${lane === "mage_image" ? "mage-image" : "soulx-avatar"}/job/${lane}-attempt`,
    transfer_port_reservation_ids: reservations,
    plan_manifest_sha256: sha("9"),
  };
  value.limits = { ...(value.limits as object), max_items: 1 };
  return value;
}

describe("ordinary V2-09 pair request materialization", () => {
  it("uses DB lane times, binds the exact SoulX batch hash, and CASes both bodies", async () => {
    const mageWork = [{
      taskId: "mage-task",
      outputPrefix: "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/mage_image-attempt",
      outputReservationId: "mage-output",
      positivePromptSha256: digestUtf8("documentary still"),
      negativePromptSha256: digestUtf8("text, logo"),
      compiledPrompt: {
        positivePrompt: "documentary still",
        negativePrompt: "text, logo",
        positivePromptSha256: digestUtf8("documentary still"),
        negativePromptSha256: digestUtf8("text, logo"),
      },
    }];
    const soulxPrefix = "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/soulx-avatar/job/soulx_avatar-attempt";
    const soulxWork = [{
      taskId: "soulx-task",
      outputPrefix: soulxPrefix,
      outputReservationId: "soulx-output",
      avatarSourceAssetId: "avatar-asset",
      avatarSourceObjectKey: "tenant/account-a/workspace/workspace-a/avatar-profile/profile-a/version/version-a/canonical/avatar.png",
      avatarSourceContentType: "image/png",
      avatarSourceContentLength: 100,
      avatarSourceSha256: sha("1"),
      spanAudioAssetId: "span-asset",
      spanAudioInputReservationId: "span-input",
      spanAudioObjectKey: "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/span-job/artifact/audio",
      spanAudioContentType: "audio/wav",
      spanAudioContentLength: 192044,
      spanAudioSha256: sha("2"),
      spanAudioSampleRateHz: 48000,
      spanAudioChannels: 1,
      paddedSamples48k: 96000,
      trimStartSample48k: 0,
      trimEndSampleExclusive48k: 96000,
    }];
    const projections = {
      mage_image: unsignedEnvelope("mage_image", ["mage-output"]),
      soulx_avatar: unsignedEnvelope("soulx_avatar", ["avatar-input", "span-input", "soulx-output"]),
    } as const;
    const commits: Record<string, unknown>[] = [];
    const query = vi.fn(async (sql: string, values: readonly unknown[] = []) => {
      if (sql.includes("load_hosted_v209_ordinary_lane_materialization")) {
        const lane = values[3] as keyof typeof projections;
        const template = projections[lane];
        return { rows: [{ value: {
          schemaVersion: "videoforge.hosted-v209-ordinary-lane-materialization/v1",
          lane,
          attemptId: `${lane}-attempt`,
          deploymentId: "deployment-mage-1",
          endpointIdSha256: sha("3"),
          dispatchToken: template.dispatch_token,
          dispatchTokenSha256: sha("4"),
          envelopeTemplate: template,
          baseEnvelopeTemplateSha256: await sha256CanonicalJson(template),
          issuedAt,
          expiresAt: lane === "mage_image" ? "2026-09-06T03:00:00.000Z" : "2026-09-06T02:00:00.000Z",
          work: lane === "mage_image" ? mageWork : soulxWork,
          avatarSourceInputReservationId: "avatar-input",
        } }] };
      }
      if (sql.includes("commit_hosted_v209_ordinary_lane_materialization")) {
        const body = JSON.parse(String(values[6])) as Record<string, unknown>;
        commits.push(body);
        return { rows: [{ value: {
          requestBodySha256: values[7],
          envelopeSha256: values[5],
          replayed: false,
        } }] };
      }
      return { rows: [] };
    });
    const database = { transaction: vi.fn(async (fn: (tx: { query: typeof query }) => unknown) => fn({ query })) };
    const r2 = {
      sign: vi.fn(async (input: Record<string, unknown>) => ({
        url: `https://signed.example/${String(input.objectKey)}`,
        expiresAt: new Date(Date.parse(issuedAt) + Number(input.lifetimeSeconds) * 1000).toISOString(),
      })),
      signGenerated: vi.fn(async (input: Record<string, unknown>) => ({
        url: `https://signed.example/${String(input.objectKey)}`,
        expiresAt: new Date(Date.parse(issuedAt) + Number(input.lifetimeSeconds) * 1000).toISOString(),
        contentType: input.contentType,
      })),
    };
    const result = await new HostedSqlV209OrdinaryLaneMaterializer(
      database as never,
      createHostedEnvelopePairSigner({ secretHex: "11".repeat(32), keyId: "envelope-key" }),
      r2 as never,
    ).bindPair({
      accountId: "account-a",
      workspaceId: "workspace-a",
      generationRequestId: "generation-request",
      dispatchTokenKey: "dispatch-key-material-012345678901",
    });
    expect(result.map((item) => item.lane)).toEqual(["mage_image", "soulx_avatar"]);
    const soulx = commits[1] as { envelope: Record<string, Record<string, unknown>>; batch: unknown };
    const batchSha = await sha256CanonicalJson(soulx.batch as never);
    expect(soulx.envelope.work!.items_manifest_sha256).toBe(batchSha);
    expect(soulx.envelope.artifacts!.plan_manifest_sha256).toBe(batchSha);
    expect(commits[0]?.envelope).toMatchObject({
      limits: { issued_at: issuedAt, expires_at: "2026-09-06T03:00:00.000Z" },
    });
    expect(r2.signGenerated).toHaveBeenCalledWith(expect.objectContaining({ lifetimeSeconds: 7200 }));
  });
});
