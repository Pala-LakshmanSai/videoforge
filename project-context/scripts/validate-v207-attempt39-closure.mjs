import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveDir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification");
const candidateDir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate");
const paths = {
  closure: resolve(liveDir, "failed-attempt-39.json"),
  cleanup: resolve(liveDir, "attempt39-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt39-reconciliation-observation.json"),
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
  proposal: "sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57",
  authority: "sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b",
  acceptance: "sha256:d38096058821aa2d2eb76216960b1e6ceabee725328b55c82e47ce0828e74259",
  max1: "sha256:26387b6f18d354af2ec9f034a3bbdb0645fcd50abe932f49278c16f36b8e4b66",
  max2: "sha256:6c8093e0292d53c5288904bcedb36b5f26a4f98c1109a16c7a9be0e9ddbf870f",
  closure: "sha256:66f067c2789c5f1a725e764ea23b07a741fee90565ac87a5e0d5f3e8522f4e12",
  cleanup: "sha256:4dde8efb506f6cbceaaf7e8b66193eda251200ff872373664ee1e14b3ba70a68",
  reconciliation: "sha256:21cc221887ca44324948983e1ad4c001760cde7a9646b4faadfab7d15a2eb813",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  manifest: "sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  config: "sha256:09d2ee0905ec4556857aae9df05b449802916cdf9e0d8ec4615a91b6d1fa9d06",
  layer: "sha256:1b390600563d813a87e09c2fa075d52ea1c24558e83b67c5649aa422a2c69c78",
  diffId: "sha256:0391cef74dd661df3c2c7b8b4fea1b391063abea0cfc004c806078a004915163",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  endpoint: "sha256:1cef2f0db7960e6e5aa45ba805f1647b65df97b5ac01aa3e86d288f0cefaa22e",
  template: "sha256:579e2fea24b50faa6dd718267dcf9d77958d548bfbec5b745dcb50afebab613d",
  liveResult: "sha256:9b4e1e381026a612e94b9f2ea814a18940aceaf85b47e96f50b0ba9c38a45c17",
  orchestrator: "sha256:e5490f5744b9528482c50f7dd0c837be799336486b8307cc26b851e827e207ae",
};

const fail = (code) => { throw new Error(`V207_ATTEMPT39_CLOSURE_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const has = (value, needle, code) => assert(value.includes(needle), `${code}_${needle}`);

for (const name of ["proposal", "authority", "acceptance", "max1", "max2", "closure", "cleanup", "reconciliation"]) {
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const acceptance = json(paths.acceptance);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);

assert(proposal.attempt === 39 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "PROPOSAL_SCOPE");
assert(proposal.lineage?.final_image === expected.image && proposal.lineage?.image_manifest_sha256 === expected.manifest && proposal.lineage?.image_config_sha256 === expected.config && proposal.lineage?.image_layer_sha256 === expected.layer && proposal.lineage?.image_layer_diff_id === expected.diffId && proposal.lineage?.model === expected.model && proposal.lineage?.model_manifest_sha256 === expected.modelManifest && proposal.lineage?.volume_id_sha256 === expected.mageVolume && proposal.lineage?.volume_mount === "/runpod-volume" && proposal.lineage?.volume_region === "EU-RO-1" && proposal.lineage?.volume_size_gb === 50 && proposal.lineage?.control_source_commit === "5aa2ccae639052fb61312a3b5a830402c275a2f8", "PROPOSAL_LINEAGE");
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 && proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "PROPOSAL_CONFIGS");
assert(max1.workers_min === 0 && max1.workers_max === 1 && max1.flashboot === true && max1.flex_only === true && max1.compute_type === "GPU" && max1.region === "EU-RO-1" && max1.network_volume_id_sha256 === expected.mageVolume && max1.image === expected.image, "MAX1_IDENTITY");
assert(max2.workers_min === 0 && max2.workers_max === 2 && max2.flashboot === true && max2.flex_only === true && max2.compute_type === "GPU" && max2.region === "EU-RO-1" && max2.network_volume_id_sha256 === expected.mageVolume && max2.image === expected.image, "MAX2_IDENTITY");
assert(authority.attempt === 39 && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && authority.proposal?.sha256 === expected.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.flashboot_true_accepted === true && authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.consumed === false, "AUTHORITY_IMMUTABLE_PREEXECUTION");
assert(acceptance.attempt === 39 && acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate?.authority_sha256 === expected.authority && acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4, "ACCEPTANCE_BINDING");

assert(closure.schema_version === "videoforge.v2-07-attempt39-failed-closed/v1" && closure.attempt === 39 && closure.result === "NOT_QUALIFIED_OUTPUT_LINEAGE_INVALID_CLEAN" && closure.qualification_status === "NOT_QUALIFIED", "CLOSURE_SCOPE");
assert(closure.proposal?.sha256 === expected.proposal && closure.authority?.sha256 === expected.authority && closure.authority?.state === "CONSUMED_CLOSED_DO_NOT_REUSE" && closure.authority?.maximum_cumulative_finite_spend_usd === 4, "CLOSURE_AUTHORITY");
assert(closure.lineage?.image === expected.image && closure.lineage?.image_manifest_sha256 === expected.manifest && closure.lineage?.image_config_sha256 === expected.config && closure.lineage?.image_layer_sha256 === expected.layer && closure.lineage?.image_layer_diff_id === expected.diffId && closure.lineage?.model === expected.model && closure.lineage?.model_manifest_sha256 === expected.modelManifest && closure.lineage?.mage_volume_id_sha256 === expected.mageVolume && closure.lineage?.mage_volume_mount === "/runpod-volume" && closure.lineage?.mage_volume_region === "EU-RO-1" && closure.lineage?.mage_volume_size_gb === 50 && JSON.stringify(closure.lineage?.gpu_allowlist) === JSON.stringify(["NVIDIA GeForce RTX 4090"]), "CLOSURE_LINEAGE");
assert(closure.raw_evidence?.live_result_sha256 === expected.liveResult && closure.raw_evidence?.orchestrator_sha256 === expected.orchestrator && closure.raw_evidence?.raw_provider_ids_urls_bodies_or_secrets_retained === false, "RAW_EVIDENCE");
assert(closure.execution?.provider_job_count === 1 && closure.execution?.provider_terminal_status === "COMPLETED" && closure.execution?.provider_output_status === "SUCCEEDED" && closure.execution?.failure_stage === "output_lineage" && closure.execution?.error === "MAGE_OUTPUT_NOT_SUCCEEDED" && closure.execution?.error_category === "output_contract" && closure.execution?.failure_code === "MAGE_OUTPUT_LINEAGE_INVALID" && JSON.stringify(closure.execution?.output_shape_keys) === JSON.stringify(["items", "provenance_receipt", "status"]), "OUTPUT_FAILURE");
assert(closure.execution?.approved_cap_usd === 4 && closure.execution?.baseline_cumulative_endpoint_spend_usd === 1.5246469744015485 && closure.execution?.cumulative_billing_threshold_usd === 5.5246469744015485 && closure.execution?.final_cumulative_endpoint_spend_usd === 1.5246469744015485 && closure.execution?.incremental_spend_usd === 0 && closure.execution?.accepted_batches === 0 && closure.execution?.durable_output_readbacks === 0 && closure.execution?.v3_receipts === 0 && closure.execution?.generated_output_rollback === "CONFIRMED" && closure.execution?.qualification_claim_allowed === false, "EXECUTION_STOP");
assert(closure.sealed_volume?.manifest_verified_before_execution === true && closure.sealed_volume?.manifest_or_volume_hash_unchanged === true && closure.sealed_volume?.model_volume_writes_observed === false && closure.sealed_volume?.cross_mount_observed === false && closure.sealed_volume?.cache_escape_observed === false && closure.sealed_volume?.runtime_download_or_quantization_observed === false, "SEALED_VOLUME");

assert(cleanup.schema_version === "videoforge.v2-07-attempt39-cleanup-observation/v1" && cleanup.attempt === 39 && cleanup.proposal_sha256 === expected.proposal && cleanup.authority_sha256 === expected.authority && cleanup.result === "RUNPOD_CLEAN_CLOUDFLARE_ROUTE_RESTORED", "CLEANUP_SCOPE");
assert(cleanup.runpod_cleanup?.endpoint_id_sha256 === expected.endpoint && cleanup.runpod_cleanup?.template_id_sha256 === expected.template && cleanup.runpod_cleanup?.endpoint_deleted === true && cleanup.runpod_cleanup?.template_deleted === true && cleanup.runpod_cleanup?.final_disposable_resources_absent === true && cleanup.runpod_cleanup?.stable_terminal_snapshots_before_delete === 2 && cleanup.runpod_cleanup?.terminal_worker_record_count === 2 && cleanup.runpod_cleanup?.terminal_pod_record_count === 2 && cleanup.runpod_cleanup?.gpu_jobs_submitted === 1 && cleanup.runpod_cleanup?.accepted_outputs === 0 && cleanup.runpod_cleanup?.generated_output_rollback === "CONFIRMED", "RUNPOD_CLEANUP");
assert(cleanup.cloudflare_cleanup?.ephemeral_signer_secret_deleted === true && cleanup.cloudflare_cleanup?.worker_version_restored === true && cleanup.cloudflare_cleanup?.active_version_record_hash_restored === true && cleanup.cloudflare_cleanup?.captured_route_status === 404 && cleanup.cloudflare_cleanup?.captured_route_code === "V207_ROUTE_DISABLED" && cleanup.cloudflare_cleanup?.restored_route_status === 404 && cleanup.cloudflare_cleanup?.restored_route_code === "V207_ROUTE_DISABLED" && cleanup.cloudflare_cleanup?.exact_captured_fingerprint_restored === true && cleanup.cloudflare_cleanup?.cleanup_uncertain === false, "CLOUDFLARE_CLEANUP");
assert(cleanup.final_reconciliation?.evidence === "attempt39-reconciliation-observation.json" && cleanup.final_reconciliation?.stable_reads === 3 && cleanup.final_reconciliation?.pods === 0 && cleanup.final_reconciliation?.endpoints === 0 && cleanup.final_reconciliation?.private_templates === 0 && cleanup.final_reconciliation?.active_serverless_workers === 0 && cleanup.final_reconciliation?.running_pods === 0, "CLEANUP_RECONCILIATION");
assert(cleanup.retention?.mage_volume_retained === true && cleanup.retention?.soulx_volume_retained === true && cleanup.retention?.retained_volume_write_delete_rebuild_or_cross_mount === false && cleanup.retention?.ongoing_two_volume_charge_usd_per_month === 7, "RETENTION");

assert(reconciliation.schema_version === "videoforge.v2-07-attempt39-readonly-reconciliation/v1" && reconciliation.attempt === 39 && reconciliation.stable_read_count === 3 && reconciliation.inventory?.pods === 0 && reconciliation.inventory?.endpoints === 0 && reconciliation.inventory?.private_templates === 0 && reconciliation.inventory?.active_serverless_workers === 0 && reconciliation.inventory?.running_pods === 0, "RECONCILIATION_INVENTORY");
const volumes = new Map((reconciliation.inventory?.retained_volumes ?? []).map((volume) => [volume.purpose, volume]));
assert(volumes.get("Mage")?.id_sha256 === expected.mageVolume && volumes.get("Mage")?.size_gb === 50 && volumes.get("Mage")?.region === "EU-RO-1" && volumes.get("SoulX")?.id_sha256 === expected.soulxVolume && volumes.get("SoulX")?.size_gb === 50 && volumes.get("SoulX")?.region === "EU-RO-1", "RETAINED_VOLUMES");
assert(reconciliation.billing?.baseline_endpoint_spend_usd === 1.5246469744015485 && reconciliation.billing?.final_endpoint_spend_usd === 1.5246469744015485 && reconciliation.billing?.settled_incremental_spend_usd === 0 && reconciliation.billing?.maximum_cumulative_finite_spend_usd === 4 && reconciliation.billing?.within_approved_cap === true && reconciliation.billing?.settlement === "THREE_STABLE_READS", "BILLING");
assert(reconciliation.mutation_boundary?.new_gpu_jobs === 1 && reconciliation.mutation_boundary?.accepted_outputs === 0 && reconciliation.mutation_boundary?.model_volume_writes === 0 && reconciliation.mutation_boundary?.volume_mutation_called === false && reconciliation.mutation_boundary?.cross_mount_observed === false && reconciliation.mutation_boundary?.secrets_or_raw_provider_ids_retained === false, "BOUNDARY");

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
for (const [value, code] of [[state, "STATE"], [gates, "GATES"], [start, "START"], [task, "TASK"]]) {
  has(value, "failed-attempt-39.json", code);
  has(value, "attempt39-cleanup-observation.json", code);
  has(value, "attempt39-reconciliation-observation.json", code);
  has(value, "V2-08", code);
}
has(state, "NOT_QUALIFIED_attempt39_output_lineage_invalid_clean", "STATE");
has(gates, "NOT_QUALIFIED_OUTPUT_LINEAGE_INVALID_CLEAN", "GATES");
has(start, "NOT_QUALIFIED", "START");
has(task, "NOT_QUALIFIED", "TASK");
has(state, "phase: serverless_v2_v2_07_attempt39_closed_not_qualified", "STATE");
has(state, "provider_calls_authorized: false", "STATE");
has(state, "remote_or_cloud_mutations_authorized: false", "STATE");
has(state, "gpu_use_authorized: false", "STATE");
has(state, "maximum_external_spend_usd: 0", "STATE");
has(state, "current_authority: null", "STATE");
has(gates, 'last_run: "evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-39.json"', "GATES");
has(gates, `last_run_sha256: "${expected.closure}"`, "GATES");
has(gates, "pending_proposal: null", "GATES");
has(gates, "pending_authority: null", "GATES");
has(gates, "provider_calls_authorized: false", "GATES");
has(gates, "gpu_use_authorized: false", "GATES");
assert(!state.includes("attempt39_approved_pending_execution") && !gates.includes("attempt39_approved_pending_execution") && !task.includes("Attempt39 approved bounded execution"), "NO_STALE_ACTIVE_ATTEMPT39");

console.log("V2-07 Attempt39 closure validation PASS (output-lineage failure closed; exact rollback; zero final RunPod resources; three stable reads; zero incremental spend)");
