import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("apps/web/package.json", root));
const { MPEGDecoder } = await import(require.resolve("mpg123-decoder"));
const destination = new URL("apps/web/src/server/hosted/mpg123.wasm", root);
const compile = WebAssembly.compile;
let moduleBytes = new Uint8Array();
try {
  // Capture the pinned package's decompressed decoder at build time, never inside a Worker.
  WebAssembly.compile = async (bytes) => {
    if (bytes.byteLength > moduleBytes.length) moduleBytes = Uint8Array.from(bytes);
    return compile(bytes);
  };
  const decoder = new MPEGDecoder();
  await decoder.ready;
  decoder.free();
} finally {
  WebAssembly.compile = compile;
}
assert.equal(moduleBytes.length, 99479, "Pinned decoder changed; requalify before updating");
if (process.argv.includes("--check"))
  assert.deepEqual(Buffer.from(moduleBytes), readFileSync(destination));
else writeFileSync(destination, moduleBytes);
console.log(`${fileURLToPath(destination)}: ${moduleBytes.length} bytes verified`);
