import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration";
import { ensureHostedV209ExactManifestObject } from "./hosted-v209-render-handoff";
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
