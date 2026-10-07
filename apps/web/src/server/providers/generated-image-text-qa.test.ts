import { describe, expect, it, vi } from "vitest";
import { inspectGeneratedImageText, IMAGE_TEXT_QA_MODEL } from "./generated-image-text-qa";
const taskId = "11111111-1111-4111-8111-111111111111";
const result = (verdict = "PASS") => ({ taskUUID: taskId, taskType: "textInference", model: IMAGE_TEXT_QA_MODEL,
  finishReason: "stop", text: JSON.stringify({ verdict }), cost: 0.0001,
  usage: { promptTokens: 200, completionTokens: 10, totalTokens: 210 } });
const input = { apiKey: "test-only-key", taskId, bytes: new Uint8Array([1,2,3]), contentType: "image/png" as const, dispatch: true };
describe("generated image pixel text QA", () => {
  it("sends exact pixels with strict any-text policy and bounds output", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [result()] })));
    expect(await inspectGeneratedImageText({ ...input, fetcher })).toMatchObject({ verdict: "PASS", costMicroUsd: 100 });
    const body = JSON.parse((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body as string)[0];
    expect(body.inputs.images).toEqual(["data:image/png;base64,AQID"]);
    expect(body.settings.systemPrompt).toContain("pseudo-text");
    expect(body.settings.maxTokens).toBe(128);
  });
  it.each(["TEXT", "UNCERTAIN"])("blocks %s with actual cost retained", async (verdict) => {
    expect(await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [result(verdict)] })) })).toMatchObject({ verdict, costMicroUsd: 100 });
  });
  it("polls existing UUID without resubmitting inference", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: [result()] })));
    await inspectGeneratedImageText({ ...input, dispatch: false, fetcher });
    expect(JSON.parse((fetcher.mock.calls as unknown as Array<[string, RequestInit]>)[0]![1].body as string)).toEqual([{ taskType: "getResponse", taskUUID: taskId }]);
  });
  it("malformed verdict fails closed while recording cost", async () => {
    const receipt = await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [{ ...result(), text: "not JSON" }] })) });
    expect(receipt).toMatchObject({ verdict: "UNCERTAIN", costMicroUsd: 100 });
  });
  it.each(["length", "content_filter", "refusal"])("records %s terminal cost without approving pixels", async (finishReason) => {
    expect(await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [{ ...result(), finishReason }] })) })).toMatchObject({ verdict: "UNCERTAIN", costMicroUsd: 100 });
  });
  it("retains actual terminal cost with missing usage and refuses acceptance", async () => {
    expect(await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [{ ...result(), usage: {} }] })) })).toMatchObject({ verdict: "UNCERTAIN", costMicroUsd: 100, promptTokens: null, completionTokens: null });
  });
  it("retains unexpected provider charge while refusing acceptance", async () => {
    expect(await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [{ ...result(), cost: 0.021 }] })) })).toMatchObject({ verdict: "UNCERTAIN", costMicroUsd: 21000 });
  });
  it.each([{ taskUUID: "other" }, { finishReason: undefined },  { taskType: "getResponse", status: "processing" }])("does not accept invalid or pending response %j", async (change) => {
    expect(await inspectGeneratedImageText({ ...input, fetcher: async () => new Response(JSON.stringify({ data: [{ ...result(), ...change }] })) })).toBeNull();
  });
});
