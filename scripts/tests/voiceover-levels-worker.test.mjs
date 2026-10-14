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

test("Workerd levels retained MP3 using a static decoder and exactly two retrievals", async () => {
  const built = await esbuild.build({
    stdin: {
      contents: `import { leveledVoiceover } from './src/server/hosted/leveled-voiceover';
export default {async fetch() {
const audio = await leveledVoiceover(() => fetch('https://retained-audio.invalid/source.mp3'));
return new Response(audio.body, {headers:{'content-length':String(audio.length),'x-source-checksum':audio.sourceChecksum}});
}};`,
      resolveDir: resolve(root, "apps/web"),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    external: ["node:*", "*.wasm"],
  });
  const fixture = readFileSync(
    resolve(root, "apps/web/tests/fixtures/audio/speech-level-fade.mp3"),
  );
  const calls = [];
  const runtime = new Miniflare({
    modules: [
      { type: "ESModule", path: "worker.js", contents: built.outputFiles[0].text },
      {
        type: "CompiledWasm",
        path: "mpg123.wasm",
        contents: readFileSync(resolve(root, "apps/web/src/server/hosted/mpg123.wasm")),
      },
    ],
    compatibilityDate: "2026-08-04",
    compatibilityFlags: ["nodejs_compat"],
    outboundService: async (request) => {
      calls.push({ url: request.url, method: request.method });
      return new Response(fixture, { headers: { "content-type": "audio/mpeg" } });
    },
  });
  try {
    const response = await runtime.dispatchFetch("http://localhost/level");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, body.toString().slice(0, 200));
    assert.equal(body.length, fixture.length);
    assert.notDeepEqual(body, fixture);
    assert.match(response.headers.get("x-source-checksum"), /^sha256:[a-f0-9]{64}$/);
    assert.deepEqual(
      calls,
      Array(2).fill({ url: "https://retained-audio.invalid/source.mp3", method: "GET" }),
    );
  } finally {
    await runtime.dispose();
  }
});
