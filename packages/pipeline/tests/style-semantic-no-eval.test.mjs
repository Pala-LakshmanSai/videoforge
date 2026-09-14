import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const pipelineEntry = new URL("../dist/src/index.js", import.meta.url).href;

test("style profile assembly and stored validation avoid runtime code generation", () => {
  const childSource = `
    import {
      DeterministicFixtureStyleAnalyzer,
      buildStyleAnalyzerRequest,
      validateAndAssembleStyleProfile,
      validateStoredStyleProfile,
    } from ${JSON.stringify(pipelineEntry)};

    const references = Array.from({ length: 6 }, (_, index) => ({
      alias: \`ref_\${String(index + 1).padStart(2, "0")}\`,
      derivativeSha256: \`sha256:\${(index + 1).toString(16).repeat(64).slice(0, 64)}\`,
      mimeType: ["image/jpeg", "image/png", "image/webp"][index % 3],
      width: 1600,
      height: 1200,
      bytes: 240_000 + index,
    }));
    const request = buildStyleAnalyzerRequest(references);
    const analyzerOutput = await new DeterministicFixtureStyleAnalyzer().analyze(request);
    const assembled = await validateAndAssembleStyleProfile(request, analyzerOutput);
    const stored = await validateStoredStyleProfile(
      assembled.profile,
      references.map((reference) => reference.alias),
    );
    if (stored.styleProfileHash !== assembled.styleProfileHash)
      throw new Error("stored profile hash drifted from assembled profile");
    console.log(JSON.stringify({
      referenceCount: request.references.length,
      schemaVersion: stored.profile.schema_version,
      styleProfileHash: stored.styleProfileHash,
    }));
  `;

  const result = spawnSync(
    process.execPath,
    ["--disallow-code-generation-from-strings", "--input-type=module", "--eval", childSource],
    { encoding: "utf8" },
  );
  assert.equal(
    result.status,
    0,
    `code-generation-free child failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  const output = JSON.parse(result.stdout.trim());
  assert.deepEqual(output, {
    referenceCount: 6,
    schemaVersion: "image-style-profile/v1",
    styleProfileHash: output.styleProfileHash,
  });
});
