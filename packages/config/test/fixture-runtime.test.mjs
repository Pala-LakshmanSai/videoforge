import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profileUrl = new URL("../profiles/fixture-runtime.v1.json", import.meta.url);
const profileSet = JSON.parse(await readFile(profileUrl, "utf8"));

test("fixture profile set cannot dispatch or spend", () => {
  assert.equal(profileSet.schema_version, "runtime-profile-set/v1");
  assert.equal(profileSet.provider_mode, "fixture");
  assert.equal(profileSet.provider_calls_authorized, false);
  assert.equal(profileSet.maximum_external_spend_usd, 0);
  assert.equal(profileSet.synthetic, true);

  for (const profile of profileSet.profiles) {
    assert.equal(profile.endpoint_id, null);
    assert.equal(profile.endpoint_configuration_revision, null);
    assert.deepEqual(profile.provider_gpu_priorities, []);
    assert.equal(profile.container_digest, null);
    assert.equal(profile.model_ready, false);
    assert.equal(profile.benchmarked, false);
    assert.equal(profile.maximum_reservation_usd, 0);
  }
});

test("every generation mode resolves all fixture lanes", () => {
  const knownProfileIds = new Set(profileSet.profiles.map((profile) => profile.profile_id));
  assert.deepEqual(Object.keys(profileSet.generation_mode_bindings).sort(), [
    "BALANCED",
    "FASTER",
    "LOWEST_COST",
  ]);

  for (const bindings of Object.values(profileSet.generation_mode_bindings)) {
    assert.equal(Object.keys(bindings).length, 4);
    for (const profileId of Object.values(bindings)) {
      assert.equal(knownProfileIds.has(profileId), true, profileId);
    }
  }
});
