import { describe, expect, it, vi } from "vitest";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { HostedSqlImageRegenerationStore } from "./hosted-image-regeneration-store";
const make = () => {
  const query = vi.fn(async () => ({
    rows: [
      {
        value: {
          id: "r",
          attempt_id: "a",
          state: "PREPARED",
          image_task_id: "s",
          dispatch_token: "t",
          endpoint_id_sha256: `sha256:${"a".repeat(64)}`,
          request_hash: `sha256:${"b".repeat(64)}`,
          envelope_hash: `sha256:${"c".repeat(64)}`,
          provider_job_id: null,
        },
      },
    ],
  }));
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ query }));
  return { executor: { query, transaction } as unknown as TransactionalSqlExecutor, query };
};
describe("HostedSqlImageRegenerationStore", () => {
  it("uses scoped transactions and security-definer create", async () => {
    const x = make();
    const s = new HostedSqlImageRegenerationStore(x.executor, "a", "w");
    await s.create({
      accountId: "a",
      workspaceId: "w",
      projectId: "p",
      projectRevisionId: "v",
      imageTaskId: "s",
      prompt: "edited",
      idempotencyKey: "k",
    });
    expect(x.query).toHaveBeenCalledWith(
      expect.stringContaining("videoforge_create_hosted_image_regeneration"),
      expect.any(Array),
    );
  });
  it("rejects a different tenant before SQL", async () => {
    const x = make();
    const s = new HostedSqlImageRegenerationStore(x.executor, "a", "w");
    await expect(
      s.create({
        accountId: "other",
        workspaceId: "w",
        projectId: "p",
        projectRevisionId: "v",
        imageTaskId: "s",
        prompt: "x",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("SCOPE");
    expect(x.query).not.toHaveBeenCalled();
  });
});
