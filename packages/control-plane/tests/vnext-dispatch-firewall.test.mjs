import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ContractValidationError } from "@videoforge/contracts";

import { VNextPodDispatchFirewall } from "../dist/src/index.js";

const fixtureUrl = new URL(
  "../../contracts/generated/fixtures/pod_worker_job_envelope.valid.json",
  import.meta.url,
);

async function validEnvelope() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

function mutate(source, mutation) {
  const candidate = structuredClone(source);
  mutation(candidate);
  return candidate;
}

test("vNext paid dispatch accepts only the exact immutable Pod envelope", async () => {
  const received = [];
  const firewall = new VNextPodDispatchFirewall({
    async dispatch(envelope) {
      received.push(envelope);
      assert.equal(Object.isFrozen(envelope), true);
      assert.equal(Object.isFrozen(envelope.pod_resource_binding), true);
      return { dispatchId: "fixture-dispatch-001", acceptedAt: "2026-08-13T09:00:01.000Z" };
    },
  });
  const envelope = await validEnvelope();

  const receipt = await firewall.dispatch(envelope);

  assert.deepEqual(receipt, {
    dispatchId: "fixture-dispatch-001",
    acceptedAt: "2026-08-13T09:00:01.000Z",
  });
  assert.equal(received.length, 1);
  assert.notEqual(received[0], envelope);
});

test("legacy dispatch fields and profiles fail before the paid port", async () => {
  const calls = [];
  const firewall = new VNextPodDispatchFirewall({
    async dispatch(envelope) {
      calls.push(envelope);
      return { dispatchId: "forbidden", acceptedAt: "2026-08-13T09:00:01.000Z" };
    },
  });
  const envelope = await validEnvelope();
  const invalidCandidates = [
    mutate(envelope, (candidate) => {
      candidate.schema_version = "worker-job-envelope/v1";
    }),
    mutate(envelope, (candidate) => {
      candidate.dispatch_target = "RUNPOD_SERVERLESS";
    }),
    mutate(envelope, (candidate) => {
      candidate.provider_api = "runpod-serverless/v1";
    }),
    mutate(envelope, (candidate) => {
      candidate.endpoint_id = "legacy-endpoint";
    }),
    mutate(envelope, (candidate) => {
      candidate.path = "/run";
    }),
    mutate(envelope, (candidate) => {
      candidate.workersMin = 1;
    }),
    mutate(envelope, (candidate) => {
      candidate.workersMax = 1;
    }),
    mutate(envelope, (candidate) => {
      candidate.pod_resource_binding.selected_gpu_sku = "Auto";
    }),
    mutate(envelope, (candidate) => {
      candidate.pod_resource_binding.model_id = "AvatarForcing";
    }),
    mutate(envelope, (candidate) => {
      candidate.pod_resource_binding.model_id = "MuseTalk";
    }),
    mutate(envelope, (candidate) => {
      candidate.pod_resource_binding.model_id = "SkyReels";
    }),
    mutate(envelope, (candidate) => {
      candidate.repair = true;
    }),
    mutate(envelope, (candidate) => {
      candidate.fallback = "legacy-worker-registry";
    }),
    mutate(envelope, (candidate) => {
      candidate.worker_registry = ["avatar-primary-v1"];
    }),
  ];

  for (const candidate of invalidCandidates) {
    await assert.rejects(
      firewall.dispatch(candidate),
      (error) => error instanceof ContractValidationError,
    );
  }
  assert.equal(calls.length, 0);
});
