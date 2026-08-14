import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { assertSujalRunPodAccount } from "./runpod-account";

const key = "runpod-test-key-at-least-twenty-characters";
const sujalAccountId = "sujal-test-account";
const sujalAccountIdHash = `sha256:${createHash("sha256")
  .update(sujalAccountId, "utf8")
  .digest("hex")}`;

describe("RunPod account boundary", () => {
  it("accepts only the pinned Sujal account identity without exposing the raw id", async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${key}`);
      return new Response(JSON.stringify({ data: { myself: { id: sujalAccountId } } }));
    });
    await expect(
      assertSujalRunPodAccount(key, {
        fetch,
        graphqlUrl: "http://127.0.0.1:43123/graphql",
        expectedAccountIdHash: sujalAccountIdHash,
      }),
    ).resolves.toEqual({ accountIdHash: sujalAccountIdHash });
    expect(JSON.stringify(await fetch.mock.results[0]?.value)).not.toContain(sujalAccountId);
  });

  it("fails closed for any other valid RunPod account", async () => {
    await expect(
      assertSujalRunPodAccount(key, {
        fetch: async () =>
          new Response(JSON.stringify({ data: { myself: { id: "demo9-account" } } })),
        graphqlUrl: "http://127.0.0.1:43123/graphql",
        expectedAccountIdHash: sujalAccountIdHash,
      }),
    ).rejects.toMatchObject({ code: "RUNPOD_ACCOUNT_NOT_SUJAL" });
  });

  it("maps auth, malformed data, and transport ambiguity to secret-free codes", async () => {
    for (const [fetch, code] of [
      [async () => new Response("", { status: 401 }), "RUNPOD_AUTH_REJECTED"],
      [async () => new Response("bad-json"), "RUNPOD_ACCOUNT_RESPONSE_INVALID"],
      [async () => Promise.reject(new Error(key)), "RUNPOD_ACCOUNT_READ_AMBIGUOUS"],
    ] as const) {
      try {
        await assertSujalRunPodAccount(key, {
          fetch,
          graphqlUrl: "http://127.0.0.1:43123/graphql",
          expectedAccountIdHash: sujalAccountIdHash,
        });
        throw new Error("expected failure");
      } catch (error) {
        expect(error).toMatchObject({ code });
        expect(String(error)).not.toContain(key);
      }
    }
  });
});
