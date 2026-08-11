import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProviderRequest,
  buildStyleFixtures,
  providerSchema,
} from "../scripts/qualify-gemini-style.mjs";

test("Gemini qualification builds seven deterministic metadata-free fixture sets", () => {
  const first = buildStyleFixtures();
  const replay = buildStyleFixtures();
  assert.equal(first.length, 7);
  assert.deepEqual(
    first.map((fixture) => fixture.id),
    replay.map((fixture) => fixture.id),
  );
  assert.deepEqual(
    first.map((fixture) => fixture.references.map((reference) => reference.derivativeSha256)),
    replay.map((fixture) => fixture.references.map((reference) => reference.derivativeSha256)),
  );
  for (const fixture of first) {
    assert.ok(fixture.references.length >= 3 && fixture.references.length <= 8);
    assert.equal(fixture.metadataStripped, true);
    assert.deepEqual(
      fixture.references.map((reference) => reference.alias),
      fixture.references.map((_, index) => `ref_${String(index + 1).padStart(2, "0")}`),
    );
    for (const reference of fixture.references) {
      assert.deepEqual(reference.chunkTypes, ["IHDR", "IDAT", "IEND"]);
      assert.match(reference.dataUri, /^data:image\/png;base64,/u);
      assert.match(reference.derivativeSha256, /^sha256:[0-9a-f]{64}$/u);
    }
  }
});

test("provider schema fully inlines canonical style profile references", () => {
  const serialized = JSON.stringify(providerSchema);
  assert.equal(serialized.includes("$ref"), false);
  assert.equal(serialized.includes("$schema"), false);
  assert.equal(serialized.includes("$id"), false);
  assert.equal(serialized.includes("minLength"), false);
  assert.equal(serialized.includes("maxLength"), false);
  assert.equal(serialized.includes("pattern"), false);
  assert.equal(serialized.includes("title"), false);
  assert.equal(serialized.includes("description"), false);
  assert.equal(serialized.includes("minItems"), false);
  assert.equal(serialized.includes("maxItems"), false);
  assert.equal(serialized.includes("minimum"), false);
  assert.equal(serialized.includes("maximum"), false);
  assert.ok(providerSchema.properties.visual_profile.properties.medium_family);
  assert.ok(providerSchema.properties.prompt_profile.properties.planner_guidance);
  assert.deepEqual(providerSchema.required, [
    "summary",
    "visual_profile",
    "prompt_profile",
    "analysis",
  ]);
  assert.equal(providerSchema.properties.analysis.properties.trait_evidence.items.type, "object");
  assert.equal(
    providerSchema.properties.analysis.properties.trait_evidence.items.properties.trait.enum.length,
    14,
  );
});

test("every live request pins canonical Gemini AIR and contains only in-memory data URIs", () => {
  for (const fixture of buildStyleFixtures()) {
    const request = buildProviderRequest(fixture, "11111111-1111-4111-8111-111111111111");
    assert.equal(request.model, "google:gemini@3.5-flash");
    assert.equal(request.outputFormat, "JSON");
    assert.equal("seed" in request, false);
    assert.equal(request.jsonSchema.strict, true);
    assert.equal(request.settings.thinkingLevel, "low");
    assert.equal(request.settings.maxTokens, 6000);
    assert.equal(request.providerSettings.google.mediaResolution, "medium");
    assert.equal("tools" in request, false);
    assert.equal(request.inputs.images.length, fixture.references.length);
    assert.ok(request.inputs.images.every((image) => image.startsWith("data:image/png;base64,")));
    fixture.references.forEach((reference, index) =>
      assert.match(
        request.messages[0].content,
        new RegExp(`${reference.alias} = inputs\\.images\\[${index}\\]`, "u"),
      ),
    );
  }
});
