import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { HostedRuntimeEnvironment } from "./configuration";
const mocks = vi.hoisted(() => ({ query: vi.fn(), download: vi.fn() }));
vi.mock("./neon", () => ({ createNeonPool: () => ({ query: mocks.query, end: vi.fn() }) }));
vi.mock("./j1tts", () => ({ j1Fetch: mocks.download }));
import { archiveStandaloneVoiceover } from "./voiceover-archive";
const target = {
  accountId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "22222222-2222-4222-8222-222222222222",
  jobId: "33333333-3333-4333-8333-333333333333",
};
const prefix = `tenant/${target.accountId}/workspace/${target.workspaceId}/voiceover/${target.jobId}/`;
const previousClaimId = "44444444-4444-4444-8444-444444444444";
let bytes: Uint8Array;
let savedKey: string | null;
let previousClaim: string | null;
let failure: "none" | "before" | "after";
let failDelete = false;
let objects: Map<string, Uint8Array>;
let env: HostedRuntimeEnvironment;
beforeEach(() => {
  bytes = new Uint8Array(40 * 417);
  for (let i = 0; i < 40; i++) bytes.set([255, 251, 144, 0], i * 417);
  savedKey = null;
  previousClaim = null;
  failure = "none";
  failDelete = false;
  objects = new Map();
  mocks.query.mockReset();
  mocks.download.mockReset();
  vi.stubGlobal(
    "FixedLengthStream",
    class extends TransformStream {
      constructor() {
        super();
      }
    },
  );
  mocks.download.mockImplementation(
    async () =>
      new Response(Uint8Array.from(bytes), { headers: { "content-length": String(bytes.length) } }),
  );
  mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes("claim_voiceover_library_archive"))
      return {
        rows: [
          {
            value: {
              object_prefix: prefix,
              provider_job_id: "saved-provider-id",
              object_key: savedKey,
              previous_claim_id: previousClaim,
            },
          },
        ],
      };
    if (sql.includes("finalize_voiceover_library_archive")) {
      if (failure !== "before") savedKey = String(args[4]);
      if (failure !== "none") throw new Error("connection lost");
      return { rows: [{ value: { object_key: savedKey } }] };
    }
    return { rows: [{ value: { object_key: savedKey } }] };
  });
  const head = (key: string) => {
    const body = objects.get(key);
    if (!body) return null;
    return {
      size: body.length,
      httpMetadata: { contentType: "audio/mpeg" },
      checksums: { sha256: Uint8Array.from(createHash("sha256").update(body).digest()).buffer },
    };
  };
  env = {
    DATABASE_URL: "private",
    J1TTS_API_KEY: "test",
    PRIVATE_ARTIFACTS: {
      put: vi.fn(async (key: string, body: ReadableStream<Uint8Array>) => {
        objects.set(key, new Uint8Array(await new Response(body).arrayBuffer()));
      }),
      head: vi.fn(async (key: string) => head(key)),
      list: vi.fn(async ({ prefix: requestedPrefix }: { prefix: string }) => ({
        objects: [...objects.keys()]
          .filter((key) => key.startsWith(requestedPrefix))
          .map((key) => ({ key })),
        truncated: false,
      })),
      delete: vi.fn(async (key: string) => {
        if (failDelete) throw new Error("R2 delete failed");
        objects.delete(key);
      }),
    } as never,
  };
});
afterEach(() => vi.unstubAllGlobals());
it("archives verified short MP3 once from the saved provider identity without generating", async () => {
  await archiveStandaloneVoiceover(env, target);
  expect(objects.size).toBe(1);
  expect(savedKey).toMatch(new RegExp(`^${prefix}`));
  expect(mocks.download.mock.calls[0]?.[1]).toBe("/v1/tts/saved-provider-id/download");
  const finalize = mocks.query.mock.calls.find(([sql]) =>
    String(sql).includes("finalize_voiceover_library_archive"),
  );
  expect(finalize?.[1]?.slice(5)).toEqual([
    "audio/mpeg",
    bytes.length,
    `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    1045,
  ]);
  await archiveStandaloneVoiceover(env, target);
  expect(mocks.download).toHaveBeenCalledTimes(1);
});
it("keeps committed bytes after a lost database response", async () => {
  failure = "after";
  await archiveStandaloneVoiceover(env, target);
  expect(objects.has(savedKey!)).toBe(true);
  expect(env.PRIVATE_ARTIFACTS!.delete).not.toHaveBeenCalled();
});
it("removes uncommitted bytes only after scoped readback proves they were not accepted", async () => {
  failure = "before";
  await expect(archiveStandaloneVoiceover(env, target)).rejects.toThrow("connection lost");
  expect(objects.size).toBe(0);
});
it("does not archive ordinary video narration or a busy archive claim", async () => {
  mocks.query.mockResolvedValue({ rows: [{ value: null }] });
  await archiveStandaloneVoiceover(env, target);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("sweeps every expired claim object before download and retries after cleanup failure", async () => {
  const staleKey = `${prefix}${previousClaimId}.mp3`;
  const secondStaleKey = `${prefix}55555555-5555-4555-8555-555555555555.mp3`;
  const foreignKey = `tenant/${target.accountId}/workspace/${target.workspaceId}/voiceover/66666666-6666-4666-8666-666666666666/77777777-7777-4777-8777-777777777777.mp3`;
  objects.set(staleKey, Uint8Array.from(bytes));
  objects.set(secondStaleKey, Uint8Array.from(bytes));
  objects.set(foreignKey, Uint8Array.from(bytes));
  previousClaim = previousClaimId;
  failDelete = true;

  await expect(archiveStandaloneVoiceover(env, target)).rejects.toThrow("R2 delete failed");
  expect(mocks.download).not.toHaveBeenCalled();
  expect(objects.has(staleKey)).toBe(true);
  expect(objects.has(secondStaleKey)).toBe(true);

  failDelete = false;
  await archiveStandaloneVoiceover(env, target);
  expect(mocks.download).toHaveBeenCalledTimes(1);
  expect(objects.has(staleKey)).toBe(false);
  expect(objects.has(secondStaleKey)).toBe(false);
  expect(objects.has(foreignKey)).toBe(true);
  expect(savedKey).toMatch(new RegExp(`^${prefix}[0-9a-f-]{36}\\.mp3$`));
});
it("rejects corrupt provider output before publishing an audio receipt", async () => {
  bytes = new TextEncoder().encode("not an MP3 file at all");
  await expect(archiveStandaloneVoiceover(env, target)).rejects.toThrow(
    "GENERATED_VOICEOVER_INVALID_MP3",
  );
  expect(savedKey).toBeNull();
  expect(objects.size).toBe(0);
});
