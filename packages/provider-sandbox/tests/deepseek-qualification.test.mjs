import assert from "node:assert/strict";
import test from "node:test";

import { buildRequest, buildScenes } from "../scripts/qualify-deepseek.mjs";

test("DeepSeek qualification covers 40 exact scenes and five style batches", () => {
  const scenes = buildScenes();
  assert.equal(scenes.length, 40);
  assert.equal(new Set(scenes.map((scene) => scene.scene_id)).size, 40);
  for (let index = 0; index < 5; index += 1) {
    const request = buildRequest(index);
    assert.equal(request.model, "deepseek:v4@flash");
    assert.equal(request.outputFormat, "json");
    assert.equal(request.settings.thinkingLevel, "off");
    assert.equal(request.messages[0].content.match(/Project title:/gu)?.length, 1);
    assert.match(request.messages[0].content, /copy every required_terms string verbatim/u);
    assert.match(
      request.settings.systemPrompt,
      /MUST include every required_terms string verbatim/u,
    );
    assert.equal(request.jsonSchema.schema.properties.items.minItems, 8);
    assert.equal(request.jsonSchema.schema.properties.items.maxItems, 8);
  }
});
