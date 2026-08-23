#!/usr/bin/env node

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
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt46-deploy-diagnostic-canonical-repair-candidate",
);

const paths = {
  proposal: resolve(candidateDir, "combined-live-proposal.json"),
  acceptance: resolve(candidateDir, "acceptance.json"),
  authority: resolve(candidateDir, "approved-authority.json"),
  max1: resolve(candidateDir, "staged-config-max1.json"),
  max2: resolve(candidateDir, "staged-config-max2.json"),
  closure: resolve(liveDir, "failed-attempt-46.json"),
  cleanup: resolve(liveDir, "attempt46-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt46-reconciliation-observation.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};

const expected = {
  proposal:
    "sha256:653c44ceeb3aa3948dade2f7b2d0c68904152aeee66392f826b3b1ffd7b9c259",
  acceptance:
    "sha256:4e467eaf9190cb6cc93e344fdc608fcbc49c7bc6e99d7f68fe055e149484d5e8",
  authority:
    "sha256:86b5810de7fb360182c5ade95d2d0f4349cb76175cc41b4e10923e78262f5588",
  max1:
    "sha256:624dafe2f1a5fdfbf0435b87e3eecaca997281386d4a6c41339bfb5e78eb457a",
  max2:
    "sha256:9774e90daf86cfa8f7f8f17c4bd9319475ac5881d0c2667ca61f0a7412a9bfcb",
  closure:
    "sha256:e333bc34e7fbc72bf123e32ce65d28ee8a85da4e6b3542db929a4e63a520e8d2",
  cleanup:
    "sha256:f1a82b50408b8ad7a99beffcf4daf6a69976a5cd58620d314a4d873e463b3d75",
  reconciliation:
    "sha256:cf06ca26a87f25f5e95285f782289823b2f57766d1915fe3dc88dc7ec48b476b",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageSourceCommit: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  imageConfig:
    "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  imageLayer:
    "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  imageDiff:
    "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  canonicalActivation:
    "sha256:858ebe43ef8ad6558825d6b1c756311a8944cd2ef27e58f42651d793ab191da9",
  orchestrator:
    "sha256:d8aa5ded8cd67141ad951f774245f8181adb34c1f3fafe2cc047ff244ae5f894",
  liveQualification:
    "sha256:c5187fb9636d53e214d90f60c1a67a13ed06dc47c558f4869628b6d09a27a9c5",
  orchestratorResult:
    "sha256:6a69bbe05ed1cd3af6ed6e0d3f20d137238c3d2288936404864f2df2e120df4f",
  protectedConfig:
    "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774",
  effectiveEndpointConfig:
    "sha256:eda4755459dc6074e0be6e58f5e024568ff9d4d1fcb6e271d0a247a80686e11d",
  priorAttempt45Closure:
    "sha256:f287a7ec8ea064587e251f5ccb9b5321025d37976fdbf40b0b894a962c71167c",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT46_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (file) => readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) =>
  `sha256:${createHash("sha256").update(bytes(file)).digest("hex")}`;
const has = (value, needle, code) => assert(value.includes(needle), code);
const eq = (actual, expectedValue, code) => assert(actual === expectedValue, code);

for (const name of [
  "proposal",
  "acceptance",
  "authority",
  "max1",
  "max2",
  "closure",
  "cleanup",
  "reconciliation",
]) {
  eq(sha(paths[name]), expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);

assert(
  proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 46,
  "PROPOSAL_SCOPE",
);
assert(
  acceptance.checkpoint === "V2-07" &&
    acceptance.task_id === "VF-10-07" &&
    acceptance.attempt === 46 &&
    acceptance.proposal_sha256 === expected.proposal &&
    acceptance.staged_max1_sha256 === expected.max1 &&
    acceptance.staged_max2_sha256 === expected.max2 &&
    acceptance.canonical_activation_source_sha256 === expected.canonicalActivation &&
    acceptance.orchestrator_source_sha256 === expected.orchestrator &&
    acceptance.live_qualification_source_sha256 === expected.liveQualification,
  "ACCEPTANCE_LINEAGE",
);
assert(
  authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === 46 &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.acceptance?.sha256 === expected.acceptance &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW-or-better" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.single_use === true &&
    authority.approval?.consumed === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.historical_cap_reused === false,
  "AUTHORITY_APPROVAL",
);

const proposalLineage = proposal.lineage;
const authorityLineage = authority.lineage;
assert(
  proposalLineage?.image === expected.image &&
    proposalLineage.image_source_commit === expected.imageSourceCommit &&
    proposalLineage.model === expected.model &&
    proposalLineage.model_manifest_sha256 === expected.manifest &&
    proposalLineage.image_config_sha256 === expected.imageConfig &&
    proposalLineage.image_layer_sha256 === expected.imageLayer &&
    proposalLineage.image_layer_diff_id === expected.imageDiff &&
    proposalLineage.volume_id_sha256 === expected.mageVolume &&
    proposalLineage.volume_size_gb === 50 &&
    proposalLineage.volume_region === "EU-RO-1" &&
    proposalLineage.volume_mount === "/runpod-volume" &&
    proposalLineage.model_root === "/runpod-volume/mage-model" &&
    proposalLineage.gpu === "NVIDIA GeForce RTX 4090" &&
    proposalLineage.flashboot === true &&
    proposalLineage.canonical_activation_source_sha256 === expected.canonicalActivation &&
    proposalLineage.orchestrator_source_sha256 === expected.orchestrator &&
    proposalLineage.live_qualification_source_sha256 === expected.liveQualification,
  "PROPOSAL_EXACT_LINEAGE",
);
assert(
  authorityLineage?.model === expected.model &&
    authorityLineage.model_manifest_sha256 === expected.manifest &&
    authorityLineage.image === expected.image &&
    authorityLineage.image_source_commit === expected.imageSourceCommit &&
    authorityLineage.image_config_sha256 === expected.imageConfig &&
    authorityLineage.image_layer_sha256 === expected.imageLayer &&
    authorityLineage.image_layer_diff_id === expected.imageDiff &&
    authorityLineage.volume_id_sha256 === expected.mageVolume &&
    authorityLineage.volume_size_gb === 50 &&
    authorityLineage.volume_region === "EU-RO-1" &&
    authorityLineage.volume_mount === "/runpod-volume" &&
    authorityLineage.model_root === "/runpod-volume/mage-model" &&
    authorityLineage.gpu === "NVIDIA GeForce RTX 4090" &&
    authorityLineage.flashboot === true &&
    authorityLineage.canonical_activation_source_sha256 === expected.canonicalActivation &&
    authorityLineage.orchestrator_source_sha256 === expected.orchestrator &&
    authorityLineage.live_qualification_source_sha256 === expected.liveQualification &&
    authorityLineage.initial_config_sha256 === expected.max1 &&
    authorityLineage.concurrent_reader_config_sha256 === expected.max2 &&
    authorityLineage.prior_attempt45_closure_sha256 === expected.priorAttempt45Closure,
  "AUTHORITY_EXACT_LINEAGE",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.sha256 === expected.max2,
  "PROPOSAL_STAGED_CONFIGS",
);

assert(
  closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 46 &&
    closure.result ===
      "NOT_QUALIFIED_ATTEMPT46_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE_CLEAN" &&
    closure.qualification_status === "NOT_QUALIFIED" &&
    closure.authority?.path?.endsWith("approved-authority.json") &&
    closure.authority?.sha256 === expected.authority &&
    closure.authority?.maximum_cumulative_finite_spend_usd === 4 &&
    closure.authority?.single_use === true &&
    closure.authority?.consumed === true &&
    closure.authority?.reusable === false,
  "CLOSURE_SCOPE_AND_CONSUMPTION",
);
assert(
  closure.proposal?.sha256 === expected.proposal &&
    closure.lineage?.authority_commit === "a754446" &&
    closure.lineage?.control_source_commit === "926b149" &&
    closure.lineage?.canonical_activation_source_sha256 === expected.canonicalActivation &&
    closure.lineage?.orchestrator_source_sha256 === expected.orchestrator &&
    closure.lineage?.live_qualification_source_sha256 === expected.liveQualification &&
    closure.lineage?.image === expected.image &&
    closure.lineage?.image_source_commit === expected.imageSourceCommit &&
    closure.lineage?.image_config_sha256 === expected.imageConfig &&
    closure.lineage?.image_layer_sha256 === expected.imageLayer &&
    closure.lineage?.image_layer_diff_id === expected.imageDiff &&
    closure.lineage?.model === expected.model &&
    closure.lineage?.model_manifest_sha256 === expected.manifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.mageVolume &&
    closure.lineage?.mage_volume_size_gb === 50 &&
    closure.lineage?.mage_volume_region === "EU-RO-1" &&
    closure.lineage?.mage_volume_mount === "/runpod-volume" &&
    closure.lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    closure.lineage?.flashboot === true &&
    closure.lineage?.max1_sha256 === expected.max1 &&
    closure.lineage?.max2_sha256 === expected.max2 &&
    closure.lineage?.effective_endpoint_config_sha256 === expected.effectiveEndpointConfig &&
    closure.lineage?.protected_config_sha256 === expected.protectedConfig &&
    closure.lineage?.protected_config_mode === "0600",
  "CLOSURE_EXACT_LINEAGE",
);

const execution = closure.execution;
assert(
  execution?.failure_code ===
    "RUNPOD_PROCESS_REPLACEMENT_WORKER_IDENTITY_UNAVAILABLE" &&
    execution.failure_stage === "post_probe_process_replacement_identity_proof" &&
    execution.orchestrator_path === "/tmp/videoforge-v207-attempt46-live-orchestrator.json" &&
    execution.orchestrator_sha256 === expected.orchestratorResult &&
    execution.live_result_path === "/tmp/videoforge-v207-live-result.json" &&
    /^[a-f0-9]{64}$/.test(execution.live_result_sha256?.replace(/^sha256:/, "")) &&
    execution.runpod_endpoint_or_template_created === true &&
    execution.runpod_jobs_submitted === 1 &&
    execution.gpu_use === true &&
    execution.accepted_batches === 1 &&
    execution.accepted_outputs === 1 &&
    execution.durable_readbacks === 1 &&
    execution.v3_receipts === 1 &&
    execution.unplanned_duplicate_compute_observed === false,
  "EXECUTION_FAILURE_AND_PROBE",
);
for (const [field, code] of [
  ["complete_cold_batch_reached", "COLD_BATCH_UNREACHED"],
  ["complete_warm_batch_reached", "WARM_BATCH_UNREACHED"],
  ["duplicate_delivery_test_reached", "DUPLICATE_TEST_UNREACHED"],
  ["two_reader_test_reached", "TWO_READER_TEST_UNREACHED"],
  ["cancel_test_reached", "CANCEL_TEST_UNREACHED"],
  ["timeout_test_reached", "TIMEOUT_TEST_UNREACHED"],
]) {
  eq(execution?.[field], false, code);
}

const probe = closure.owned_probe;
assert(
  probe?.provider_status === "COMPLETED" &&
    probe.item_count === 1 &&
    Number.isInteger(probe.durable_output_bytes) &&
    probe.durable_output_bytes > 0 &&
    /^[a-f0-9]{64}$/.test(probe.durable_output_sha256?.replace(/^sha256:/, "")) &&
    /^[a-f0-9]{64}$/.test(probe.artifact_commit_receipt_sha256?.replace(/^sha256:/, "")) &&
    /^[a-f0-9]{64}$/.test(probe.signed_provenance_receipt_sha256?.replace(/^sha256:/, "")) &&
    probe.receipt_replay_confirmed === true &&
    probe.worker_id_sha256 === probe.pod_id_sha256 &&
    probe.peak_vram_used_bytes > 0 &&
    probe.provider_execution_time_ms > 0 &&
    probe.model_load_ms > 0 &&
    probe.warmup_ms > 0 &&
    probe.first_inference_ms > 0 &&
    probe.upload_ms > 0,
  "SUCCESSFUL_PROBE_OUTPUT_READBACK_RECEIPT",
);

assert(
  closure.volume_integrity?.offline_manifest_verified_before_dispatch === true &&
    closure.volume_integrity.manifest_sha256 === expected.manifest &&
    closure.volume_integrity.retained_volume_identity_reverified_after_probe === true &&
    closure.volume_integrity.retained_volume_write_or_delete_observed === false &&
    closure.volume_integrity.post_worker_complete_manifest_hash_proof_reached === false &&
    closure.volume_integrity.no_model_volume_write_gate_complete === false &&
    closure.volume_integrity.cache_escape_gate_complete === false,
  "VOLUME_INTEGRITY_AND_UNREACHED_GATES",
);

eq(closure.cleanup?.evidence, "attempt46-cleanup-observation.json", "CLOSURE_CLEANUP_PATH");
eq(closure.cleanup?.sha256, expected.cleanup, "CLOSURE_CLEANUP_HASH");
eq(closure.reconciliation?.evidence, "attempt46-reconciliation-observation.json", "CLOSURE_RECON_PATH");
eq(closure.reconciliation?.sha256, expected.reconciliation, "CLOSURE_RECON_HASH");

assert(
  cleanup.schema_version === "videoforge.v2-07-attempt46-cleanup-observation/v1" &&
    cleanup.checkpoint === "V2-07" &&
    cleanup.task_id === "VF-10-07" &&
    cleanup.attempt === 46 &&
    cleanup.result === "CLEAN_ROLLBACK_CONFIRMED_AFTER_NARROW_EXACT_CLEANUP" &&
    cleanup.failure_code === execution.failure_code &&
    cleanup.orchestrator?.sha256 === execution.orchestrator_sha256 &&
    cleanup.live_result?.sha256 === execution.live_result_sha256 &&
    cleanup.cloudflare?.pre_mutation_route === "404 V207_ROUTE_DISABLED" &&
    cleanup.cloudflare?.signer_secret_activated === true &&
    cleanup.cloudflare?.signer_secret_deleted === true &&
    cleanup.cloudflare?.worker_rollback_confirmed === true &&
    cleanup.cloudflare?.restored_route === "404 V207_ROUTE_DISABLED" &&
    cleanup.cloudflare?.restored_route_confirmed_at,
  "CLEANUP_ROUTE_ROLLBACK",
);
assert(
  cleanup.protected_config?.path ===
    "/Users/lakshmansai/.config/videoforge/v2-06/wrangler-current-3d8d467.json" &&
    cleanup.protected_config.mode === "0600" &&
    cleanup.protected_config.sha256 === expected.protectedConfig &&
    cleanup.protected_config.unchanged === true &&
    cleanup.runpod?.endpoint_deleted === true &&
    cleanup.runpod?.template_deleted === true &&
    cleanup.runpod?.final_disposable_resources_absent === true &&
    cleanup.runpod?.stable_terminal_snapshot_count === 2 &&
    cleanup.runpod?.jobs_submitted === 1 &&
    cleanup.runpod?.gpu_use === true &&
    cleanup.retained_volumes_deleted_or_mutated_by_cleanup === false &&
    cleanup.cleanup_uncertain === false &&
    cleanup.authority_consumed === true &&
    cleanup.retry_under_same_authority_forbidden === true &&
    cleanup.v2_08_authorized === false,
  "CLEANUP_DISPOSABLES_CONFIG_RETENTION",
);

assert(
  reconciliation.schema_version === "videoforge.v2-07-attempt46-readonly-reconciliation/v1" &&
    reconciliation.checkpoint === "V2-07" &&
    reconciliation.task_id === "VF-10-07" &&
    reconciliation.attempt === 46 &&
    reconciliation.result === "PASS_THREE_STABLE_READS_ZERO_DISPOSABLE_RESOURCES" &&
    reconciliation.provider_mutations_during_reconciliation === 0 &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.retained_volumes?.length === 2 &&
    reconciliation.billing?.baseline_endpoint_spend_usd ===
      reconciliation.billing?.final_endpoint_spend_usd &&
    reconciliation.billing?.observed_increment_usd === 0 &&
    reconciliation.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation.billing?.within_approved_cap === true &&
    reconciliation.billing?.settlement === "THREE_STABLE_READS" &&
    reconciliation.retention?.mage_volume_retained === true &&
    reconciliation.retention?.soulx_volume_retained === true &&
    reconciliation.retention?.volume_mutation_authorized === false &&
    reconciliation.retention?.volume_mutation_observed === false &&
    reconciliation.retention?.existing_two_volume_charge_usd_per_month === 7 &&
    reconciliation.v2_08_authorized === false,
  "RECONCILIATION_ZERO_RESOURCES_THREE_READS_CAP",
);
const volumes = new Map(
  reconciliation.inventory.retained_volumes.map((volume) => [volume.purpose, volume]),
);
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("Mage")?.mount === "/runpod-volume" &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1",
  "RETAINED_VOLUME_IDENTITIES",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const surfaces = { state, gates, start, task };
for (const [name, surface] of Object.entries(surfaces)) {
  if (name === "task") {
    has(surface, expected.closure, `${name.toUpperCase()}_CLOSURE_POINTER`);
  } else {
    has(surface, "failed-attempt-46.json", `${name.toUpperCase()}_CLOSURE_POINTER`);
  }
  has(surface, expected.closure, `${name.toUpperCase()}_CLOSURE_HASH`);
  has(surface, expected.proposal, `${name.toUpperCase()}_PROPOSAL_HASH`);
  has(surface, expected.authority, `${name.toUpperCase()}_AUTHORITY_HASH`);
  has(surface, "NOT_QUALIFIED", `${name.toUpperCase()}_NOT_QUALIFIED`);
  has(surface, "V2-08", `${name.toUpperCase()}_V208_FENCE`);
}
assert(
  /^phase:\s*serverless_v2_v2_07_(?:attempt46_[^\n]*(?:closed|not_qualified)|attempt47_(?:provider_free_candidate|bounded_mutation)[^\n]*)/m.test(
    state,
  ),
  "STATE_CLOSED_PHASE",
);

const stateAuthorityStart = state.indexOf("provider_authority_attempt46:");
const stateAuthorityEnd = state.indexOf("\nprovider_authority:", stateAuthorityStart);
const stateAuthority = state.slice(
  stateAuthorityStart,
  stateAuthorityEnd > stateAuthorityStart ? stateAuthorityEnd : undefined,
);
assert(stateAuthorityStart >= 0, "STATE_ATTEMPT46_AUTHORITY_BLOCK");
for (const [needle, code] of [
  ["authority_state: CONSUMED_CLOSED_DO_NOT_REUSE", "STATE_AUTHORITY_CONSUMED"],
  ["mode: none", "STATE_AUTHORITY_MODE_CLOSED"],
  ["consumed: true", "STATE_AUTHORITY_CONSUMED_BOOL"],
  ["reusable: false", "STATE_AUTHORITY_NONREUSABLE"],
  ["maximum_cumulative_finite_spend_usd: 0", "STATE_AUTHORITY_CAP_ZERO"],
  ["provider_calls_authorized: false", "STATE_AUTHORITY_PROVIDER_OFF"],
  ["provider_mutations_authorized: false", "STATE_AUTHORITY_MUTATION_OFF"],
  ["gpu_use_authorized: false", "STATE_AUTHORITY_GPU_OFF"],
  ["closure_evidence: evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-46.json", "STATE_AUTHORITY_CLOSURE"],
  [`closure_evidence_sha256: "${expected.closure}"`, "STATE_AUTHORITY_CLOSURE_HASH"],
]) {
  has(stateAuthority, needle, code);
}

const stateNextStart = state.indexOf("recommended_next_task:");
const stateVerificationStart = state.indexOf("\nverification:", stateNextStart);
const stateNext = state.slice(
  stateNextStart,
  stateVerificationStart > stateNextStart ? stateVerificationStart : undefined,
);
assert(stateNextStart >= 0, "STATE_NEXT_TASK_BLOCK");
for (const [needle, code] of [
  [/task_stage:\s*(?:provider_free_(?:candidate|repair)|bounded_mutation)/, "STATE_NEXT_SAFE_SUCCESSOR"],
  [/current_goal_authority:\s*(?:null|evidence\/acceptance\/VF-10-07\/2026-08-23-attempt47-terminal-pod-identity-repair-candidate\/approved-authority\.json)/, "STATE_NEXT_AUTHORITY"],
  [/provider_calls_authorized:\s*(?:false|true)/, "STATE_NEXT_PROVIDER_BOUNDARY"],
  [/maximum_external_spend_usd:\s*(?:0|4)/, "STATE_NEXT_CAP"],
  [/remote_or_cloud_mutations_authorized:\s*(?:false|true)/, "STATE_NEXT_MUTATION_BOUNDARY"],
  [/gpu_use_authorized:\s*(?:false|true)/, "STATE_NEXT_GPU_BOUNDARY"],
]) {
  if (needle instanceof RegExp) {
    assert(needle.test(stateNext), code);
  } else {
    has(stateNext, needle, code);
  }
}
assert(
  /execution_status:\s*(?:attempt46_[^\n]*(?:closed|not_qualified)|attempt47_(?:provider_free_candidate|approved_single_use)[^\n]*)/.test(
    stateNext,
  ),
  "STATE_NEXT_CLOSED_STATUS",
);

const verificationStart = state.indexOf("verification:");
const verification = state.slice(verificationStart);
for (const [needle, code] of [
  ["failed-attempt-46.json", "STATE_VERIFICATION_CLOSURE"],
  [expected.closure, "STATE_VERIFICATION_CLOSURE_HASH"],
  ["attempt46-cleanup-observation.json", "STATE_VERIFICATION_CLEANUP"],
  ["attempt46-reconciliation-observation.json", "STATE_VERIFICATION_RECON"],
  [
    /authority_mode:\s*none_attempt46_consumed_[^\n]*process_replacement[^\n]*/,
    "STATE_VERIFICATION_AUTHORITY_MODE",
  ],
  ["pending_numeric_cap_usd: null", "STATE_VERIFICATION_CAP_NULL"],
  ["authority_path: null", "STATE_VERIFICATION_AUTHORITY_NULL"],
  ["result: \"NOT_QUALIFIED_attempt46_process_replacement_worker_identity_unavailable_clean\"", "STATE_VERIFICATION_RESULT"],
  ["accepted_complete_probe_outputs: 1", "STATE_VERIFICATION_PROBE_OUTPUT"],
  ["accepted_total_durable_readbacks: 1", "STATE_VERIFICATION_READBACK"],
  ["accepted_total_v3_receipts: 1", "STATE_VERIFICATION_RECEIPT"],
  ["provider_disposable_resources_absent: true", "STATE_VERIFICATION_RESOURCES"],
  ["retained_volume_count: 2", "STATE_VERIFICATION_VOLUMES"],
  ["settled_incremental_spend_usd: 0", "STATE_VERIFICATION_SPEND"],
  ["cleanup_uncertain: false", "STATE_VERIFICATION_CLEANUP_CERTAINTY"],
  ["cancellation_proof: false", "STATE_VERIFICATION_CANCEL_UNREACHED"],
  ["timeout_proof: false", "STATE_VERIFICATION_TIMEOUT_UNREACHED"],
]) {
  if (needle instanceof RegExp) {
    assert(needle.test(verification), code);
  } else {
    has(verification, needle, code);
  }
}

const latestLiveStart = state.indexOf("  latest_live_check:");
const latestSourceStart = state.indexOf("\n  latest_source_verification:", latestLiveStart);
const latestLive = state.slice(
  latestLiveStart,
  latestSourceStart > latestLiveStart ? latestSourceStart : undefined,
);
assert(latestLiveStart >= 0, "STATE_LATEST_LIVE_CHECK");
for (const [needle, code] of [
  ["failed-attempt-46.json", "STATE_LATEST_CLOSURE"],
  [expected.closure, "STATE_LATEST_CLOSURE_HASH"],
  [expected.proposal, "STATE_LATEST_PROPOSAL_HASH"],
  ["attempt46-cleanup-observation.json", "STATE_LATEST_CLEANUP"],
  [expected.cleanup, "STATE_LATEST_CLEANUP_HASH"],
  ["attempt46-reconciliation-observation.json", "STATE_LATEST_RECON"],
  [expected.reconciliation, "STATE_LATEST_RECON_HASH"],
  [/authority_mode:\s*none_attempt46_consumed_[^\n]*process_replacement[^\n]*/, "STATE_LATEST_AUTHORITY_MODE"],
  ["pending_numeric_cap_usd: null", "STATE_LATEST_CAP_NULL"],
  ["authority_path: null", "STATE_LATEST_AUTHORITY_NULL"],
  ["result: \"NOT_QUALIFIED_attempt46_process_replacement_worker_identity_unavailable_clean\"", "STATE_LATEST_RESULT"],
  ["accepted_complete_probe_outputs: 1", "STATE_LATEST_PROBE_OUTPUT"],
  ["accepted_total_durable_readbacks: 1", "STATE_LATEST_READBACK"],
  ["accepted_total_v3_receipts: 1", "STATE_LATEST_RECEIPT"],
  ["provider_disposable_resources_absent: true", "STATE_LATEST_RESOURCES"],
  ["retained_volume_count: 2", "STATE_LATEST_VOLUMES"],
  ["settled_incremental_spend_usd: 0", "STATE_LATEST_SPEND"],
  ["cleanup_uncertain: false", "STATE_LATEST_CLEANUP_CERTAINTY"],
]) {
  if (needle instanceof RegExp) {
    assert(needle.test(latestLive), code);
  } else {
    has(latestLive, needle, code);
  }
}

const gateStart = gates.indexOf("  GATE_SERVERLESS_MAGE_001:");
const gateEnd = gates.indexOf("\n  GATE_SERVERLESS_SOULX_001:", gateStart);
const gate = gates.slice(gateStart, gateEnd > gateStart ? gateEnd : undefined);
assert(gateStart >= 0, "GATE_SERVERLESS_MAGE_BLOCK");
for (const [needle, code] of [
  ["last_run: \"evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-46.json\"", "GATE_CLOSURE"],
  [`last_run_sha256: "${expected.closure}"`, "GATE_CLOSURE_HASH"],
  [/latest_approved_authority_state:\s*(?:CONSUMED_CLOSED_DO_NOT_REUSE|APPROVED_SINGLE_USE_PENDING_EXECUTION)/, "GATE_AUTHORITY_STATE"],
  [
    /pending_proposal:\s*(?:null|"evidence\/acceptance\/VF-10-07\/2026-08-23-attempt47-terminal-pod-identity-repair-candidate\/combined-live-proposal\.json")/,
    "GATE_PENDING_PROPOSAL_SAFE_SUCCESSOR",
  ],
  [/pending_authority:\s*(?:null|"evidence\/acceptance\/VF-10-07\/2026-08-23-attempt47-terminal-pod-identity-repair-candidate\/approved-authority\.json")/, "GATE_PENDING_AUTHORITY"],
  [/pending_numeric_cap_usd:\s*(?:null|4)/, "GATE_PENDING_CAP"],
  [/provider_calls_authorized:\s*(?:false|true)/, "GATE_PROVIDER_BOUNDARY"],
  [/provider_mutations_authorized:\s*(?:false|true)/, "GATE_MUTATION_BOUNDARY"],
  [/gpu_use_authorized:\s*(?:false|true)/, "GATE_GPU_BOUNDARY"],
  [
    /authority_mode:\s*(?:closed_consumed_attempt46_[^\n]*process_replacement[^\n]*|provider_free_attempt47_pending_fresh_exact_approval|approved_single_use_attempt47_pending_execution)/,
    "GATE_CLOSED_OR_SAFE_SUCCESSOR_MODE",
  ],
  ["V2-08 forbidden", "GATE_V208_FENCE"],
]) {
  if (needle instanceof RegExp) {
    assert(needle.test(gate), code);
  } else {
    has(gate, needle, code);
  }
}

console.log(
  "V2-07 Attempt46 closure validation PASS (one probe output/readback/v3 receipt; process-replacement identity failure; exact rollback, cleanup, three-read reconciliation, and consumed authority)",
);
