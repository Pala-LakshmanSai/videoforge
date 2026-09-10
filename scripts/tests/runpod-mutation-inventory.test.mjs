import assert from "node:assert/strict";
import test from "node:test";

import { validateRunPodPerMutationRawComputeInventory } from "../../deploy/v2-13/full-live-adapters.mjs";

test("accepts current RunPod terminal pod records without a status field", () => {
  const result = validateRunPodPerMutationRawComputeInventory({
    pods: [{ desiredStatus: "EXITED" }],
    endpoints: [],
    templates: [],
    expectedEndpointBindings: [],
  });
  assert.deepEqual(result, []);
});

test("rejects an explicit nonterminal RunPod pod status", () => {
  assert.throws(
    () =>
      validateRunPodPerMutationRawComputeInventory({
        pods: [{ desiredStatus: "EXITED", status: "RUNNING" }],
        endpoints: [],
        templates: [],
        expectedEndpointBindings: [],
      }),
    /RUNPOD_MUTATION_ADMISSION_POD_STATE/u,
  );
});
