import { describe, expect, it, vi } from "vitest";

import type { HostedGenerationPersistence } from "./generation-coordinator";
import { HostedCanonicalTimingPersistence } from "./generation-persistence";
import { sha256Bytes } from "./crypto";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const transcriptBytes = new TextEncoder().encode('{"transcript":true}');
  const timelineBytes = new TextEncoder().encode('{"timeline":true}');
  const transcriptHash = await sha256Bytes(transcriptBytes);
  const timelineHash = await sha256Bytes(timelineBytes);
  const preparedTranscript = {
    asrInputHash: `sha256:${"a".repeat(64)}`,
    asrResultHash: `sha256:${"b".repeat(64)}`,
    transcriptId: "77777777-7777-4777-8777-777777777777",
    transcriptDocumentAssetId: "88888888-8888-4888-8888-888888888888",
    transcriptDocumentHash: transcriptHash,
    transcriptionConfigHash: `sha256:${"c".repeat(64)}`,
    inputFingerprintHash: `sha256:${"d".repeat(64)}`,
    canonicalDocumentWrite: {
      objectKey: `workspace/${WORKSPACE}/project/44444444-4444-4444-8444-444444444444/revision/55555555-5555-4555-8555-555555555555/transcript/${transcriptHash.slice(7)}.json`,
      bytes: transcriptBytes,
      binarySha256: transcriptHash,
    },
    artifactRegistration: { metadata: {} },
    transcriptPersistence: {
      sourceAssetId: "99999999-9999-4999-8999-999999999999",
      modelName: "base.en",
      modelSha256: `sha256:${"e".repeat(64)}`,
      sourceDurationMs: 12_000,
      sourceBinarySha256: `sha256:${"f".repeat(64)}`,
      engineName: "whisper.cpp",
      engineVersion: "1.8.4",
      language: "en",
      transcriptionConfigHash: `sha256:${"c".repeat(64)}`,
      optionalScriptHash: null,
      inputFingerprintHash: `sha256:${"d".repeat(64)}`,
      idempotencyKey: "hosted-transcript-fixture",
      createdAt: "2026-08-25T12:00:00.000Z",
      words: [],
      sentences: [],
      phrases: [],
    },
  };
  const preparedTimeline = {
    timelinePlanId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    timelineDocumentAssetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    timelineDocumentHash: timelineHash,
    canonicalDocumentWrite: {
      objectKey: `workspace/${WORKSPACE}/project/44444444-4444-4444-8444-444444444444/revision/55555555-5555-4555-8555-555555555555/timeline/${timelineHash.slice(7)}.json`,
      bytes: timelineBytes,
      binarySha256: timelineHash,
    },
    artifactRegistration: { metadata: {} },
    timelinePersistence: {
      transcriptId: preparedTranscript.transcriptId,
      revisionConfigHash: `sha256:${"1".repeat(64)}`,
      transcriptDocumentHash: transcriptHash,
      schedulerVersion: "scheduler-v2",
      schedulerConfigHash: `sha256:${"2".repeat(64)}`,
      seed: 1n,
      inputFingerprintHash: `sha256:${"3".repeat(64)}`,
      idempotencyKey: "hosted-timeline-fixture",
      totalFrames: 360,
      createdAt: "2026-08-25T12:00:00.000Z",
      segments: [],
      selectedSpanAudio: [],
    },
  };
  return { preparedTranscript, preparedTimeline };
}

describe("hosted canonical timing persistence", () => {
  it("conditionally writes tenant-prefixed canonical bytes, rehashes readback, then invokes only the append function", async () => {
    const prepared = await fixture();
    const objects = new Map<string, ArrayBuffer>();
    const put = vi.fn(async (key: string, value: ArrayBuffer, options: unknown) => {
      expect(options).toMatchObject({ onlyIf: { etagDoesNotMatch: "*" } });
      if (objects.has(key)) throw new Error("precondition");
      objects.set(key, value);
    });
    let appendCalls = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("videoforge_append_hosted_canonical_timing")) {
        appendCalls += 1;
        return { rows: [{ replayed: appendCalls > 1 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const connection = { query, release: vi.fn() };
    const pool = { query, connect: async () => connection };
    const bucket = {
      put,
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes
          ? {
              size: bytes.byteLength,
              httpMetadata: { contentType: "application/json" },
              async arrayBuffer() {
                return bytes;
              },
            }
          : null;
      },
    };
    const persistence = new HostedCanonicalTimingPersistence(pool as never, bucket as never);
    const input = {
      snapshot: {
        accountId: ACCOUNT,
        workspaceId: WORKSPACE,
        userId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
        projectRevisionId: "55555555-5555-4555-8555-555555555555",
        asrAttemptId: "66666666-6666-4666-8666-666666666666",
        asrInputSha256: `sha256:${"a".repeat(64)}`,
        asrOutputSha256: `sha256:${"b".repeat(64)}`,
      },
      preparedTranscript: prepared.preparedTranscript,
      preparedTimeline: prepared.preparedTimeline,
      generationPlanSha256: `sha256:${"4".repeat(64)}`,
      tasks: [],
    } as unknown as Parameters<HostedGenerationPersistence["persistProviderInertPlan"]>[0];
    await expect(persistence.persistProviderInertPlan(input)).resolves.toEqual({ replayed: false });
    await expect(persistence.persistProviderInertPlan(input)).resolves.toEqual({ replayed: true });
    expect([...objects.keys()]).toHaveLength(2);
    expect(
      [...objects.keys()].every((key) =>
        key.startsWith(`tenant/${ACCOUNT}/workspace/${WORKSPACE}/`),
      ),
    ).toBe(true);
    const sql = query.mock.calls.map(([value]) => value).join("\n");
    expect(sql).toContain("videoforge_append_hosted_canonical_timing");
    expect(sql).not.toMatch(/generation_requests|outbox|authority|serverless_attempts/iu);
    expect(appendCalls).toBe(2);
    expect(put).toHaveBeenCalledTimes(4);
  });

  it("fails before the database when an existing canonical key contains foreign bytes", async () => {
    const prepared = await fixture();
    const foreign = new TextEncoder().encode('{"foreign":true}').buffer;
    const query = vi.fn();
    const pool = { query, connect: vi.fn() };
    const bucket = {
      async put() {
        throw new Error("precondition");
      },
      async get() {
        return {
          size: foreign.byteLength,
          httpMetadata: { contentType: "application/json" },
          async arrayBuffer() {
            return foreign;
          },
        };
      },
    };
    const persistence = new HostedCanonicalTimingPersistence(pool as never, bucket as never);
    const input = {
      snapshot: {
        accountId: ACCOUNT,
        workspaceId: WORKSPACE,
        userId: "33333333-3333-4333-8333-333333333333",
        projectId: "44444444-4444-4444-8444-444444444444",
        projectRevisionId: "55555555-5555-4555-8555-555555555555",
        asrAttemptId: "66666666-6666-4666-8666-666666666666",
        asrInputSha256: `sha256:${"a".repeat(64)}`,
        asrOutputSha256: `sha256:${"b".repeat(64)}`,
      },
      preparedTranscript: prepared.preparedTranscript,
      preparedTimeline: prepared.preparedTimeline,
      generationPlanSha256: `sha256:${"4".repeat(64)}`,
      tasks: [],
    } as unknown as Parameters<HostedGenerationPersistence["persistProviderInertPlan"]>[0];
    await expect(persistence.persistProviderInertPlan(input)).rejects.toMatchObject({
      code: "HOSTED_CANONICAL_TIMING_OBJECT_READBACK_MISMATCH",
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
