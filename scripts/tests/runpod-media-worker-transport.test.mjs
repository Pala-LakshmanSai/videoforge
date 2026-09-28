import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(require.resolve("wrangler/package.json", { paths: [resolve(root, "apps/web")] }));
const { Miniflare } = runtimeRequire("miniflare");
const esbuild = runtimeRequire("esbuild");

test("RunPod transport uses native Workerd fetch without an illegal receiver or create retry", async () => {
  // Compile the exact production client with its real policy; no Node fetch substitute.
  const source = readFileSync(resolve(root, "apps/web/src/server/hosted/runpod-media.ts"), "utf8");
  const start = source.indexOf("export class RunPodMediaClient");
  const end = source.indexOf("export function verifyCloudPlacement", start);
  assert(start >= 0 && end > start);
  const code = `import {RunPodMediaError,isCapacityRefusal} from './apps/web/src/server/hosted/runpod-media-policy';
type Row=Record<string,unknown>;
${source.slice(start, end)}
export default {async fetch(request){
  const path=new URL(request.url).pathname,client=new RunPodMediaClient('fixture-not-a-real-key');
  try{
    const value=path==='/create'?await client.request('POST','/pods',{name:'fixture'}):
      path==='/delete'?await client.request('DELETE','/pods/fixture'):
      await client.request('GET','/catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE');
    return Response.json({ok:true,value,timeout_supported:typeof AbortSignal.timeout==='function'});
  }catch(error){return Response.json({ok:false,error_class:error instanceof Error?error.name:'UNKNOWN',
    http_status:error instanceof RunPodMediaError?error.status:null});}
}};`;
  const built = await esbuild.build({ stdin: { contents: code, resolveDir: root, loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser" });
  const date = readFileSync(resolve(root, "apps/web/wrangler.production.jsonc"), "utf8")
    .match(/"compatibility_date":\s*"([0-9-]+)"/u)?.[1];
  assert(date);
  const requests = [];
  const mf = new Miniflare({ modules: true, script: built.outputFiles[0].text,
    compatibilityDate: date, compatibilityFlags: ["nodejs_compat"],
    // Every outbound request terminates in this local fixture. No provider traffic or credentials.
    outboundService: async request => {
      requests.push(request.method);
      if (request.method === "POST") return Response.json({ detail: "fixture authentication refusal" }, { status: 401 });
      if (request.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ gpus: [] });
    } });
  try {
    const catalogue = await (await mf.dispatchFetch("http://localhost/catalogue")).json();
    assert.deepEqual(catalogue, { ok: true, value: { gpus: [] }, timeout_supported: true });
    assert.deepEqual(await (await mf.dispatchFetch("http://localhost/create")).json(),
      { ok: false, error_class: "Error", http_status: 401 });
    assert.deepEqual(await (await mf.dispatchFetch("http://localhost/delete")).json(),
      { ok: true, value: {}, timeout_supported: true });
    assert.deepEqual(requests, ["GET", "POST", "DELETE"]);
  } finally {
    await mf.dispose();
  }
});
