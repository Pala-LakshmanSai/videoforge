import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const paths = {
  closure: resolve(liveRoot, "failed-attempt-29.json"),
  cleanup: resolve(liveRoot, "attempt29-cleanup-observation.json"),
  proposal: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt29-terminal-replay-queue-proof-candidate/combined-live-proposal.json",
  ),
  authority: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt29-terminal-replay-queue-proof-candidate/approved-authority.json",
  ),
};

const expected = Object.freeze({
  closure: "sha256:ba6aab6bc71726c1690ae80161a7c22c9f3f50444efd14efc396bf556ae72678",
  cleanup: "sha256:96a7660bb19f0db5e88cec60269647b2101fd2ef5114f78efeecacec022c8a24",
  proposal: "sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6",
  authority: "sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572",
  live: "sha256:0a824ff422306ea534da3bbec29b8b6db772a71816976d725e3a8a5aa51f653c",
  orchestrator: "sha256:d971a6df48dac07e8776581d0c4561c65a230fc27b7a67d4e795788c6864a036",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  repair: "bf26c3a86ec6a48f619c39613d425da816eeae4d",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, code) => {
  if (!condition) throw new Error(`V207_ATTEMPT29_CLOSURE_INVALID:${code}`);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`V207_ATTEMPT29_CLOSURE_INVALID:${code}_JSON`);
  }
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)]),
);
const bytes = Object.fromEntries(entries);
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
    closure.attempt === 29 &&
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
    closure.lineage?.model === expected.model &&
    closure.lineage?.model_manifest_sha256 === expected.manifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.volume &&
    closure.lineage?.region === "EU-RO-1" &&
    closure.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    closure.lineage?.flashboot === true &&
    closure.lineage?.workers_min === 0 &&
    closure.lineage?.workers_max === 1 &&
    closure.lineage?.volume_mount === "/runpod-volume",
  "LINEAGE",
);
assert(
  closure.live_result?.source_sha256 === expected.live &&
    closure.live_result?.stop_reason === "MAGE_OUTPUT_NOT_SUCCEEDED" &&
    closure.live_result?.provider_status === "COMPLETED" &&
    closure.live_result?.output_status === "SUCCEEDED" &&
    closure.live_result?.output_failure_stage === "output_finalization_replay" &&
    closure.live_result?.output_failure_code === "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID" &&
    closure.live_result?.accepted_batches === 2 &&
    closure.live_result?.accepted_outputs === 64 &&
    closure.live_result?.accepted_receipts === 64 &&
    closure.live_result?.generated_output_rollback === "CONFIRMED" &&
    closure.live_result?.unplanned_duplicate_compute === false,
  "LIVE_RESULT",
);
assert(
  Array.isArray(closure.accepted_batch_summaries) &&
    closure.accepted_batch_summaries.length === 2 &&
    closure.accepted_batch_summaries.every(
      (batch) =>
        batch.status === "COMPLETED" &&
        batch.item_count === 32 &&
        batch.durable_readback_count === 32 &&
        batch.commit_receipt_count === 32 &&
        batch.peak_vram_used_bytes === 14177206272,
    ),
  "BATCHES",
);
assert(
  closure.warm_failure?.provider_status === "COMPLETED" &&
    closure.warm_failure?.output_status === "SUCCEEDED" &&
    closure.warm_failure?.accepted_batch === false &&
    closure.warm_failure?.failure_stage === "output_finalization_replay",
  "WARM_FAILURE",
);
assert(
  cleanup.attempt === 29 &&
    cleanup.result?.endpoint_deleted === true &&
    cleanup.result?.template_deleted === true &&
    cleanup.result?.final_disposable_resources_absent === true &&
    closure.exact_failed_cleanup?.observation_sha256 === expected.cleanup,
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
    reconciliation?.baseline_endpoint_spend_usd === 0.43364222336094826 &&
    reconciliation?.final_endpoint_spend_usd === 0.5883426677901298 &&
    reconciliation?.incremental_spend_usd === 0.15470044442918152 &&
    reconciliation?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation?.within_approved_cap === true &&
    reconciliation?.settlement === "THREE_STABLE_READS",
  "RECONCILIATION",
);
assert(
  reconciliation.retained_volumes?.some(
    (volume) => volume.id_sha256 === expected.volume && volume.size_gb === 50 && volume.region === "EU-RO-1",
  ) &&
    reconciliation.retained_volumes?.some(
      (volume) => volume.id_sha256 === expected.soulxVolume && volume.size_gb === 50 && volume.region === "EU-RO-1",
    ),
  "VOLUMES",
);
assert(
  closure.provider_free_repair?.commit === expected.repair &&
    closure.provider_free_repair?.focused_test ===
      "PASS_10_OF_10_REALISTIC_1280X720_FINALIZE_AND_IMMEDIATE_REPLAY" &&
    closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" &&
    closure.qualification_boundaries?.v2_08 === "FORBIDDEN",
  "BOUNDARY",
);
assert(
  proposal.attempt === 29 &&
    proposal.lineage?.final_image === expected.image &&
    authority.attempt === 29 &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4,
  "PROPOSAL_BINDING",
);

process.stdout.write("V207_ATTEMPT29_CLOSURE_VALID\n");
