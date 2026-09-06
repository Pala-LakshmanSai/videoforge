import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("../..", import.meta.url).pathname);
const entryPath = resolve(root, "apps/web/worker/production-index.ts");
const verifierPaths = [
  resolve(root, "scripts/verify-v2-05-production-bundle.mjs"),
  resolve(root, "scripts/verify-v2-05-runtime-firewall.mjs"),
];

function staticImports(source) {
  return [
    ...source.matchAll(
      /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"']+?\s+from\s+)?["']([^"']+)["'];?\s*$/gmu,
    ),
  ]
    .map((match) => match[1])
    .sort();
}

test("production Worker graph includes only the exact hosted entry capabilities", async () => {
  const entry = await readFile(entryPath, "utf8");
  assert.deepEqual(staticImports(entry), [
    "../src/server/hosted/app",
    "../src/server/hosted/configuration",
    "../src/server/hosted/retention",
    "../src/server/hosted/worker-version",
    "./hosted-pair-workflow",
    "./hosted-workflow",
  ]);
  assert.match(entry, /return withWorkerVersionIdentity\(\s*await handleHostedRequest\(/u);

  for (const verifierPath of verifierPaths) {
    const verifier = await readFile(verifierPath, "utf8");
    assert.equal(
      verifier.match(/"\.\.\/src\/server\/hosted\/worker-version"/gu)?.length,
      1,
      `${verifierPath} must allow exactly the one hosted worker-version module`,
    );
  }
});
