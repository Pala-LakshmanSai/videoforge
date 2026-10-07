import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(
  require.resolve("wrangler/package.json", { paths: [resolve(root, "apps/web")] }),
);
const { Miniflare } = runtimeRequire("miniflare");
const esbuild = runtimeRequire("esbuild");

test("Luna uses native Workerd fetch once and retains strict response accounting", async () => {
  const script = `
import { canonicalizeJson } from '@videoforge/contracts';
import { RunwareLunaPromptHttpTransport } from './src/server/providers/runware-luna-prompt-transport';
import { RunwareSpendLedger } from './src/server/providers/runware-http-transport';
export default { async fetch() {
  const request = {
    taskType: 'textInference', taskUUID: '11111111-1111-4111-8111-111111111111',
    model: 'openai:gpt@6-luna', outputFormat: 'JSON', deliveryMethod: 'async',
    includeCost: true, includeUsage: true,
    jsonSchema: { name: 'response', strict: true,
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } },
    settings: { systemPrompt: 'Write grounded scene prompts.', thinkingLevel: 'low', maxTokens: 6144 },
    messages: [{ role: 'user', content: 'A glass jar rests on a kitchen table.' }],
  };
  const requestBytes = canonicalizeJson([request]);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestBytes));
  const requestSha256 = 'sha256:' + [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  const ledger = new RunwareSpendLedger(0.25);
  const transport = new RunwareLunaPromptHttpTransport({
    apiKey: 'fixture-not-a-real-key-12345', ledger, maximumRequestCostUsd: 0.25,
  });
  try {
    const result = await transport.dispatch({ requestVersion: 'runware-gpt-6-luna-prompt-request-v39',
      request, requestBytes, requestSha256, requestedSceneIds: ['scene_01'], attemptIndex: 1,
      retryOfRequestSha256: null });
    return Response.json({ status: result.status, output: result.outputText,
      cost: result.estimatedCostMicroUsd, ledger: ledger.snapshot() });
  } catch(error) { return Response.json({ code: error.code }); }
}};`;
  const built = await esbuild.build({
    stdin: { contents: script, resolveDir: resolve(root, "apps/web"), loader: "ts" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
  });
  const compatibilityDate = readFileSync(
    resolve(root, "apps/web/wrangler.production.jsonc"),
    "utf8",
  ).match(/"compatibility_date":\s*"([0-9-]+)"/u)?.[1];
  assert(compatibilityDate);
  const calls = [];
  let invalidUsage = false;
  const runtime = new Miniflare({
    modules: true,
    script: built.outputFiles[0].text,
    compatibilityDate,
    compatibilityFlags: ["nodejs_compat"],
    outboundService: async (request) => {
      assert.equal(request.url, "https://api.runware.ai/v1/chat/completions");
      assert.equal(request.method, "POST");
      const body = await request.json();
      calls.push(body);
      return Response.json({
        id: "chatcmpl-offline",
        model: "openai:gpt@6-luna",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: '{"ok":true}' },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          total_tokens: invalidUsage ? 999 : 110,
        },
      });
    },
  });
  try {
    const result = await (await runtime.dispatchFetch("http://localhost/complete")).json();
    assert.equal(result.status, "succeeded");
    assert.equal(result.output, '{"ok":true}');
    assert.equal(result.cost, 15);
    assert.equal(result.ledger.reservedUsd, 0);
    assert.equal(result.ledger.settledUsd, 0.000015);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].max_completion_tokens, 6144);
    assert.equal(calls[0].reasoning_effort, "low");
    assert.equal(calls[0].response_format.json_schema.strict, true);
    invalidUsage = true;
    assert.deepEqual(await (await runtime.dispatchFetch("http://localhost/invalid")).json(), {
      code: "usage_invalid",
    });
    assert.equal(calls.length, 2);
  } finally {
    await runtime.dispose();
  }
});
