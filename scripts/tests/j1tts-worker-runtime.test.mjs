import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(realpathSync(root + "apps/web/node_modules/wrangler/package.json"));
const { Miniflare } = require("miniflare");
const esbuild = require("esbuild");

test("J1TTS provider boundary works in workerd without credential redirects", async () => {
  const source = readFileSync(root + "apps/web/src/server/hosted/j1tts.ts", "utf8");
  // Execute the actual provider boundary in workerd, independently of Neon and paid requests.
  const boundary = source.slice(
    source.indexOf("export class J1Error"),
    source.indexOf("export function parseJ1Voices"),
  );
  assert(boundary.includes("export async function j1Fetch"));
  const script = esbuild.transformSync(
    `const BASE="https://api.j1tts.com";${boundary}\nexport default {async fetch(request){try{const response=await j1Fetch("fixture-key",new URL(request.url).pathname);return Response.json({status:response.status});}catch(error){return Response.json({code:error.code});}}}`,
    { loader: "ts", format: "esm", target: "es2022" },
  ).code;
  const calls = [];
  const runtime = new Miniflare({
    modules: true,
    compatibilityDate: "2026-08-04",
    script,
    outboundService: async (request) => {
      const url = new URL(request.url);
      calls.push(url.pathname);
      assert.equal(url.origin, "https://api.j1tts.com");
      assert.equal(request.headers.get("authorization"), "Bearer fixture-key");
      return url.pathname === "/v1/voices"
        ? new Response('{"voices":[]}')
        : new Response(null, { status: 302, headers: { location: "https://untrusted.example/" } });
    },
  });
  try {
    assert.deepEqual(await (await runtime.dispatchFetch("http://localhost/v1/voices")).json(), {
      status: 200,
    });
    assert.deepEqual(await (await runtime.dispatchFetch("http://localhost/v1/redirect")).json(), {
      code: "J1TTS_REDIRECT_REJECTED",
    });
    assert.deepEqual(calls, ["/v1/voices", "/v1/redirect"]);
  } finally {
    await runtime.dispose();
  }
});
