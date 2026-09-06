import { describe, expect, it, vi } from "vitest";

import type { HostedR2BucketBinding } from "./configuration";
import { ensureHostedV209ExactManifestObject } from "./hosted-v209-render-handoff";

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
