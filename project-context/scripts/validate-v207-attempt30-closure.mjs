import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const paths = {
  closure: resolve(liveRoot, "failed-attempt-30.json"),
  cleanup: resolve(liveRoot, "attempt30-cleanup-observation.json"),
  proposal: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt30-finalize-replay-fast-path-candidate/combined-live-proposal.json",
  ),
  authority: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt30-finalize-replay-fast-path-candidate/approved-authority.json",
  ),
};

const expected = Object.freeze({
  closure: "sha256:9846e19ee4348e73ef880202ecff5463bd076c5b1a2bd209e2815cba0500043c",
  cleanup: "sha256:112f7038d162613ebdde2176a7c257de24f629fdb3914b876a6edc490f46dbb0",
  proposal: "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a",
  authority: "sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131",
  live: "sha256:fb99e2e906a4dbbea81a48ae88917510bbfd2eec3d5a2d6e3067649d79361f58",
  orchestrator: "sha256:65b9504688b9518dac1343676f7e8b57e2dd27752a338d11842f72def6e77d12",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  repair: "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(`V207_ATTEMPT30_CLOSURE_INVALID:${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`V207_ATTEMPT30_CLOSURE_INVALID:${code}_JSON`);
  }
};

const bytes = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)]),
  ),
);
for (const name of ["closure", "cleanup", "proposal", "authority"]) {
  assert(sha256(bytes[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}
const closure = parse(bytes.closure, "CLOSURE");
const cleanup = parse(bytes.cleanup, "CLEANUP");
const proposal = parse(bytes.proposal, "PROPOSAL");
const authority = parse(bytes.authority, "AUTHORITY");

assert(
  closure.schema_version === "videoforge.v2-07-failed-attempt-closure/v1" &&
    closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 30 &&
    closure.result === "NOT_QUALIFIED",
  "SCOPE",
);
assert(
  closure.proposal_sha256 === expected.proposal &&
    closure.authority_sha256 === expected.authority &&
    closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE",
  "AUTHORITY",
);
assert(
  closure.lineage?.image === expected.image &&
    closure.lineage?.model_manifest_sha256 === expected.manifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.volume &&
    closure.lineage?.region === "EU-RO-1" &&
    closure.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    closure.lineage?.flashboot === true &&
    closure.lineage?.initial_workers_max === 1 &&
    closure.lineage?.concurrent_reader_workers_max === 2 &&
    closure.lineage?.provider_applied_max_two_observed === true &&
    closure.lineage?.provider_applied_concurrent_config_sha256 === null,
  "LINEAGE",
);
assert(
  closure.live_result?.source_sha256 === expected.live &&
    closure.live_result?.stop_reason === "RUNPOD_CONCURRENT_READER_BASELINE_UNCONFIRMED" &&
    closure.live_result?.stopped_phase === "warm-terminal" &&
    closure.live_result?.accepted_batches === 3 &&
    closure.live_result?.accepted_outputs === 96 &&
    closure.live_result?.accepted_receipts === 96 &&
    closure.live_result?.replay_confirmed_receipts === 96 &&
    closure.live_result?.accepted_output_bytes === 120216414 &&
    closure.live_result?.generated_output_rollback === "CONFIRMED" &&
    closure.live_result?.unplanned_duplicate_compute === false &&
    closure.live_result?.concurrent_reader_jobs_submitted === 0 &&
    closure.live_result?.cancel_jobs_submitted === 0 &&
    closure.live_result?.timeout_jobs_submitted === 0,
  "LIVE_RESULT",
);
assert(
  Array.isArray(closure.accepted_batch_summaries) &&
    closure.accepted_batch_summaries.length === 3 &&
    closure.accepted_batch_summaries.map((batch) => batch.kind).join(",") ===
      "owned_probe,cold,warm" &&
    closure.accepted_batch_summaries.every(
      (batch) =>
        batch.status === "COMPLETED" &&
        batch.item_count === 32 &&
        batch.durable_readback_count === 32 &&
        batch.commit_receipt_count === 32 &&
        batch.replay_confirmed_receipt_count === 32 &&
        batch.peak_vram_used_bytes === 14177206272,
    ),
  "BATCHES",
);
assert(
  closure.duplicate_delivery?.same_job === true &&
    closure.duplicate_delivery?.no_new_provider_dispatch === true &&
    closure.duplicate_delivery?.duplicate_compute === false &&
    closure.max_two_failure?.policy_patch_applied === true &&
    closure.max_two_failure?.reader_dispatch_reached === false &&
    closure.max_two_failure?.exact_raw_health_or_inventory_mismatch === "NOT_RETAINED",
  "FAILURE_BOUNDARY",
);
assert(
  cleanup.attempt === 30 &&
    cleanup.result?.observed_workers_max === 2 &&
    cleanup.result?.endpoint_deleted === true &&
    cleanup.result?.template_deleted === true &&
    cleanup.result?.final_disposable_resources_absent === true &&
    closure.exact_failed_cleanup?.observation_sha256 === expected.cleanup &&
    closure.exact_failed_cleanup?.endpoint_worker_record_count === 5 &&
    closure.exact_failed_cleanup?.terminal_pod_record_count === 5,
  "CLEANUP",
);
assert(
  closure.orchestrator?.source_sha256 === expected.orchestrator &&
    closure.orchestrator?.signer_secret_deleted === true &&
    closure.orchestrator?.captured_worker_version_restored === true &&
    closure.orchestrator?.route_restoration?.status === 404 &&
    closure.orchestrator?.route_restoration?.code === "V207_ROUTE_DISABLED",
  "ROLLBACK",
);
const reconciliation = closure.final_reconciliation;
assert(
  reconciliation?.stable_read_count === 3 &&
    reconciliation?.pods === 0 &&
    reconciliation?.endpoints === 0 &&
    reconciliation?.private_templates === 0 &&
    reconciliation?.active_serverless_workers === 0 &&
    reconciliation?.running_pods === 0 &&
    reconciliation?.baseline_endpoint_spend_usd === 0.5883426677901298 &&
    reconciliation?.final_endpoint_spend_usd === 0.5883426677901298 &&
    reconciliation?.incremental_spend_usd === 0 &&
    reconciliation?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation?.within_approved_cap === true &&
    reconciliation?.settlement === "THREE_STABLE_READS",
  "RECONCILIATION",
);
assert(
  reconciliation.retained_volumes?.some(
    (volume) =>
      volume.id_sha256 === expected.volume && volume.size_gb === 50 && volume.region === "EU-RO-1",
  ) &&
    reconciliation.retained_volumes?.some(
      (volume) =>
        volume.id_sha256 === expected.soulxVolume &&
        volume.size_gb === 50 &&
        volume.region === "EU-RO-1",
    ),
  "VOLUMES",
);
assert(
  closure.provider_free_repair?.commit === expected.repair &&
    closure.provider_free_repair?.focused_tests === "PASS_89_OF_89" &&
    closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" &&
    closure.qualification_boundaries?.v2_08 === "FORBIDDEN",
  "BOUNDARY",
);
assert(
  proposal.attempt === 30 &&
    proposal.lineage?.final_image === expected.image &&
    authority.attempt === 30 &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4,
  "PROPOSAL_BINDING",
);

process.stdout.write("V207_ATTEMPT30_CLOSURE_VALID\n");
