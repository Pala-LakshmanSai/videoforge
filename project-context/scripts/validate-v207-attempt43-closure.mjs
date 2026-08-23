import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt43-anchor-refresh-candidate",
);
const paths = {
  closure: resolve(liveDir, "failed-attempt-43.json"),
  cleanup: resolve(liveDir, "attempt43-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt43-reconciliation-observation.json"),
  proposal: resolve(candidateDir, "combined-live-proposal.json"),
  authority: resolve(candidateDir, "approved-authority.json"),
  acceptance: resolve(candidateDir, "acceptance.json"),
  max1: resolve(candidateDir, "staged-config-max1.json"),
  max2: resolve(candidateDir, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};

const expected = {
  proposal:
    "sha256:05e8aa382b135101990edbe155e75ac89b51f75779d81de500bb75b693207458",
  authority:
    "sha256:e5c268b63583d28c18a3999ef9880f425d54e9bf50f759e376dbcd0f2b40a07b",
  acceptance:
    "sha256:65be5415aa6dac58aaa963e41cd1e699827b10fdfe2dccd78fd20678d8ff2d5b",
  max1:
    "sha256:72dfa25d988699553141207dc6604f07cfd8f27e7a62954de4d357da79242951",
  max2:
    "sha256:4f27d0d4d97d9d5773b7492e4c6fbd78eb0b07510206bdc3c26c5dac885e9e38",
  closure:
    "sha256:1699d5429b12a5573b10be5b325a780f5a1c7d484b960fdb0758e64381391494",
  cleanup:
    "sha256:59caf2f398a6146e177d2f6dd34f8fa82848a97261cdf752d1a8cd03729fe260",
  reconciliation:
    "sha256:e9fe4d7547b2ddc38a3766d22044b414037d09dd5426ab4a9816aea18336da6a",
  settledReconciliation:
    "sha256:805be262eddfe9597ff5aa1c0732cdc31d502fdb6312d815c4226ef413058c7c",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageConfig:
    "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  imageLayer:
    "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  imageDiff:
    "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT43_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) =>
  `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

for (const name of [
  "proposal",
  "authority",
  "acceptance",
  "max1",
  "max2",
  "closure",
  "cleanup",
  "reconciliation",
]) {
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const acceptance = json(paths.acceptance);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);

assert(
  proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 43,
  "PROPOSAL_SCOPE",
);
assert(
  closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 43 &&
    closure.proposal?.sha256 === expected.proposal &&
    closure.authority?.sha256 === expected.authority &&
    closure.acceptance?.sha256 === expected.acceptance,
  "CLOSURE_LINEAGE_HASHES",
);
assert(
  authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.consumed === false,
  "IMMUTABLE_AUTHORITY_BYTES",
);
assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.authority_sha256 === expected.authority &&
    acceptance.provider_boundary?.authority_active === true,
  "IMMUTABLE_ACCEPTANCE_BYTES",
);

const lineage = closure.lineage;
assert(
  lineage?.image === expected.image &&
    lineage.image_config_sha256 === expected.imageConfig &&
    lineage.image_layer_sha256 === expected.imageLayer &&
    lineage.image_layer_diff_id === expected.imageDiff &&
    lineage.model === expected.model &&
    lineage.model_manifest_sha256 === expected.modelManifest &&
    lineage.mage_volume_id_sha256 === expected.mageVolume &&
    lineage.volume_size_gb === 50 &&
    lineage.volume_region === "EU-RO-1" &&
    lineage.volume_mount === "/runpod-volume" &&
    lineage.model_root === "/runpod-volume/mage-model" &&
    lineage.gpu === "NVIDIA GeForce RTX 4090" &&
    lineage.flashboot === true,
  "EXACT_RUNTIME_LINEAGE",
);
assert(
  closure.result === "NOT_QUALIFIED_OUTPUT_FINALIZATION_400_CLEAN" &&
    closure.qualification_status === "NOT_QUALIFIED" &&
    closure.authority_state === "CONSUMED_CLOSED_DO_NOT_REUSE" &&
    closure.execution?.provider_job_count === 1 &&
    closure.execution?.gpu_jobs_submitted === 1 &&
    closure.execution?.provider_job_status === "COMPLETED" &&
    closure.execution?.failure_stage === "output_finalization_replay" &&
    closure.execution?.error === "MAGE_OUTPUT_NOT_SUCCEEDED" &&
    closure.execution?.failure_code === "V207_OUTPUT_PORT_400" &&
    closure.execution?.output_status === "SUCCEEDED" &&
    closure.execution?.generated_output_rollback === "CONFIRMED" &&
    closure.execution?.accepted_batches === 0 &&
    closure.execution?.durable_output_readbacks === 0 &&
    closure.execution?.v3_receipts === 0 &&
    closure.execution?.qualification_claim_allowed === false,
  "FAILURE_BOUNDARY",
);
assert(
  closure.cleanup?.cleanup_uncertain_in_runner === true &&
    closure.cleanup?.cleanup_uncertain_after_follow_up === false &&
    closure.cleanup?.retained_volumes_deleted_or_written === false &&
    closure.reconciliation?.stable_reads === 3 &&
    closure.reconciliation?.settled_source_sha256 === expected.settledReconciliation,
  "FOLLOW_UP_CLEANUP_BOUNDARY",
);
assert(
  closure.rollback?.route_restored_status === 404 &&
    closure.rollback?.route_restored_code === "V207_ROUTE_DISABLED" &&
    closure.rollback?.stable_post_route_reads === 3 &&
    closure.rollback?.protected_config_baseline_sha256 ===
      "sha256:085c49cad14e5e3b339f34065075f311a795c311d474c2355b6477f75c860175" &&
    closure.rollback?.protected_config_mode === "0600" &&
    closure.rollback?.protected_config_marker_absent === true,
  "ROLLBACK_FENCE",
);
assert(
  cleanup.result === "FAILED_ATTEMPT_CLEANUP_DISPOSABLE_RESOURCES_DELETED" &&
    cleanup.failure_code === "V207_OUTPUT_PORT_400" &&
    cleanup.runpod_cleanup?.stable_terminal_snapshot_count === 2 &&
    cleanup.runpod_cleanup?.endpoint_deleted === true &&
    cleanup.runpod_cleanup?.template_deleted === true &&
    cleanup.runpod_cleanup?.final_disposable_resources_absent === true &&
    cleanup.cloudflare_cleanup?.route_restored_status === 404 &&
    cleanup.cloudflare_cleanup?.route_restored_code === "V207_ROUTE_DISABLED" &&
    cleanup.cloudflare_cleanup?.stable_post_route_reads === 3 &&
    cleanup.cloudflare_cleanup?.cleanup_uncertain_after_follow_up === false &&
    cleanup.protected_config_restore?.baseline_mode === "0600" &&
    cleanup.protected_config_restore?.marker_reverted === true &&
    cleanup.protected_config_restore?.final_marker_absent === true,
  "CLEANUP_OBSERVATION",
);
assert(
  cleanup.route_reconciliation?.method === "POST" &&
    cleanup.route_reconciliation?.status === 404 &&
    cleanup.route_reconciliation?.code === "V207_ROUTE_DISABLED" &&
    cleanup.route_reconciliation?.stable_read_count === 3,
  "CLEANUP_ROUTE",
);
assert(
  reconciliation.checkpoint === "V2-07" &&
    reconciliation.attempt === 43 &&
    reconciliation.stable_read_count === 3 &&
    reconciliation.read_only === true &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.intended_volume_count === 2 &&
    reconciliation.inventory?.final_disposable_resources_absent === true &&
    reconciliation.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.final_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.incremental_spend_usd === 0 &&
    reconciliation.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation.billing?.within_approved_cap === true &&
    reconciliation.billing?.settlement === "THREE_STABLE_READS" &&
    reconciliation.mutation_boundary?.provider_mutations_in_final_inventory === 0 &&
    reconciliation.mutation_boundary?.gpu_jobs_in_final_inventory === 0 &&
    reconciliation.mutation_boundary?.volume_mutation_called === false &&
    reconciliation.mutation_boundary?.cross_mount_observed === false,
  "RECONCILIATION_BOUNDARY",
);
const volumes = new Map(
  (reconciliation.inventory?.retained_volumes ?? []).map((volume) => [
    volume.purpose,
    volume,
  ]),
);
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("Mage")?.mount === "/runpod-volume" &&
    volumes.get("Mage")?.identity_unchanged === true &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1" &&
    volumes.get("SoulX")?.identity_unchanged === true,
  "RETAINED_VOLUMES",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const stateTop = state.slice(0, state.indexOf("pending_v2_07_attempt42_proposal:"));
const latestLiveStart = state.indexOf("  latest_live_check:");
const latestSourceStart = state.indexOf("  latest_source_verification:", latestLiveStart);
const latestLive = state.slice(latestLiveStart, latestSourceStart);
const gateStart = gates.indexOf("  GATE_SERVERLESS_MAGE_001:");
const gateEnd = gates.indexOf("\n  GATE_SERVERLESS_SOULX_001:", gateStart);
const gate = gates.slice(gateStart, gateEnd);
const startCurrent = start.slice(0, start.indexOf("\nAttempt42 is closed"));
const taskCurrent = task.slice(0, task.indexOf("\n## Attempt42 closed"));

assert(
  stateTop.includes("phase: serverless_v2_v2_07_attempt43_closed_not_qualified") &&
    stateTop.includes("provider_calls_authorized: false") &&
    stateTop.includes("gpu_use_authorized: false") &&
    stateTop.includes("maximum_external_spend_usd: 0") &&
    stateTop.includes(
      "failed_attempt_evidence_sha256: \"sha256:1699d5429b12a5573b10be5b325a780f5a1c7d484b960fdb0758e64381391494\"",
    ) &&
    stateTop.includes("v2_08_authorized: false"),
  "STATE_CLOSED",
);
assert(
  latestLive.includes("failed-attempt-43.json") &&
    latestLive.includes(expected.closure) &&
    latestLive.includes("attempt43-cleanup-observation.json") &&
    latestLive.includes("attempt43-reconciliation-observation.json") &&
    latestLive.includes(expected.settledReconciliation) &&
    latestLive.includes("authority_mode: none_attempt43_consumed_output_finalization_400") &&
    latestLive.includes("pending_numeric_cap_usd: null") &&
    latestLive.includes("result: \"NOT_QUALIFIED_attempt43_output_finalization_400_clean\""),
  "STATE_LATEST_LIVE_CHECK",
);
assert(
  gate.includes(
    'last_run: "evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-43.json"',
  ) &&
    gate.includes("last_run_sha256: \"sha256:1699d5429b12a5573b10be5b325a780f5a1c7d484b960fdb0758e64381391494\"") &&
    gate.includes("latest_approved_authority_state: CONSUMED_CLOSED_DO_NOT_REUSE") &&
    gate.includes("pending_proposal: null") &&
    gate.includes("pending_authority: null") &&
    gate.includes("pending_numeric_cap_usd: null") &&
    gate.includes("provider_calls_authorized: false") &&
    gate.includes("provider_mutations_authorized: false") &&
    gate.includes("gpu_use_authorized: false") &&
    gate.includes("authority_mode: closed_consumed_attempt43_output_finalization_400") &&
    gate.includes("V2-08 forbidden") &&
    !gate.includes("provider_calls_authorized: true") &&
    !gate.includes("NOT_QUALIFIED_PENDING_EXECUTION_attempt43"),
  "GATE_CLOSED",
);
for (const [value, code] of [
  [stateTop, "STATE"],
  [gate, "GATE"],
  [startCurrent, "START"],
  [taskCurrent, "TASK"],
]) {
  assert(value.includes("NOT_QUALIFIED"), `${code}_NOT_QUALIFIED`);
  assert(value.includes("V2-08"), `${code}_V2_08_FENCE`);
  assert(value.includes("1699d5429b12a5573b10be5b325a780f5a1c7d484b960fdb0758e64381391494"), `${code}_CLOSURE_POINTER`);
}
assert(
  !startCurrent.includes("pending bounded execution") &&
    !taskCurrent.includes("No provider call or spend has occurred") &&
    !taskCurrent.includes("approved anchor-refresh execution"),
  "NO_STALE_ACTIVE_ATTEMPT43",
);

console.log(
  "V2-07 Attempt43 closure validation PASS (output finalization failed closed; cleanup/reconciliation settled; no authority/cap remains)",
);
