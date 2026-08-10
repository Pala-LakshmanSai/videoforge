import assert from "node:assert/strict";
import test from "node:test";

import {
  PIPELINE_ERROR_CODES,
  PipelineDomainError,
  pipelineFailure,
  pipelineSuccess,
} from "../dist/src/index.js";

test("the pure package exposes stable coded failures", () => {
  assert.deepEqual(PIPELINE_ERROR_CODES, [
    "CONTRACT_INVALID",
    "TRANSCRIPT_INVALID",
    "TIMELINE_INVALID",
    "REQUIRED_ASSET_MISSING",
    "DUPLICATE_ASSET_BINDING",
    "ASSET_KIND_MISMATCH",
    "ASSET_HASH_MISMATCH",
    "RENDER_PROFILE_MISMATCH",
    "RENDER_PLAN_INVALID",
    "PROMPT_INPUT_INVALID",
    "PROMPT_OUTPUT_INVALID",
    "PROMPT_CONFLICT",
    "PROMPT_HASH_MISMATCH",
  ]);

  const result = pipelineFailure({
    code: "REQUIRED_ASSET_MISSING",
    message: "An accepted asset is required.",
    path: ["segments", 2, "required_slots", "right_image"],
    details: { taskKey: "image:segment-3:right" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REQUIRED_ASSET_MISSING");
  assert.deepEqual(result.error.path, ["segments", 2, "required_slots", "right_image"]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.error), true);
  assert.equal(Object.isFrozen(result.error.path), true);
  assert.equal(Object.isFrozen(result.error.details), true);
});

test("success preserves the caller-owned value without side effects", () => {
  const value = { contractName: "timelinePlan" };
  const result = pipelineSuccess(value);

  assert.deepEqual(result, { ok: true, value });
  assert.equal(result.value, value);
  assert.equal(Object.isFrozen(result), true);
});

test("PipelineDomainError preserves a stable coded failure", () => {
  const error = new PipelineDomainError({
    code: "RENDER_PROFILE_MISMATCH",
    message: "The accepted asset and render profile do not match.",
    path: ["render", "avatar_source_profile"],
  });

  assert.equal(error.name, "PipelineDomainError");
  assert.equal(error.message, "The accepted asset and render profile do not match.");
  assert.equal(error.failure.code, "RENDER_PROFILE_MISMATCH");
  assert.equal(Object.isFrozen(error.failure), true);
  assert.equal(Object.isFrozen(error.failure.path), true);
});
