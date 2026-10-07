import { describe, expect, it, vi } from "vitest";
import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { generatedImageTextQa } from "./generated-image-text-qa";
const id = "11111111-1111-4111-8111-111111111111";
const artifact = { objectKey: "private-image", sha256: `sha256:${"a".repeat(64)}` as const,
  byteSize: 3, width: 1, height: 1, contentType: "image/png" as const };
describe("durable image text inspection", () => {
  it("recovers exact QA UUID after receipt write failure without second paid inference", async () => {
    let state = "NEW"; let failWrite = true;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("claim_image")) {
        const dispatch = state === "NEW"; if (dispatch) state = "RESERVED";
        return { rows: [{ value: { id, state, dispatch } }] };
      }
      if (sql.includes("finish_image")) {
        if (failWrite) { failWrite = false; throw new Error("database unavailable"); }
        state = "PASS"; return { rows: [{ value: true }] };
      }
      return { rows: [] };
    });
    const database = { transaction: (fn: (tx: { query: typeof query }) => unknown) => fn({ query }) } as unknown as TransactionalSqlExecutor;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [{ taskUUID: id,
      taskType: "textInference", finishReason: "stop", text: { verdict: "PASS" }, cost: 0.0001,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }] })));
    const inspect = generatedImageTextQa({ database, accountId: id, apiKey: "test-key", fetcher });
    await expect(inspect(artifact, new Uint8Array([1,2,3]))).rejects.toThrow("database unavailable");
    expect(await inspect(artifact, new Uint8Array([1,2,3]))).toBe("PASS");
    expect(await inspect(artifact, new Uint8Array([1,2,3]))).toBe("PASS");
    const calls = (fetcher.mock.calls as unknown as Array<[string,RequestInit]>).map((call) => JSON.parse(call[1].body as string)[0]);
    expect(calls.map((call) => call.taskType)).toEqual(["textInference", "getResponse"]);
    expect(calls.every((call) => call.taskUUID === id)).toBe(true);
  });
  it("does not dispatch when historical or missing credentials", async () => {
    let state = "HISTORICAL";
    const database = { transaction: async (fn: (tx: unknown) => unknown) => fn({ query: async () => ({ rows: [{ value: { state } }] }) }) } as unknown as TransactionalSqlExecutor;
    const fetcher = vi.fn();
    const inspect = generatedImageTextQa({ database, accountId: id, fetcher });
    expect(await inspect(artifact,new Uint8Array([1,2,3]))).toBe("PASS");
    state = "BINDING_UNAVAILABLE";
    expect(await inspect(artifact,new Uint8Array([1,2,3]))).toBe("PENDING");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
