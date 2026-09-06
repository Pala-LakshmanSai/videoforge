import { describe, expect, it } from "vitest";

import { withWorkerVersionIdentity } from "./worker-version";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";

describe("production worker version identity", () => {
  it("returns the exact Cloudflare active version identity", async () => {
    const response = withWorkerVersionIdentity(Response.json({ ok: true }), {
      CF_VERSION_METADATA: { id: VERSION_ID },
    });

    expect(response.headers.get("x-videoforge-worker-version")).toBe(VERSION_ID);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("does not emit a guessed identity when the binding is absent or malformed", () => {
    for (const metadata of [undefined, { id: "latest" }]) {
      const response = withWorkerVersionIdentity(Response.json({ ok: true }), {
        CF_VERSION_METADATA: metadata,
      });
      expect(response.headers.has("x-videoforge-worker-version")).toBe(false);
    }
  });
});
