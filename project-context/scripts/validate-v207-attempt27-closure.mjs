import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07");
const candidate = resolve(evidenceRoot, "2026-08-21-attempt27-hosted-png-crc32-repair-candidate");
const live = resolve(evidenceRoot, "2026-08-21-live-qualification");
const paths = {
  closure: resolve(live, "failed-attempt-27.json"),
  cleanup: resolve(live, "attempt27-cleanup-observation.json"),
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};

const EXPECTED = {
  closure: "sha256:ffd622c4ee0a6a37311a51f191ce9c3ccbb0ae91620e51f64a03dfef932fb20d",
  cleanup: "sha256:9aa51ccb29b6a9568534c6f79eaa07b46fbcdf1fd9137f9b21cb87404ac3686d",
  proposal: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae",
  authority: "sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10",
  max1: "sha256:07749793fe28e158bad4314dbec128c30c6dcb3df52e7912837ec6dd10e27372",
  max2: "sha256:1673a27538aef7796a364e125e812c26dc22c2c9a2b7c7671f615fa5af603a25",
  control: "b8666dd8b8bc12578ffae8925f6ce73dbf53a841",
  repair: "1960ea9307bb7fcb591c842b84fc1c622aec49eb",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageManifest: "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  imageConfig: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageBase: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  endpoint: "sha256:9734a5312a5bc5250fd1e85a4630e53f1e36a6bfe52a1404d68e7a0bad9a2e15",
  template: "sha256:edffb9b9c9b97d9d92fc410bdf59584cab586f8ecf998c2db6a6272fe1e4a580",
  providerInitialConfig: "sha256:21bfaf9c52619b001eb80c07a6a47e0102c60fde1ea9efa9d85d80f97f3f410d",
  endpointSpend: 0.29846311127766967,
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (label) => {
  throw new Error(`V207_ATTEMPT27_CLOSURE_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const parse = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label}_json`);
  }
};
const hasSha256 = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
const section = (text, start, end) => {
  const from = text.indexOf(start);
  assert(from >= 0, `missing_section_${start}`);
  const rest = text.slice(from);
  if (!end) return rest;
  const to = rest.indexOf(end);
  return to < 0 ? rest : rest.slice(0, to);
};
const includesAll = (text, values, label) => {
  for (const value of values) assert(text.includes(value), `${label}_${value}`);
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([label, path]) => [label, await readFile(path)]),
);
const bytes = Object.fromEntries(entries);
for (const [label, expected] of Object.entries({
  closure: EXPECTED.closure,
  cleanup: EXPECTED.cleanup,
  proposal: EXPECTED.proposal,
  authority: EXPECTED.authority,
  max1: EXPECTED.max1,
  max2: EXPECTED.max2,
})) {
  assert(hash(bytes[label]) === expected, `${label}_hash`);
}

const closure = parse(bytes.closure, "closure");
const cleanup = parse(bytes.cleanup, "cleanup");
const proposal = parse(bytes.proposal, "proposal");
const authority = parse(bytes.authority, "authority");
const max1 = parse(bytes.max1, "max1");
const max2 = parse(bytes.max2, "max2");
const state = bytes.state.toString("utf8");
const gates = bytes.gates.toString("utf8");
const task = bytes.task.toString("utf8");
const start = bytes.start.toString("utf8");
const activation = bytes.activation.toString("utf8");

assert(closure.schema_version === "videoforge.v2-07-failed-attempt-closure/v1", "closure_schema");
assert(closure.checkpoint === "V2-07" && closure.task_id === "VF-10-07" && closure.attempt === 27, "closure_scope");
assert(closure.result === "NOT_QUALIFIED", "closure_result");
assert(closure.proposal_sha256 === EXPECTED.proposal && closure.authority_sha256 === EXPECTED.authority, "closure_authority_binding");
assert(closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE", "authority_consumed");
assert(closure.control_source_commit === EXPECTED.control && closure.hosted_png_crc32_repair_commit === EXPECTED.repair, "closure_control_lineage");

const lineage = closure.lineage;
assert(
  lineage?.image === EXPECTED.image &&
    lineage?.image_source_commit === EXPECTED.imageSource &&
    lineage?.image_config_sha256 === EXPECTED.imageConfig &&
    lineage?.image_layer_sha256 === EXPECTED.imageLayer &&
    lineage?.image_base_sha256 === EXPECTED.imageBase &&
    lineage?.image_parent_config_sha256 === EXPECTED.parentConfig &&
    lineage?.image.endsWith(`@${EXPECTED.imageManifest}`) &&
    lineage?.model === EXPECTED.model &&
    lineage?.model_manifest_sha256 === EXPECTED.manifest &&
    lineage?.mage_volume_id_sha256 === EXPECTED.volume &&
    lineage?.region === "EU-RO-1" &&
    lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    lineage?.flashboot === true &&
    lineage?.workers_min === 0 &&
    lineage?.workers_max === 1 &&
    lineage?.staged_max_one_sha256 === EXPECTED.max1 &&
    lineage?.staged_max_two_sha256 === EXPECTED.max2 &&
    lineage?.provider_applied_initial_config_sha256 === EXPECTED.providerInitialConfig,
  "closure_lineage",
);

const liveResult = closure.live_result;
assert(
  liveResult?.source_path === "/tmp/videoforge-v207-live-result.json" &&
    liveResult?.source_sha256 === "sha256:ee7420b04151f1fc4e4a935d09232ea986366be3689ac8272d9e2ebcb0d72f0c" &&
    liveResult?.stop_reason === "RUNPOD_WARM_IDLE_NOT_CONFIRMED" &&
    liveResult?.stopped_phase === "probe-terminal" &&
    liveResult?.provider_status === "COMPLETED" &&
    liveResult?.queue_delay_ms === 32954 &&
    liveResult?.execution_time_ms === 115855 &&
    liveResult?.accepted_batches === 1 &&
    liveResult?.accepted_outputs === 32 &&
    liveResult?.accepted_receipts === 32 &&
    liveResult?.generated_output_rollback === "NOT_REQUIRED_ACCEPTED_DURABLE_OUTPUTS_RETAINED_PRIVATE" &&
    liveResult?.unplanned_duplicate_compute === false &&
    liveResult?.intermediate_cleanup_error === "RUNPOD_CLEANUP_DELETE_UNCERTAIN",
  "live_failure_boundary",
);

const probe = closure.accepted_probe;
assert(
  probe?.kind === "owned_probe" &&
    probe?.provider_job_id_hash &&
    hasSha256(probe.provider_job_id_hash) &&
    probe?.status === "COMPLETED" &&
    probe?.execution_time_ms === liveResult.execution_time_ms &&
    probe?.delay_time_ms === liveResult.queue_delay_ms &&
    probe?.item_count === 32 &&
    probe?.peak_vram_used_bytes === 14177206272 &&
    Array.isArray(probe?.readbacks) &&
    probe.readbacks.length === 32 &&
    Array.isArray(probe?.commit_receipts) &&
    probe.commit_receipts.length === 32 &&
    hasSha256(probe.receipt_sha256),
  "probe_counts_peak",
);
for (const [index, readback] of probe.readbacks.entries()) {
  assert(Number.isInteger(readback?.bytes) && readback.bytes > 0 && hasSha256(readback?.sha256), `readback_${index}`);
}
for (const [index, receipt] of probe.commit_receipts.entries()) {
  assert(hasSha256(receipt?.receipt_sha256) && receipt?.reservation_id === "[REDACTED]" && receipt?.replay_confirmed === true, `receipt_${index}`);
}
assert(
  JSON.stringify(probe.timings) ===
    JSON.stringify({
      allocation_ms: 0,
      container_ready_ms: 0,
      first_inference_ms: 763,
      model_load_ms: 5858,
      total_ms: 84900,
      upload_ms: 18572,
      volume_verified_ms: 18911,
      warmup_ms: 4843,
    }),
  "probe_timings",
);

assert(cleanup.schema_version === "videoforge.v2-07-failed-cleanup-observation/v1", "cleanup_schema");
assert(cleanup.checkpoint === "V2-07" && cleanup.task_id === "VF-10-07" && cleanup.attempt === 27, "cleanup_scope");
const cleanupResult = cleanup.result;
const exactCleanup = closure.exact_failed_cleanup;
assert(
  cleanupResult?.schema_version === "videoforge.v2-07-failed-cleanup/v1" &&
    cleanupResult?.endpoint_id_sha256 === EXPECTED.endpoint &&
    cleanupResult?.template_id_sha256 === EXPECTED.template &&
    cleanupResult?.retained_mage_volume_id_sha256 === EXPECTED.volume &&
    cleanupResult?.stable_terminal_snapshot_count === 2 &&
    cleanupResult?.endpoint_worker_record_count === 3 &&
    cleanupResult?.terminal_pod_record_count === 3 &&
    cleanupResult?.endpoint_deleted === true &&
    cleanupResult?.template_deleted === true &&
    cleanupResult?.final_disposable_resources_absent === true,
  "cleanup_result",
);
assert(
  exactCleanup?.schema_version === cleanupResult.schema_version &&
    exactCleanup?.observation_path === "attempt27-cleanup-observation.json" &&
    exactCleanup?.observation_sha256 === EXPECTED.cleanup &&
    exactCleanup?.raw_stdout_retained === false &&
    JSON.stringify({
      endpoint_id_sha256: exactCleanup.endpoint_id_sha256,
      template_id_sha256: exactCleanup.template_id_sha256,
      retained_mage_volume_id_sha256: exactCleanup.retained_mage_volume_id_sha256,
      stable_terminal_snapshot_count: exactCleanup.stable_terminal_snapshot_count,
      endpoint_worker_record_count: exactCleanup.endpoint_worker_record_count,
      terminal_pod_record_count: exactCleanup.terminal_pod_record_count,
      endpoint_deleted: exactCleanup.endpoint_deleted,
      template_deleted: exactCleanup.template_deleted,
      final_disposable_resources_absent: exactCleanup.final_disposable_resources_absent,
    }) ===
      JSON.stringify({
        endpoint_id_sha256: cleanupResult.endpoint_id_sha256,
        template_id_sha256: cleanupResult.template_id_sha256,
        retained_mage_volume_id_sha256: cleanupResult.retained_mage_volume_id_sha256,
        stable_terminal_snapshot_count: cleanupResult.stable_terminal_snapshot_count,
        endpoint_worker_record_count: cleanupResult.endpoint_worker_record_count,
        terminal_pod_record_count: cleanupResult.terminal_pod_record_count,
        endpoint_deleted: cleanupResult.endpoint_deleted,
        template_deleted: cleanupResult.template_deleted,
        final_disposable_resources_absent: cleanupResult.final_disposable_resources_absent,
      }),
  "cleanup_evidence_binding",
);

const recon = closure.final_reconciliation;
assert(
  recon?.schema_version === "videoforge.v2-07-readonly-reconciliation/v2" &&
    recon?.checked_at === "2026-08-21T16:43:43.688Z" &&
    recon?.stable_read_count === 3 &&
    recon?.pods === 0 &&
    recon?.endpoints === 0 &&
    recon?.private_templates === 0 &&
    recon?.active_serverless_workers === 0 &&
    recon?.running_pods === 0 &&
    recon?.baseline_endpoint_spend_usd === EXPECTED.endpointSpend &&
    recon?.final_endpoint_spend_usd === EXPECTED.endpointSpend &&
    recon?.incremental_spend_usd === 0 &&
    recon?.maximum_cumulative_finite_spend_usd === 4 &&
    recon?.within_approved_cap === true &&
    recon?.settlement === "THREE_STABLE_READS" &&
    Array.isArray(recon?.retained_volumes) &&
    recon.retained_volumes.length === 2,
  "reconciliation_settled",
);
const mageVolume = recon.retained_volumes.find((volume) => volume?.purpose === "Mage");
const soulxVolume = recon.retained_volumes.find((volume) => volume?.purpose === "SoulX");
assert(
  mageVolume?.id_sha256 === EXPECTED.volume && mageVolume?.size_gb === 50 && mageVolume?.region === "EU-RO-1" &&
    soulxVolume?.id_sha256 === EXPECTED.soulxVolume && soulxVolume?.size_gb === 50 && soulxVolume?.region === "EU-RO-1",
  "retained_volumes",
);
assert(closure.retained_storage_charge_usd_per_month === 7, "retained_charge");
assert(closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && closure.qualification_boundaries?.v2_08 === "FORBIDDEN", "qualification_boundaries");

assert(
  closure.orchestrator?.source_path === "/tmp/videoforge-v207-attempt27-orchestrator.json" &&
    hasSha256(closure.orchestrator?.source_sha256) &&
    closure.orchestrator?.result === "FAILED" &&
    closure.orchestrator?.signer_secret_deleted === true &&
    closure.orchestrator?.captured_worker_version_restored === true &&
    closure.orchestrator?.route_restoration?.status === 404 &&
    closure.orchestrator?.route_restoration?.code === "V207_ROUTE_DISABLED" &&
    closure.orchestrator?.route_restoration?.stable_fingerprint_window_confirmed === true,
  "orchestrator_rollback",
);

const proposalLineage = proposal.lineage;
assert(
  proposalLineage?.model === EXPECTED.model &&
    proposalLineage?.model_manifest_sha256 === EXPECTED.manifest &&
    proposalLineage?.volume_id_sha256 === EXPECTED.volume &&
    proposalLineage?.volume_size_gb === 50 &&
    proposalLineage?.volume_region === "EU-RO-1" &&
    proposalLineage?.volume_mount === "/runpod-volume" &&
    proposalLineage?.model_root === "/runpod-volume/mage-model" &&
    proposalLineage?.image_source_commit === EXPECTED.imageSource &&
    proposalLineage?.control_source_commit === EXPECTED.control &&
    proposalLineage?.image_config_sha256 === EXPECTED.imageConfig &&
    proposalLineage?.image_layer_sha256 === EXPECTED.imageLayer &&
    proposalLineage?.image_base_sha256 === EXPECTED.imageBase &&
    proposalLineage?.image_parent_config_sha256 === EXPECTED.parentConfig &&
    proposalLineage?.image_manifest_sha256 === EXPECTED.imageManifest &&
    proposalLineage?.final_image === EXPECTED.image,
  "proposal_lineage",
);
assert(proposal.attempt === 27 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "proposal_scope");
assert(proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null && proposal.provider_mutation === false && proposal.gpu_use === false, "proposal_remains_null_cap");

const authorityLineage = authority.lineage;
assert(
  authorityLineage?.model === EXPECTED.model &&
    authorityLineage?.model_manifest_sha256 === EXPECTED.manifest &&
    authorityLineage?.volume_id_sha256 === EXPECTED.volume &&
    authorityLineage?.volume_size_gb === 50 &&
    authorityLineage?.volume_region === "EU-RO-1" &&
    authorityLineage?.volume_mount === "/runpod-volume" &&
    authorityLineage?.model_root === "/runpod-volume/mage-model" &&
    authorityLineage?.image_source_commit === EXPECTED.imageSource &&
    authorityLineage?.control_source_commit === EXPECTED.control &&
    authorityLineage?.image_config_sha256 === EXPECTED.imageConfig &&
    authorityLineage?.image_layer_sha256 === EXPECTED.imageLayer &&
    authorityLineage?.image_base_sha256 === EXPECTED.imageBase &&
    authorityLineage?.image_parent_config_sha256 === EXPECTED.parentConfig &&
    authorityLineage?.image_manifest_sha256 === EXPECTED.imageManifest &&
    authorityLineage?.final_image === EXPECTED.image &&
    authorityLineage?.initial_config_sha256 === EXPECTED.max1 &&
    authorityLineage?.concurrent_reader_config_sha256 === EXPECTED.max2,
  "authority_lineage",
);
assert(authority.proposal?.sha256 === EXPECTED.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_approval");
assert(authority.approval?.fresh_numeric_cap === true && authority.approval?.historical_cap_reused === false && authority.approval?.prior_authority_reused === false, "authority_fresh_cap");
assert(authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary?.gpu_use_authorized_pending_execution === true && authority.execution_boundary?.v2_08_authorized === false, "authority_scope");
assert(authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING", "authority_record_status");

for (const [label, config, expectedHash, expectedMax] of [["max1", max1, EXPECTED.max1, 1], ["max2", max2, EXPECTED.max2, 2]]) {
  assert(hash(bytes[label]) === expectedHash, `${label}_hash_recheck`);
  assert(
    config.image === EXPECTED.image &&
      config.image_source_commit === EXPECTED.imageSource &&
      config.control_source_commit === EXPECTED.control &&
      config.network_volume_id_sha256 === EXPECTED.volume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.workers_min === 0 &&
      config.workers_max === expectedMax &&
      config.flashboot === true,
    `${label}_identity`,
  );
}

const topState = state.split("\n").slice(0, 30).join("\n");
includesAll(topState, [
  "phase: serverless_v2_v2_07_attempt27_warm_idle_failure_closed",
  "task_stage: provider_free",
  "provider_calls_authorized: false",
  "remote_or_cloud_mutations_authorized: false",
  "credential_access_authorized: false",
  "gpu_use_authorized: false",
  "maximum_external_spend_usd: 0",
], "state_top");
includesAll(state, [EXPECTED.proposal, EXPECTED.authority, EXPECTED.closure, EXPECTED.cleanup], "state_evidence");
const providerAuthority = section(state, "provider_authority: &v2_07_provider_authority", "credential_value_read_authorized:");
includesAll(providerAuthority, ["mode: none", "cap_usd: 0", "consumed: true", "actual_spend_usd: 0", "resources: []", "authorized_operations: []", "allowed_operations: []"], "provider_authority_closed");
assert(providerAuthority.includes(EXPECTED.authority) && providerAuthority.includes(EXPECTED.proposal) && providerAuthority.includes(EXPECTED.closure), "provider_authority_lineage");
const runpodScope = section(state, "runpod_account_scope:", "repository:");
includesAll(runpodScope, ["current_authority: null", "current_authority_sha256: null", "mutation_authorized: false", "gpu_use_authorized: false", "spend_authorized_usd: 0"], "runpod_scope_closed");
const recommended = section(state, "recommended_next_task:", "verification:");
includesAll(recommended, ["NOT_QUALIFIED", "provider_calls_authorized: false", "maximum_external_spend_usd: 0", "remote_or_cloud_mutations_authorized: false", "gpu_use_authorized: false", EXPECTED.closure, "execution_status: attempt27_closed_warm_idle_failure"], "recommended_closed");
const latestLive = section(state, "latest_live_check:", "GATE_SERVERLESS_SOULX_001:");
includesAll(latestLive, [EXPECTED.closure, EXPECTED.cleanup, "authority_mode: none_attempt27_consumed", "pending_numeric_cap_usd: null", "result: \"NOT_QUALIFIED_attempt27_closed_warm_idle_failure\""], "latest_live_closed");

const mageGate = section(gates, "GATE_SERVERLESS_MAGE_001:", "GATE_SERVERLESS_SOULX_001:");
includesAll(mageGate, ["status: open", "latest_closed_proposal_sha256: \"" + EXPECTED.proposal + "\"", "latest_closed_authority_sha256: \"" + EXPECTED.authority + "\"", "closure_evidence_sha256: \"" + EXPECTED.closure + "\"", "cleanup_evidence_sha256: \"" + EXPECTED.cleanup + "\"", "authority_mode: none_attempt27_consumed", "pending_numeric_cap_usd: null", "result: \"NOT_QUALIFIED_attempt27_closed_warm_idle_failure\""], "gate_closed");
assert(!mageGate.includes("authority_mode: attempt27_bounded_mutation_authorized"), "gate_stale_authority");
assert(!mageGate.includes("pending_numeric_cap_usd: 4"), "gate_stale_cap");
includesAll(task, [EXPECTED.closure, "RUNPOD_WARM_IDLE_NOT_CONFIRMED", "it is consumed", "V2-07 remains `NOT_QUALIFIED`", "V2-08 remains forbidden"], "task_closure");
includesAll(start, [EXPECTED.closure, "RUNPOD_WARM_IDLE_NOT_CONFIRMED", "consumed and non-reusable", "V2-07 remains NOT_QUALIFIED", "V2-08"], "start_closure");
includesAll(activation, ["V207_APPROVED_FINITE_CAP_USD: number | null = null", "V207_PENDING_PROPOSAL_SHA256", "V207_HOSTED_PNG_CRC32_REPAIR_COMMIT"], "activation_closed");

process.stdout.write(`V2-07 Attempt27 closure validation PASS (${EXPECTED.closure}; cleanup ${EXPECTED.cleanup}; RUNPOD_WARM_IDLE_NOT_CONFIRMED; 32 durable readbacks/receipts; three stable zero-resource reads; authority consumed)\n`);
