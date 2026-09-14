import { describe, expect, it, vi } from "vitest";
import { handleHostedImageRegenerationRoute } from "./hosted-image-regeneration-route";
const project = "11111111-1111-4111-8111-111111111111";
const task = "22222222-2222-4222-8222-222222222222";
const revision = "33333333-3333-4333-8333-333333333333";
const deps = () => ({
  config: { publicOrigin: "https://example.test" },
  authenticate: vi.fn(async () => ({ account_id: "a", workspace_id: "w", user_id: "u" })),
  service: {
    create: vi.fn(async () => ({ requestId: "r", state: "PREPARED" })),
    get: vi.fn(async () => ({ requestId: "r", state: "PENDING" })),
  },
});
describe("hosted image regeneration route", () => {
  it.each([
    ["23505", 409],
    ["02000", 404],
    ["23514", 503],
    ["08006", 503],
  ])(
    "maps database %s to %s without treating uncertain writes as rejected",
    async (code, status) => {
      const d = deps();
      d.service.create.mockRejectedValueOnce(
        Object.assign(new Error("database failure"), { code }),
      );
      const result = await handleHostedImageRegenerationRoute(
        new Request(
          `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate`,
          {
            method: "POST",
            headers: { origin: "https://example.test", "content-type": "application/json" },
            body: JSON.stringify({
              schema_version: "videoforge-hosted-image-regeneration/v1",
              prompt: "new",
              idempotency_key: "k",
              revision_id: revision,
            }),
          },
        ),
        d,
      );
      expect(result?.status).toBe(status);
    },
  );
  it("validates schema and creates", async () => {
    const d = deps();
    const r = await handleHostedImageRegenerationRoute(
      new Request(
        `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate`,
        {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: JSON.stringify({
            schema_version: "videoforge-hosted-image-regeneration/v1",
            prompt: "new",
            idempotency_key: "k",
            revision_id: revision,
          }),
        },
      ),
      d,
    );
    expect(r?.status).toBe(202);
    expect(d.service.create).toHaveBeenCalled();
  });
  it("returns owner scoped status and rejects malformed body", async () => {
    const d = deps();
    const r = await handleHostedImageRegenerationRoute(
      new Request(
        `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate/not-a-uuid`,
        { method: "GET", headers: { origin: "https://example.test" } },
      ),
      d,
    );
    expect(r?.status).toBe(404);
    const bad = await handleHostedImageRegenerationRoute(
      new Request(
        `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate`,
        {
          method: "POST",
          headers: { origin: "https://example.test", "content-type": "application/json" },
          body: "{}",
        },
      ),
      d,
    );
    expect(bad?.status).toBe(400);
  });
  it("returns authentication failures before touching service", async () => {
    const d = deps();
    d.authenticate = vi.fn(async () => new Response(null, { status: 401 }) as never);
    const result = await handleHostedImageRegenerationRoute(
      new Request(
        `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate`,
        { method: "POST", headers: { origin: "https://example.test" } },
      ),
      d,
    );
    expect(result?.status).toBe(401);
    expect(d.service.create).not.toHaveBeenCalled();
  });
  it("reads status with tenant scope", async () => {
    const d = deps();
    const result = await handleHostedImageRegenerationRoute(
      new Request(
        `https://example.test/api/v2/hosted/projects/${project}/images/${task}/regenerate/${revision}`,
        { method: "GET", headers: { origin: "https://example.test" } },
      ),
      d,
    );
    expect(result?.status).toBe(200);
    expect(d.service.get).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "a", workspaceId: "w", requestId: revision }),
    );
  });
});
