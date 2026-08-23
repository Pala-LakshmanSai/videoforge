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
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt41-runner-diagnostic-read-retry-candidate",
);
const paths = {
  closure: resolve(liveDir, "failed-attempt-41.json"),
  cleanup: resolve(liveDir, "attempt41-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt41-reconciliation-observation.json"),
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
    "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
  authority:
    "sha256:2aec5d4846bfe8d6d1e658af9db7cf354a25611838f725472477b443d6291f9d",
  acceptance:
    "sha256:b32f70dcee108c0eea8b79496183eac9a7b207ce341dd4f75f60a20dd6579f19",
  max1:
    "sha256:879ec4844e01a667ea14d3d5ba47b89b5a77accf99c55cf3f40744a319c6cd3a",
  max2:
    "sha256:6ec51bd572c6e7377eae857ea811178296b818f2d993dcf587b0a93e2f0115e4",
  closure:
    "sha256:ecfc252b04cc8daa9c4ee85fb5991d7e8874d6cf2fcfd5321d99abf343731187",
  cleanup:
    "sha256:caaf90bc41ad65ecb8407c280f125e3317e86e386299220a317b5028f5bcab54",
  reconciliation:
    "sha256:2d86e63bdaa5029cc6f13495d68a38d7603c49e4830a614e466e971dd706d61e",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  manifest:
    "sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  config:
    "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  layer:
    "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  diffId:
    "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  source: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  control: "6a4053f6fdde6e906e10b7cb297d253a7b9af140",
  orchestrator:
    "sha256:60a89ba81336cfcae4441bb13dd89bb7e0ea71c5d0ca0f66ebd965eff8ecf67f",
  liveResult:
    "sha256:bc08a194659a216aa86803fbbcfc7be5541cf4160b41f22c11954152af926ffd",
  delayedReconciliation:
    "sha256:d257d9270cfc21bbefd2e2140f5f07a2bb41ab223311e91c6f11b0ee24b349b2",
  settlementReconciliation:
    "sha256:e97f2fb598a6f0f9465b9c7d13d11f6c7dd63a097a6dc67737a50659d8eaa936",
  lateSettlementReconciliation:
    "sha256:7d6b5a8ee0a8fbc0b3000cb2ccc68de0e320ae528ea55270d5db4de17845f88f",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT41_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) =>
  `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const has = (value, needle, code) => assert(value.includes(needle), `${code}_${needle}`);

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
  assert(!expected[name].includes("TODO"), `${name.toUpperCase()}_EXPECTED_HASH_MISSING`);
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const acceptance = json(paths.acceptance);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);
const max1 = json(paths.max1);
const max2 = json(paths.max2);

assert(proposal.attempt === 41 && proposal.checkpoint === "V2-07", "PROPOSAL_SCOPE");
assert(
  proposal.lineage?.final_image === expected.image &&
    proposal.lineage?.image_manifest_sha256 === expected.manifest &&
    proposal.lineage?.image_config_sha256 === expected.config &&
    proposal.lineage?.image_layer_sha256 === expected.layer &&
    proposal.lineage?.image_layer_diff_id === expected.diffId &&
    proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.modelManifest &&
    proposal.lineage?.image_source_commit === expected.source &&
    proposal.lineage?.control_source_commit === expected.control &&
    proposal.lineage?.volume_id_sha256 === expected.mageVolume &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_size_gb === 50,
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2,
  "PROPOSAL_CONFIGS",
);
for (const [config, workers, code] of [
  [max1, 1, "MAX1"],
  [max2, 2, "MAX2"],
]) {
  assert(
    config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.flex_only === true &&
      config.compute_type === "GPU" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      config.region === "EU-RO-1" &&
      config.network_volume_id_sha256 === expected.mageVolume &&
      config.image === expected.image,
    `${code}_IDENTITY`,
  );
}
assert(
  authority.attempt === 41 &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW",
  "AUTHORITY_IMMUTABLE",
);
assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.authority_sha256 === expected.authority,
  "ACCEPTANCE_BINDING",
);

assert(
  closure.attempt === 41 &&
    closure.result === "NOT_QUALIFIED_OUTPUT_READBACK_AUTHORITY_INVALID_CLEAN" &&
    closure.qualification_status === "NOT_QUALIFIED" &&
    closure.proposal?.sha256 === expected.proposal &&
    closure.authority?.sha256 === expected.authority &&
    closure.authority?.state === "CONSUMED_CLOSED_DO_NOT_REUSE",
  "CLOSURE_SCOPE",
);
assert(
  closure.lineage?.image === expected.image &&
    closure.lineage?.image_source_commit === expected.source &&
    closure.lineage?.control_source_commit === expected.control &&
    closure.lineage?.model === expected.model &&
    closure.lineage?.model_manifest_sha256 === expected.modelManifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.mageVolume &&
    closure.lineage?.mage_volume_mount === "/runpod-volume" &&
    JSON.stringify(closure.lineage?.gpu_allowlist) ===
      JSON.stringify(["NVIDIA GeForce RTX 4090"]),
  "CLOSURE_LINEAGE",
);
assert(
  closure.execution?.provider_job_count === 1 &&
    closure.execution?.gpu_jobs_submitted === 1 &&
    closure.execution?.provider_terminal_status === "COMPLETED" &&
    closure.execution?.provider_output_status === "SUCCEEDED" &&
    closure.execution?.failure_stage === "output_readback" &&
    closure.execution?.failure_code === "MAGE_OUTPUT_READBACK_AUTHORITY_INVALID" &&
    closure.execution?.generated_output_rollback === "CONFIRMED" &&
    closure.execution?.accepted_batches === 0 &&
    closure.execution?.durable_output_readbacks === 0 &&
    closure.execution?.v3_receipts === 0 &&
    closure.execution?.replacement_reached === false &&
    closure.execution?.cold_warm_reached === false &&
    closure.execution?.concurrent_reader_proof_reached === false &&
    closure.execution?.duplicate_compute === false &&
    closure.execution?.qualification_claim_allowed === false &&
    closure.execution?.timings?.queue_ms === 94981 &&
    closure.execution?.timings?.timing_contract_fulfilled === false &&
    closure.execution?.peak_vram_bytes === null,
  "EXECUTION_STOP",
);
assert(
  closure.sealed_volume?.manifest_verified_before_execution === true &&
    closure.sealed_volume?.manifest_or_volume_hash_unchanged === false &&
    closure.sealed_volume?.manifest_after_execution_comparison ===
      "NOT_PROVEN_AFTER_OUTPUT_FAILURE" &&
    closure.sealed_volume?.retained_volume_identity_unchanged === true &&
    closure.sealed_volume?.model_volume_writes_observed === false &&
    closure.sealed_volume?.application_model_files_read_only === true,
  "SEALED_VOLUME_EVIDENCE_BOUNDARY",
);
assert(
  closure.raw_evidence?.orchestrator_sha256 === expected.orchestrator &&
    closure.raw_evidence?.live_result_sha256 === expected.liveResult &&
    closure.raw_evidence?.delayed_reconciliation_sha256 === expected.delayedReconciliation &&
    closure.raw_evidence?.settlement_reconciliation_sha256 ===
      expected.settlementReconciliation &&
    closure.raw_evidence?.late_settlement_reconciliation_sha256 ===
      expected.lateSettlementReconciliation &&
    closure.raw_evidence?.raw_provider_ids_urls_bodies_or_secrets_retained === false &&
    closure.billing?.incremental_spend_usd === 0.046342222136445343 &&
    closure.billing?.within_approved_cap === true,
  "EVIDENCE_AND_BILLING",
);
assert(
  cleanup.result === "RUNPOD_CLEAN_CLOUDFLARE_ROUTE_RESTORED" &&
    cleanup.runpod_cleanup?.endpoint_created === true &&
    cleanup.runpod_cleanup?.private_template_created === true &&
    cleanup.runpod_cleanup?.endpoint_deleted === true &&
    cleanup.runpod_cleanup?.private_template_deleted === true &&
    cleanup.runpod_cleanup?.final_disposable_resources_absent === true &&
    cleanup.runpod_cleanup?.gpu_jobs_submitted === 1 &&
    cleanup.cloudflare_cleanup?.ephemeral_signer_secret_deleted === true &&
    cleanup.cloudflare_cleanup?.worker_version_restored === true &&
    cleanup.cloudflare_cleanup?.exact_captured_fingerprint_restored === true &&
    cleanup.cloudflare_cleanup?.restored_route_status === 404 &&
    cleanup.cloudflare_cleanup?.restored_route_code === "V207_ROUTE_DISABLED" &&
    cleanup.cloudflare_cleanup?.restored_route_probe_count === 3 &&
    JSON.stringify(cleanup.cloudflare_cleanup?.restored_route_probe_statuses) ===
      JSON.stringify([404, 404, 404]) &&
    cleanup.cloudflare_cleanup?.cleanup_uncertain === false,
  "CLEANUP",
);
assert(
  reconciliation.stable_read_count === 3 &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.intended_volume_count === 2 &&
    reconciliation.inventory?.final_disposable_resources_absent === true &&
    reconciliation.checked_at === "2026-08-23T06:24:45.876Z" &&
    reconciliation.raw_evidence?.settlement_reconciliation_sha256 ===
      expected.settlementReconciliation &&
    reconciliation.raw_evidence?.late_settlement_reconciliation_sha256 ===
      expected.lateSettlementReconciliation,
  "RECONCILIATION_INVENTORY",
);
const volumes = new Map(
  (reconciliation.inventory?.retained_volumes ?? []).map((volume) => [volume.purpose, volume]),
);
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.identity_unchanged === true &&
    !("unchanged" in volumes.get("Mage")) &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.identity_unchanged === true &&
    !("unchanged" in volumes.get("SoulX")) &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1",
  "RETAINED_VOLUMES",
);
assert(
  reconciliation.billing?.baseline_endpoint_spend_usd === 1.5246469744015485 &&
    reconciliation.billing?.final_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.settled_incremental_spend_usd === 0.046342222136445343 &&
    reconciliation.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation.billing?.within_approved_cap === true &&
    reconciliation.billing?.settlement === "THREE_STABLE_READS" &&
    reconciliation.mutation_boundary?.new_gpu_jobs === 1 &&
    reconciliation.mutation_boundary?.accepted_outputs === 0 &&
    reconciliation.mutation_boundary?.model_volume_writes === 0 &&
    reconciliation.mutation_boundary?.volume_mutation_called === false,
  "RECONCILIATION_BOUNDARY",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
for (const [value, code] of [
  [state, "STATE"],
  [gates, "GATES"],
  [start, "START"],
  [task, "TASK"],
]) {
  has(value, "failed-attempt-41.json", code);
  has(value, expected.closure, code);
  has(value, "V2-08", code);
  has(value, "NOT_QUALIFIED", code);
}
has(state, "phase: serverless_v2_v2_07_attempt41_closed_not_qualified", "STATE_PHASE");
has(state, "provider_calls_authorized: false", "STATE_PROVIDER");
has(state, "remote_or_cloud_mutations_authorized: false", "STATE_MUTATION");
has(state, "gpu_use_authorized: false", "STATE_GPU");
has(state, "maximum_external_spend_usd: 0", "STATE_CAP");
has(state, "current_authority: null", "STATE_AUTHORITY");
has(gates, "latest_closed_result: NOT_QUALIFIED_OUTPUT_READBACK_AUTHORITY_INVALID_CLEAN", "GATES_RESULT");
has(gates, "pending_authority: null", "GATES_AUTHORITY");
has(gates, "provider_calls_authorized: false", "GATES_PROVIDER");
assert(
  !state.includes("attempt41_approved_pending_execution") &&
    !state.includes("APPROVED_SINGLE_USE_PENDING_EXECUTION_attempt41") &&
    !gates.includes("attempt41_bounded_mutation_authorized") &&
    !gates.includes("APPROVED_SINGLE_USE_PENDING_EXECUTION_attempt41"),
  "NO_STALE_ACTIVE_ATTEMPT41",
);

console.log(
  "V2-07 Attempt41 closure validation PASS (output readback authority failure; exact route rollback; zero final disposable resources; late-settled cost within cap)",
);
