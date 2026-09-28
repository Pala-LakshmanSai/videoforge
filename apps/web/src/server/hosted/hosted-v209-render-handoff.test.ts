import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration";
import { ensureHostedV209ExactManifestObject, loadHostedCloudRecoveryVoiceoverOrigin } from "./hosted-v209-render-handoff";
import { readHostedV209TimingDocument } from "./hosted-v209-render-handoff";
import { canonicalizeJson } from "@videoforge/contracts";
import transcriptFixture from "../../../../../packages/contracts/generated/fixtures/transcript_timing.valid.json";

const encoder = new TextEncoder();

async function digest(bytes: ArrayBuffer): Promise<`sha256:${string}`> {
  const value = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function buffer(value: string): ArrayBuffer {
  const bytes = encoder.encode(value);
  const result = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(result).set(bytes);
  return result;
}

function bucket(initial?: ArrayBuffer): HostedR2BucketBinding & { put: ReturnType<typeof vi.fn> } {
  let stored = initial;
  const put = vi.fn(async (_key: string, value: ReadableStream | ArrayBuffer | string) => {
    stored = await new Response(value).arrayBuffer();
  });
  return {
    put,
    async head() {
      return stored
        ? { size: stored.byteLength, httpMetadata: { contentType: "application/json" } }
        : null;
    },
    async get() {
      return stored
        ? {
            size: stored.byteLength,
            httpMetadata: { contentType: "application/json" },
            async arrayBuffer() {
              return stored!.slice(0);
            },
          }
        : null;
    },
    async list() {
      return { objects: [], truncated: false };
    },
    async delete() {},
  };
}

describe("hosted V2-09 render manifest R2 handoff", () => {
  it("loads the canonical transcript instead of validating its relational projection", async () => {
    const bytes = buffer(canonicalizeJson(transcriptFixture));
    const hash = await digest(bytes);
    const projection = {
      row: {},
      words: "relational rows",
      asset: { object_key: "tenant/revision/transcript.json", hash, byte_size: bytes.byteLength },
    };
    const document = await readHostedV209TimingDocument(
      bucket(bytes),
      "transcriptTiming",
      projection,
      hash,
      "tenant/revision/",
    );
    expect(document.value).toEqual(transcriptFixture);
    expect(document.sha256).toBe(hash);
    await expect(
      readHostedV209TimingDocument(
        bucket(buffer("drift")),
        "transcriptTiming",
        projection,
        hash,
        "tenant/revision/",
      ),
    ).rejects.toThrow("TIMING_OBJECT_INVALID");
    await expect(
      readHostedV209TimingDocument(
        bucket(bytes),
        "transcriptTiming",
        projection,
        hash,
        "another/revision/",
      ),
    ).rejects.toThrow("TIMING_BINDING_INVALID");
  });
  it("writes once, reads bytes back, and replays without overwriting", async () => {
    const bytes = buffer('{"schema_version":"resolved-render-manifest/v3"}');
    const sha256 = await digest(bytes);
    const target = bucket();
    await ensureHostedV209ExactManifestObject(target, "tenant/exact.json", bytes, sha256);
    await ensureHostedV209ExactManifestObject(target, "tenant/exact.json", bytes, sha256);
    expect(target.put).toHaveBeenCalledTimes(1);
  });

  it("fails closed before PUT when a prior object occupies the deterministic key", async () => {
    const expected = buffer("expected");
    const target = bucket(buffer("drifted"));
    await expect(
      ensureHostedV209ExactManifestObject(
        target,
        "tenant/exact.json",
        expected,
        await digest(expected),
      ),
    ).rejects.toThrow("HOSTED_V209_RENDER_MANIFEST_DRIFT");
    expect(target.put).not.toHaveBeenCalled();
  });
});

it("accepts retained voiceover origin only after the exact durable recovery reference read",async()=>{
  const ids={accountId:"11111111-1111-4111-8111-111111111111",workspaceId:"22222222-2222-4222-8222-222222222222",
    projectId:"33333333-3333-4333-8333-333333333333",revisionId:"44444444-4444-4444-8444-444444444444"};
  const source={receiptId:"55555555-5555-4555-8555-555555555555",assetId:"66666666-6666-4666-8666-666666666666",
    objectKey:"exact-private-input",sha256:`sha256:${"a".repeat(64)}`,contentLength:100,contentType:"audio/mpeg"};
  const query=vi.fn(async (sql:string)=>({rows:sql.includes("cloud_media_asr_recoveries")?[{origin_revision_id:"77777777-7777-4777-8777-777777777777"}]:[],affectedRows:0}));
  const database={transaction:async (work:(sql:unknown)=>unknown)=>work({query})} as unknown as import("@videoforge/control-plane").TransactionalSqlExecutor;
  expect(await loadHostedCloudRecoveryVoiceoverOrigin(database,ids,source)).toBe("77777777-7777-4777-8777-777777777777");
  expect(query.mock.calls[1]?.[0]).toContain("asset.id=revision.voiceover_asset_id");
  query.mockResolvedValue({rows:[],affectedRows:0});
  await expect(loadHostedCloudRecoveryVoiceoverOrigin(database,ids,source)).rejects.toThrow("HOSTED_V209_RENDER_INPUT_INVALID");
});
