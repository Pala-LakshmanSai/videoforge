import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  PROVIDER_MODES,
  RuntimeConfigValidationError,
  executionProfileCatalog,
  fixtureRuntimeProfileSet,
  isProviderMode,
  parseExecutionProfileCatalog,
  parseFixtureRuntimeProfileSet,
  resolveFixtureExecutionProfiles,
  resolveFixturePrimaryExecutionProfiles,
} from "../dist/index.js";

const runtimeProfileUrl = new URL("../profiles/fixture-runtime.v1.json", import.meta.url);
const catalogUrl = new URL("../profiles/execution-profile-catalog.v1.json", import.meta.url);
const rawRuntimeProfileSet = JSON.parse(await readFile(runtimeProfileUrl, "utf8"));
const rawCatalog = JSON.parse(await readFile(catalogUrl, "utf8"));

const clone = (value) => structuredClone(value);

test("provider modes include every explicit fail-closed runtime boundary", () => {
  assert.deepEqual(PROVIDER_MODES, ["fixture", "local", "sandbox", "staging", "production"]);
  for (const mode of PROVIDER_MODES) assert.equal(isProviderMode(mode), true);
  assert.equal(isProviderMode("provider-typo"), false);
});

test("fixture profile set cannot dispatch, claim a GPU, or spend", () => {
  assert.equal(fixtureRuntimeProfileSet.schema_version, "runtime-profile-set/v1");
  assert.equal(fixtureRuntimeProfileSet.provider_mode, "fixture");
  assert.equal(fixtureRuntimeProfileSet.provider_calls_authorized, false);
  assert.equal(fixtureRuntimeProfileSet.maximum_external_spend_usd, 0);
  assert.equal(fixtureRuntimeProfileSet.synthetic, true);

  for (const profile of fixtureRuntimeProfileSet.profiles) {
    assert.equal(profile.endpoint_id, null);
    assert.equal(profile.endpoint_configuration_revision, null);
    assert.deepEqual(profile.provider_gpu_priorities, []);
    assert.equal(profile.container_digest, null);
    assert.equal(profile.model_ready, false);
    assert.equal(profile.benchmarked, false);
    assert.equal(profile.maximum_reservation_usd, 0);
    assert.equal(Object.isFrozen(profile), true);
  }
});

test("catalog exposes one explicit Fixture option per primary lane and no candidate leakage", () => {
  assert.equal(executionProfileCatalog.provider_mode, "fixture");
  assert.equal(executionProfileCatalog.provider_calls_authorized, false);
  assert.equal(executionProfileCatalog.maximum_external_spend_usd, 0);
  assert.equal(executionProfileCatalog.selection_policy.raw_gpu_mutation_allowed, false);
  assert.equal(executionProfileCatalog.selection_policy.production_gate_id, "GATE_GPU_001");
  assert.deepEqual(executionProfileCatalog.lanes.map((entry) => entry.lane).sort(), [
    "avatar_primary",
    "image_media",
  ]);

  for (const lane of executionProfileCatalog.lanes) {
    assert.equal(lane.selector_options.length, 1);
    const [option] = lane.selector_options;
    assert.equal(option.label, "Fixture");
    assert.equal(option.selectable, true);
    assert.equal(option.selection_state, "FIXTURE_ONLY");
    assert.equal(option.endpoint_id, null);
    assert.equal(option.gpu_label, null);
    assert.equal(option.external_spend_usd, 0);
    assert.equal(lane.status.provider_state, "NOT_CONNECTED");
    assert.equal(lane.status.model_state, "NOT_LOADED");
    assert.equal(lane.status.external_spend_usd, 0);

    for (const candidate of lane.planned_candidates) {
      assert.equal(candidate.selectable, false);
      assert.equal(candidate.status, "BENCHMARK_REQUIRED");
      assert.equal(candidate.gate_id, "GATE_GPU_001");
    }
  }

  assert.deepEqual(
    executionProfileCatalog.lanes[0].planned_candidates.map((candidate) => candidate.label),
    ["RTX 4090", "RTX 5090", "L40S"],
  );
  assert.deepEqual(
    executionProfileCatalog.lanes[1].planned_candidates.map((candidate) => candidate.label),
    ["RTX 4090", "L40S", "RTX 6000 Ada"],
  );
  assert.equal(JSON.stringify(executionProfileCatalog).includes('"AVAILABLE"'), false);
});

test("every generation mode resolves the same two primary fixture profiles", () => {
  const expectedPrimaryProfileIds = {
    image_media: "exec_fixture_image_media_v1",
    avatar_primary: "exec_fixture_avatar_primary_v1",
  };

  for (const mode of ["LOWEST_COST", "BALANCED", "FASTER"]) {
    const allProfiles = resolveFixtureExecutionProfiles(mode);
    const primaryProfiles = resolveFixturePrimaryExecutionProfiles(mode);
    assert.equal(allProfiles.generation_mode, mode);
    assert.equal(primaryProfiles.image_media.profile_id, expectedPrimaryProfileIds.image_media);
    assert.equal(
      primaryProfiles.avatar_primary.profile_id,
      expectedPrimaryProfileIds.avatar_primary,
    );
    assert.equal(Object.isFrozen(allProfiles), true);
    assert.equal(Object.isFrozen(primaryProfiles), true);
  }
});

test("runtime validators reject provider, spend, GPU, and candidate-selectability claims", () => {
  const endpointLeak = clone(rawRuntimeProfileSet);
  endpointLeak.profiles[0].endpoint_id = "endpoint_not_authorized";
  assert.throws(() => parseFixtureRuntimeProfileSet(endpointLeak), RuntimeConfigValidationError);

  const gpuLeak = clone(rawRuntimeProfileSet);
  gpuLeak.profiles[0].provider_gpu_priorities = ["RTX 4090"];
  assert.throws(() => parseFixtureRuntimeProfileSet(gpuLeak), RuntimeConfigValidationError);

  const spendLeak = clone(rawCatalog);
  spendLeak.maximum_external_spend_usd = 0.1;
  assert.throws(
    () => parseExecutionProfileCatalog(spendLeak, fixtureRuntimeProfileSet),
    RuntimeConfigValidationError,
  );

  const selectableCandidateLeak = clone(rawCatalog);
  selectableCandidateLeak.lanes[0].planned_candidates[0].selectable = true;
  assert.throws(
    () => parseExecutionProfileCatalog(selectableCandidateLeak, fixtureRuntimeProfileSet),
    RuntimeConfigValidationError,
  );

  const fixtureGpuClaim = clone(rawCatalog);
  fixtureGpuClaim.lanes[0].selector_options[0].gpu_label = "RTX 4090";
  assert.throws(
    () => parseExecutionProfileCatalog(fixtureGpuClaim, fixtureRuntimeProfileSet),
    RuntimeConfigValidationError,
  );
});
