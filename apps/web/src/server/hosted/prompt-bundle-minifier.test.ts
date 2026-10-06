// @vitest-environment node
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { minifyHostedPromptRouteChunk } from "../../../vite.cloudflare.config";

describe("hosted prompt bundle whitespace", () => {
  it.each(["hosted-prompt-route", "compiler", "runware-http-transport"])(
    "preserves canonical strings and diagnostics in %s",
    async (name) => {
      const source = `
      class ArchivedPromptError extends Error {}
      function promptContract() { return "Keep  these  spaces. No text. café"; }
      const request = { taskUUID: "immutable-identity", settings: { systemPrompt: promptContract() } };
      const whitespace = /\\s+/gu;
      globalThis.result = {
        requestBytes: JSON.stringify([request]),
        errorName: ArchivedPromptError.name,
        functionName: promptContract.name,
        normalized: "two   words".replace(whitespace, " ")
      };
    `;
      const transformed = await minifyHostedPromptRouteChunk(source, name, name + ".js");
      expect(transformed).not.toBeNull();
      const before = { result: null },
        after = { result: null };
      runInNewContext(source, before);
      runInNewContext(transformed!.code, after);
      expect(JSON.stringify(after.result)).toBe(JSON.stringify(before.result));
      // The production closure guard measures size; tiny fixtures can grow from name preservation.
    },
  );

  it("leaves the shared static entry and other routes byte-identical", () => {
    expect(minifyHostedPromptRouteChunk("const value = 1;", "index", "index.js")).toBeNull();
    expect(minifyHostedPromptRouteChunk("const value = 1;", "product", "product.js")).toBeNull();
  });
});
