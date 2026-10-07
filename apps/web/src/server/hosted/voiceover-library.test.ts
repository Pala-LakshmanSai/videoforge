// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HostedR2BucketBinding } from "./configuration";
import { handleVoiceoverLibrary } from "./voiceover-library";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const audioBytes = new TextEncoder().encode("valid mp3 fixture bytes");
const audioChecksum = `sha256:${createHash("sha256").update(audioBytes).digest("hex")}`;
const audioChecksumBytes = new Uint8Array(Buffer.from(audioChecksum.slice(7), "hex")).buffer;
const objectKey = `tenant/${id(1)}/workspace/${id(11)}/voiceover/${id(101)}/${id(201)}.mp3`;

const row = {
  id: id(101),
  title: "Morning brief",
  voice_name: "A.J.",
  voice_id: "aj",
  state: "COMPLETED",
  filename: "morning-brief.mp3",
  created_at: "2026-10-07T08:00:00.000Z",
  script: "Good morning, everyone.",
  character_count: 23,
  duration_ms: 12_300,
  content_length: audioBytes.byteLength,
  checksum_sha256: audioChecksum,
  object_key: objectKey,
  creator_id: id(200),
  creator_name: "Alex",
  creator_email: "alex@example.test",
};

function bucketWithHeads(heads: Array<object | null> = [null], listedKeys: string[] = [objectKey]) {
  let headIndex = 0;
  const keys = new Set(listedKeys);
  const head = vi.fn(async () => {
    const value = heads[Math.min(headIndex++, heads.length - 1)];
    return value as Awaited<ReturnType<HostedR2BucketBinding["head"]>>;
  });
  const get = vi.fn(
    async (_key: string, options?: { range?: { offset: number; length: number } }) => {
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? audioBytes.byteLength;
      return {
        size: audioBytes.byteLength,
        httpMetadata: { contentType: "audio/mpeg" },
        body: new Response(audioBytes.slice(offset, offset + length)).body,
        arrayBuffer: async () => audioBytes.slice(offset, offset + length).buffer,
      };
    },
  );
  const remove = vi.fn(async (key: string | readonly string[]) => {
    for (const item of typeof key === "string" ? [key] : key) keys.delete(item);
  });
  const list = vi.fn(async ({ prefix }: { prefix: string }) => ({
    objects: [...keys].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
    truncated: false,
  }));
  return {
    bucket: { head, get, list, delete: remove } as unknown as HostedR2BucketBinding,
    head,
    get,
    list,
    remove,
  };
}

function readyHead() {
  return {
    size: audioBytes.byteLength,
    httpMetadata: { contentType: "audio/mpeg" },
    checksums: { sha256: audioChecksumBytes },
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  const authenticate = vi.fn(async () => ({
    token: "owner-token",
    email: "demo9gss@gmail.com",
    verified: true,
  }));
  const read = vi.fn(async () => ({
    voiceovers: [row],
    creators: [{ id: row.creator_id, name: row.creator_name, email: row.creator_email }],
    total: 1,
  }));
  const remove = vi.fn(
    async (_token: string, _centralized: boolean, _id: string, finalize: boolean) =>
      finalize ? { deleted: true } : { object_key: objectKey },
  );
  const fixture = bucketWithHeads([readyHead()]);
  return {
    publicOrigin: "https://studio.example.test",
    bucket: fixture.bucket,
    authenticate,
    read,
    remove,
    head: fixture.head,
    get: fixture.get,
    list: fixture.list,
    ...overrides,
  };
}

async function errorCode(response: Response) {
  return ((await response.json()) as { error?: { code?: string } }).error?.code;
}

describe("hosted voiceover library route", () => {
  it("requires authentication and keeps centralized content owner-only", async () => {
    const unauthenticated = deps({
      authenticate: vi.fn(async () =>
        Response.json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 }),
      ),
    });
    const unauthenticatedResponse = await handleVoiceoverLibrary(
      new Request("https://studio.example.test/api/v2/voiceovers/library"),
      unauthenticated,
    );
    expect(unauthenticatedResponse.status).toBe(401);

    const foreign = deps({
      authenticate: vi.fn(async () => ({
        token: "member-token",
        email: "alex@example.test",
        verified: true,
      })),
    });
    const response = await handleVoiceoverLibrary(
      new Request("https://studio.example.test/api/v2/voiceovers/library?centralized=1"),
      foreign,
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("CENTRALIZED_LIBRARY_FORBIDDEN");
    expect(foreign.read).not.toHaveBeenCalled();
  });

  it("rejects malformed queries and cross-origin deletion before touching auth or storage", async () => {
    const malformed = deps();
    const longSearch = "x".repeat(201);
    for (const query of [`search=${longSearch}`, "creator=bad", "page=-1"]) {
      const response = await handleVoiceoverLibrary(
        new Request(`https://studio.example.test/api/v2/voiceovers/library?${query}`),
        malformed,
      );
      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("VOICEOVER_QUERY_INVALID");
    }
    expect(malformed.authenticate).not.toHaveBeenCalled();

    const crossOrigin = deps();
    const response = await handleVoiceoverLibrary(
      new Request(`https://studio.example.test/api/v2/voiceovers/library/${row.id}/delete`, {
        method: "POST",
        headers: { origin: "https://evil.example.test" },
      }),
      crossOrigin,
    );
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("HOSTED_BROWSER_ORIGIN_REJECTED");
    expect(crossOrigin.authenticate).not.toHaveBeenCalled();
    expect(crossOrigin.remove).not.toHaveBeenCalled();
  });

  it("lists only presentation fields and exposes exact authorized audio URLs", async () => {
    const fixture = deps();
    const response = await handleVoiceoverLibrary(
      new Request("https://studio.example.test/api/v2/voiceovers/library?centralized=1&page=0"),
      fixture,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      voiceovers: Array<Record<string, unknown>>;
      page: number;
      page_size: number;
    };
    expect(body.page).toBe(0);
    expect(body.page_size).toBe(48);
    expect(body.voiceovers[0]).not.toHaveProperty("object_key");
    expect(body.voiceovers[0]).not.toHaveProperty("checksum_sha256");
    expect(body.voiceovers[0]?.audio_url).toBe(
      `/api/v2/voiceovers/library/${row.id}/audio?centralized=1`,
    );
    expect(body.voiceovers[0]?.download_url).toBe(
      `/api/v2/voiceovers/library/${row.id}/audio?centralized=1&download=1`,
    );
  });

  it("does not claim an incomplete archive is ready", async () => {
    const fixture = deps({
      read: vi.fn(async () => ({
        voiceovers: [{ ...row, checksum_sha256: null, content_length: null }],
        creators: [],
        total: 1,
      })),
    });
    const response = await handleVoiceoverLibrary(
      new Request("https://studio.example.test/api/v2/voiceovers/library"),
      fixture,
    );
    const body = (await response.json()) as { voiceovers: Array<{ audio_url: string | null }> };
    expect(body.voiceovers[0]?.audio_url).toBeNull();
  });

  it("serves the exact authorized MP3 range inline and as a download", async () => {
    const fixture = deps();
    const range = await handleVoiceoverLibrary(
      new Request(
        `https://studio.example.test/api/v2/voiceovers/library/${row.id}/audio?centralized=1`,
        { headers: { range: "bytes=1-3" } },
      ),
      fixture,
    );
    expect(range.status).toBe(206);
    expect(range.headers.get("content-type")).toBe("audio/mpeg");
    expect(range.headers.get("content-range")).toBe(`bytes 1-3/${audioBytes.byteLength}`);
    expect(range.headers.get("content-disposition")).toBe('inline; filename="voiceover.mp3"');
    expect(new Uint8Array(await range.arrayBuffer())).toEqual(audioBytes.slice(1, 4));
    expect(fixture.read).toHaveBeenCalledWith("owner-token", true, row.id, "", null, 0);

    const download = await handleVoiceoverLibrary(
      new Request(
        `https://studio.example.test/api/v2/voiceovers/library/${row.id}/audio?download=1`,
      ),
      fixture,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe(
      'attachment; filename="morning-brief.mp3"',
    );
  });

  it("never finalizes deletion when post-delete head verification fails, then allows retry", async () => {
    const failing = bucketWithHeads([readyHead(), readyHead()]);
    const first = deps({
      bucket: failing.bucket,
      head: failing.head,
      remove: vi.fn(
        async (_token: string, _centralized: boolean, _id: string, finalize: boolean) =>
          finalize ? { deleted: true } : { object_key: objectKey },
      ),
    });
    const request = () =>
      handleVoiceoverLibrary(
        new Request(`https://studio.example.test/api/v2/voiceovers/library/${row.id}/delete`, {
          method: "POST",
          headers: { origin: "https://studio.example.test" },
        }),
        first,
      );
    const failed = await request();
    expect(failed.status).toBe(503);
    expect(first.remove).toHaveBeenCalledTimes(1);
    expect(first.remove).toHaveBeenLastCalledWith("owner-token", false, row.id, false);

    const retryHeads = bucketWithHeads([null]);
    const retry = deps({ bucket: retryHeads.bucket, head: retryHeads.head, remove: first.remove });
    const succeeded = await handleVoiceoverLibrary(
      new Request(`https://studio.example.test/api/v2/voiceovers/library/${row.id}/delete`, {
        method: "POST",
        headers: { origin: "https://studio.example.test" },
      }),
      retry,
    );
    expect(succeeded.status).toBe(204);
    expect(retry.remove).toHaveBeenCalledWith("owner-token", false, row.id, true);
  });

  it("removes abandoned claim objects under the exact job prefix before finalizing", async () => {
    const abandonedKey = `${objectKey.slice(0, objectKey.lastIndexOf("/") + 1)}${id(202)}.mp3`;
    const fixture = bucketWithHeads([null], [objectKey, abandonedKey]);
    const instance = deps({
      bucket: fixture.bucket,
      head: fixture.head,
      list: fixture.list,
    });
    const response = await handleVoiceoverLibrary(
      new Request(`https://studio.example.test/api/v2/voiceovers/library/${row.id}/delete`, {
        method: "POST",
        headers: { origin: "https://studio.example.test" },
      }),
      instance,
    );
    expect(response.status).toBe(204);
    expect(fixture.list).toHaveBeenCalled();
    expect(fixture.remove).toHaveBeenCalledWith(objectKey);
    expect(fixture.remove).toHaveBeenCalledWith(abandonedKey);
    expect(instance.remove).toHaveBeenCalledWith("owner-token", false, row.id, true);
  });

  it.each([
    ["absent", { ...row, object_key: null, checksum_sha256: null }],
    ["active", { ...row, state: "PROCESSING" }],
  ])("does not serve %s output", async (_label, inactive) => {
    const fixture = deps({
      read: vi.fn(async () => ({ voiceovers: [inactive], creators: [], total: 1 })),
    });
    const response = await handleVoiceoverLibrary(
      new Request(`https://studio.example.test/api/v2/voiceovers/library/${row.id}/audio`),
      fixture,
    );
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("VOICEOVER_NOT_READY");
    expect(fixture.head).not.toHaveBeenCalled();
    expect(fixture.get).not.toHaveBeenCalled();
  });
});
