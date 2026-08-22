import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt32-finalize-response-diagnostics-candidate",
);

const expected = Object.freeze({
  proposal:
    "sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a",
  max1:
    "sha256:2663f06af19ceb11470e0ddac86ac74dae00d25a7b128970376dca2a3d1343d2",
  max2:
    "sha256:969816bd9546a81d08f1b725480ad17839d6bd067451ed3074dac3a102cc9e7a",
  control: "a1da27192c567823f9508ecd6f146f8667e1daac",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  imageConfig:
    "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer:
    "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageManifest:
    "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageBase:
    "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  imageParentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  closure:
    "sha256:76c9dec453b5670c0dff73c1857cbbb5e9b43a460599c81a24455404f634c490",
  cleanup:
    "sha256:61185a893499ab0634458fe472af21cb47385923e2fd05af60658ec97d1f54bc",
  priorProposal:
    "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea",
  priorAuthority:
    "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
  finalizeTransport: "b8666dd8b8bc12578ffae8925f6ce73dbf53a841",
  crc32: "1960ea9307bb7fcb591c842b84fc1c622aec49eb",
  finalizeReplay: "bf26c3a86ec6a48f619c39613d425da816eeae4d",
  terminalReplay: "7ba8e9181fe210858c23a3ba7c5c9aca768ac24b",
  scaleZero: "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14",
  terminalSnapshot: "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT32_AUTHORITY_INVALID:${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${code}_JSON`);
  }
};
const read = async (path, code) => {
  try {
    return await readFile(path);
  } catch {
    fail(code);
  }
};
const readText = async (path, code) => (await read(path, code)).toString("utf8");
const hasAll = (text, values) => values.every((value) => text.includes(value));

const paths = Object.freeze({
  proposal: resolve(candidate, "combined-live-proposal.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-31.json"),
  cleanup: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt31-cleanup-observation.json"),
});

const contextPaths = Object.freeze({
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
});

const [proposalBytes, max1Bytes, max2Bytes, acceptanceBytes, authorityBytes, closureBytes, cleanupBytes] =
  await Promise.all([
    read(paths.proposal, "PROPOSAL_NOT_FOUND"),
    read(paths.max1, "MAX1_NOT_FOUND"),
    read(paths.max2, "MAX2_NOT_FOUND"),
    read(paths.acceptance, "ACCEPTANCE_NOT_FOUND"),
    read(paths.authority, "AUTHORITY_NOT_FOUND"),
    read(paths.closure, "CLOSURE_NOT_FOUND"),
    read(paths.cleanup, "CLEANUP_NOT_FOUND"),
  ]);
const [state, gates, task, start, activation, activationTest] = await Promise.all(
  Object.values(contextPaths).map((path) => readText(path, "CONTEXT_NOT_FOUND")),
);

assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
assert(sha256(closureBytes) === expected.closure, "CLOSURE_HASH");
assert(sha256(cleanupBytes) === expected.cleanup, "CLEANUP_HASH");
const authorityHash = sha256(authorityBytes);
const acceptanceHash = sha256(acceptanceBytes);

const proposal = parse(proposalBytes, "PROPOSAL");
const max1 = parse(max1Bytes, "MAX1");
const max2 = parse(max2Bytes, "MAX2");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const authority = parse(authorityBytes, "AUTHORITY");
const closure = parse(closureBytes, "CLOSURE");
const cleanup = parse(cleanupBytes, "CLEANUP");

assert(
  authority.schema_version === "videoforge.v2-07-attempt32-finalize-response-diagnostics-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === 32 &&
    authority.authority_mode === "bounded_mutation" &&
    authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING" &&
    /explicit_user_approval.*attempt32/iu.test(String(authority.authority_source)),
  "AUTHORITY_SCOPE",
);

const cap = authority.approval?.maximum_cumulative_finite_spend_usd;
assert(
  authority.proposal?.path === "combined-live-proposal.json" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.acceptance?.path === "acceptance.json" &&
    authority.acceptance?.sha256 === acceptanceHash &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    ["LOW", "MEDIUM", "HIGH"].includes(authority.approval?.observed_availability_at_proposal) &&
    Number.isFinite(cap) &&
    cap >= proposal.rates_cost_and_retention.estimated_finite_serverless_compute_usd_ceiling &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.recurring_retained_volume_charge_usd_per_month === 7 &&
    authority.approval?.recurring_charge_is_outside_finite_cap === true,
  "AUTHORITY_APPROVAL",
);

const expectedRuntime = (contract, code) => {
  assert(
    contract?.sealed_manifest_verification === "OFFLINE_EXACT_SHA256_BEFORE_MODEL_LOAD_AND_AFTER_FINAL_DRAIN" &&
      contract?.real_initialization_warmup_required === true &&
      contract?.model_files === "APPLICATION_READ_ONLY_UNDER_/runpod-volume/mage-model" &&
      contract?.job_local_scratch === "/tmp/videoforge-v2-07/${job_id}" &&
      contract?.scratch_must_not_escape_job === true &&
      contract?.scoped_r2_output_ports?.startsWith("EXACT_PER_JOB_PER_UNIT") &&
      contract?.durable_per_unit_resume?.includes("NEVER_REGENERATE_ACCEPTED_UNITS") &&
      contract?.runtime_download_or_quantization === false &&
      contract?.cache_escape_forbidden === true,
    code,
  );
};

const expectedLineage = (lineage, code) => {
  assert(
    lineage?.model === expected.model &&
      lineage?.model_manifest_sha256 === expected.manifest &&
      lineage?.volume_id_sha256 === expected.volume &&
      lineage?.volume_size_gb === 50 &&
      lineage?.volume_region === "EU-RO-1" &&
      lineage?.volume_mount === "/runpod-volume" &&
      lineage?.model_root === "/runpod-volume/mage-model" &&
      lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
      lineage?.image_source_commit === expected.imageSource &&
      lineage?.control_source_commit === expected.control &&
      lineage?.finalize_transport_repair_commit === expected.finalizeTransport &&
      lineage?.image_config_sha256 === expected.imageConfig &&
      lineage?.image_layer_sha256 === expected.imageLayer &&
      lineage?.image_manifest_sha256 === expected.imageManifest &&
      lineage?.image_base_sha256 === expected.imageBase &&
      lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
      lineage?.final_image === expected.image &&
      lineage?.prior_closure_evidence_sha256 === expected.closure &&
      lineage?.prior_cleanup_evidence_sha256 === expected.cleanup &&
      lineage?.prior_proposal_sha256 === expected.priorProposal &&
      lineage?.prior_authority_sha256 === expected.priorAuthority &&
      lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT31_CONSUMED_DO_NOT_REUSE" &&
      lineage?.prior_attempt === 31 &&
      lineage?.hosted_png_crc32_repair_commit === expected.crc32 &&
      lineage?.post_job_terminal_scale_zero_repair_commit === expected.scaleZero &&
      lineage?.terminal_replay_queue_fence_commit === expected.terminalReplay &&
      lineage?.finalize_replay_fast_path_commit === expected.finalizeReplay &&
      lineage?.terminal_snapshot_stabilization_commit === expected.terminalSnapshot &&
      lineage?.finalize_response_diagnostics_commit === expected.control,
    code,
  );
  expectedRuntime(lineage.runtime_execution_contract, `${code}_RUNTIME`);
};

expectedLineage(proposal.lineage, "PROPOSAL_LINEAGE");
assert(
  authority.lineage?.control_source_commit === expected.control &&
    authority.lineage?.image === expected.image &&
    authority.lineage?.image_source_commit === expected.imageSource &&
    authority.lineage?.image_config_sha256 === expected.imageConfig &&
    authority.lineage?.image_layer_sha256 === expected.imageLayer &&
    authority.lineage?.image_parent_sha256 === expected.imageBase &&
    authority.lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    authority.lineage?.model === expected.model &&
    authority.lineage?.model_manifest_sha256 === expected.manifest &&
    authority.lineage?.volume_id_sha256 === expected.volume &&
    authority.lineage?.volume_size_gb === 50 &&
    authority.lineage?.volume_region === "EU-RO-1" &&
    authority.lineage?.volume_mount === "/runpod-volume" &&
    authority.lineage?.model_root === "/runpod-volume/mage-model" &&
    authority.lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    authority.lineage?.initial_config_path === "staged-config-max1.json" &&
    authority.lineage?.initial_config_sha256 === expected.max1 &&
    authority.lineage?.concurrent_reader_config_path === "staged-config-max2.json" &&
    authority.lineage?.concurrent_reader_config_sha256 === expected.max2 &&
    authority.lineage?.prior_attempt === 31 &&
    authority.lineage?.prior_proposal_sha256 === expected.priorProposal &&
    authority.lineage?.prior_authority_sha256 === expected.priorAuthority &&
    authority.lineage?.prior_closure_sha256 === expected.closure &&
    authority.lineage?.prior_cleanup_sha256 === expected.cleanup,
  "AUTHORITY_LINEAGE",
);
assert(
  authority.runtime_contract?.offline_sealed_manifest_verification === true &&
    authority.runtime_contract?.real_initialization_warmup === true &&
    authority.runtime_contract?.application_read_only_model_files === true &&
    authority.runtime_contract?.job_local_scratch === "/tmp/videoforge-v2-07/${job_id}" &&
    authority.runtime_contract?.scoped_r2_output_ports === true &&
    authority.runtime_contract?.durable_per_unit_resume === true &&
    authority.runtime_contract?.runtime_download_or_quantization === false &&
    authority.runtime_contract?.cache_escape_forbidden === true &&
    authority.runtime_contract?.finalize_retry_attempts === 3 &&
    authority.runtime_contract?.finalize_timeout_seconds === 30 &&
    authority.runtime_contract?.finalize_only_retry === true &&
    authority.runtime_contract?.provider_response_body_url_ids_or_secrets_retained === false,
  "AUTHORITY_RUNTIME",
);

assert(
  proposal.attempt === 32 &&
    proposal.status === "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.provider_mutation === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0 &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null,
  "PROPOSAL_UNAPPROVED_BYTES",
);

const configContractCheck = (config, index) => {
  assert(
    config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v8" &&
      config.control_source_commit === expected.control &&
      config.image === expected.image &&
      config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.volume_write_policy === "APPLICATION_READ_ONLY" &&
      config.gpu_type_ids?.length === 1 &&
      config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.workers_min === 0 &&
      config.workers_max === index + 1 &&
      config.flashboot === true &&
      config.output_finalization_transport_policy?.max_attempts === 3 &&
      config.output_finalization_transport_policy?.request_timeout_seconds === 30 &&
      config.output_finalization_transport_policy?.retryable_operation_only === "FINALIZE" &&
      config.output_finalization_transport_policy?.put_is_never_retried === true &&
      config.output_finalization_transport_policy?.non_finalize_posts_are_never_retried === true &&
      config.output_finalization_transport_policy?.provider_body_retained === false &&
      config.output_finalization_transport_policy?.signed_urls_or_secrets_retained === false,
    `CONFIG${index + 1}_IDENTITY`,
  );
  expectedRuntime(config.runtime_execution_contract, `CONFIG${index + 1}_RUNTIME`);
  const successRequires = (config.success_requires ?? []).map((item) => item.toLowerCase());
  const requiredSuccessGates =
    index === 0
      ? [
          "complete_cold_and_warm_image_batch",
          "durable_outputs_before_provider_expiry",
          "v3_authority_receipts",
          "unchanged_sealed_volume_hash",
          "zero_model_volume_writes",
          "peak_vram_bytes_and_init_load_warmup_inference_upload_total_ttl_timing_receipts",
          "two_simultaneous_read_only_workers",
          "workers_zero_after_drain",
        ]
      : [
          "two simultaneous read-only complete batches",
          "unchanged sealed volume hash",
          "zero model-volume writes",
          "peak vram bytes and init/load/warmup/inference/upload/total/ttl timing receipts",
          "workers zero after drain",
        ];
  assert(
    Array.isArray(config.success_requires) &&
      requiredSuccessGates.every((required) => successRequires.some((item) => item.includes(required))),
    `CONFIG${index + 1}_SUCCESS_GATES`,
  );
};
configContractCheck(max1, 0);
configContractCheck(max2, 1);
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1, "PROPOSAL_MAX1");
assert(proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "PROPOSAL_MAX2");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "PROPOSAL_RATE");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "PROPOSAL_RETENTION_RATE");
assert(proposal.cleanup_rollback_and_stop_conditions?.success?.some((item) => item.includes("settled spend")), "PROPOSAL_SETTLED_COST");

const authorityConfigs = authority.staged_endpoint_configs;
assert(Array.isArray(authorityConfigs) && authorityConfigs.length === 2, "AUTHORITY_CONFIG_COUNT");
for (const [index, config] of authorityConfigs.entries()) {
  assert(
    config.definition_sha256 === (index === 0 ? expected.max1 : expected.max2) &&
      config.workers_min === 0 &&
      config.workers_max === index + 1 &&
      config.gpu === "NVIDIA GeForce RTX 4090" &&
      (index === 0 ? config.gpu_count === 1 : config.gpu_count_per_worker === 1) &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.flashboot === true &&
      config.region === "EU-RO-1",
    `AUTHORITY_CONFIG${index + 1}`,
  );
}

assert(
  authority.execution_boundary?.image_republication_authorized === false &&
    authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary?.provider_calls_completed === false &&
    authority.execution_boundary?.external_spend_usd === 0 &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === cap &&
    authority.execution_boundary?.retained_volume_mutation_authorized === false &&
    authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY_BOUNDARY",
);

assert(
  typeof authority.rate_snapshot?.checked_at === "string" &&
    authority.rate_snapshot?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    authority.rate_snapshot?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 &&
    authority.rate_snapshot?.network_volume_usd_per_gb_month === 0.07 &&
    authority.rate_snapshot?.existing_two_volume_charge_usd_per_month_total === 7 &&
    authority.rate_snapshot?.estimated_cumulative_gpu_hours_ceiling === 2 &&
    authority.rate_snapshot?.availability === "HIGH" &&
    authority.rate_snapshot?.minimum_approved_availability === "LOW" &&
    authority.rate_snapshot?.region === "EU-RO-1" &&
    authority.rate_snapshot?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    authority.rate_snapshot?.maximum_cumulative_finite_spend_usd === cap,
  "AUTHORITY_RATES",
);
assert(
  Array.isArray(authority.stop_conditions) &&
    [
      "identity_config_image_model_volume_gpu_or_region_mismatch",
      "availability_below_LOW",
      "wrong_bytes_path_write_or_cache_escape",
      "malformed_authority_or_duplicate_compute",
      "failed_output_or_missing_durable_receipt",
      "uncertain_cleanup_rollback_or_route_restoration",
      "cap_risk",
      "V2-08_or_successor_work",
    ].every((condition) => authority.stop_conditions.includes(condition)),
  "AUTHORITY_STOP_CONDITIONS",
);

const operationSpec = authority.authorized_operations;
assert(
  operationSpec?.source === "combined-live-proposal.json#proposed_operations_in_order" &&
    operationSpec?.count === proposal.proposed_operations_in_order.length &&
    operationSpec?.canonical_json_sha256 === sha256(Buffer.from(JSON.stringify(proposal.proposed_operations_in_order))),
  "AUTHORITY_OPERATIONS_EXACT",
);
assert(
  operationSpec?.publication === "deploy_current_control_source_only; image_republication_forbidden" &&
    operationSpec?.create_or_update ===
      "ephemeral signer secret, current Worker, exact private template, exact max-one endpoint, bounded max-two policy" &&
    operationSpec?.submit_status_cancel === "owned sample/cold/warm/readers plus duplicate/cancel/timeout proofs only" &&
    operationSpec?.scale_down === "restore max-one and independently prove workers zero" &&
    operationSpec?.retain_on_success === "endpoint, private template, Mage volume, SoulX volume" &&
    operationSpec?.delete_if_failed === "cancel only owned jobs and delete only disposable endpoint/private template" &&
    operationSpec?.final_reconciliation === "three stable reads plus settled cost and signer/Worker/route rollback",
  "AUTHORITY_OPERATIONS_SCOPE",
);
assert(
  closure.schema_version === "videoforge.v2-07-live-failure/v1" &&
    closure.attempt === 31 &&
    closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    closure.authority_sha256 === expected.priorAuthority &&
    closure.proposal_sha256 === expected.priorProposal &&
    cleanup.schema_version === "videoforge.v2-07-attempt31-cleanup-observation/v1" &&
    cleanup.attempt === 31 &&
    cleanup.billing?.within_approved_cap === true &&
    cleanup.billing?.settlement === "THREE_STABLE_READS",
  "PRIOR_CLOSED_EVIDENCE",
);

assert(
  acceptance.schema_version === "videoforge.v2-07-finalize-response-diagnostics-candidate-handoff/v1" &&
    acceptance.checkpoint === "V2-07" &&
    acceptance.task_id === "VF-10-07" &&
    acceptance.attempt === 32 &&
    acceptance.result === "PROVIDER_FREE_CANDIDATE_AWAITING_FRESH_APPROVAL_AND_CAP" &&
    acceptance.qualification_status === "NOT_QUALIFIED" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.authority_path === null &&
    acceptance.candidate?.authority_sha256 === null &&
    acceptance.candidate?.authority_recorded === false &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.candidate?.fresh_numeric_cap_required === true &&
    acceptance.candidate?.provider_calls_authorized === false &&
    acceptance.candidate?.provider_mutations_authorized === false &&
    acceptance.candidate?.gpu_use_authorized === false &&
    acceptance.candidate?.image_republication_authorized === false &&
    acceptance.candidate?.model_download_or_volume_mutation_authorized === false &&
    acceptance.candidate?.v2_08_authorized === false &&
    acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.provider_mutations === false &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.external_spend_usd === 0,
  "ACCEPTANCE_BINDING",
);
assert(
  acceptance.local_verification?.context_validation === "PASS" &&
    acceptance.local_verification?.secret_scan?.startsWith("PASS") &&
    acceptance.local_verification?.format_check === "PASS" &&
    acceptance.local_verification?.git_diff_check === "PASS",
  "ACCEPTANCE_VERIFICATION",
);

const authorityPath =
  "evidence/acceptance/VF-10-07/2026-08-22-attempt32-finalize-response-diagnostics-candidate/approved-authority.json";
const currentAttempt32 = state.slice(
  state.indexOf("pending_v2_07_attempt32_proposal:"),
  state.indexOf("\npending_v2_07_attempt24_proposal:") > 0
    ? state.indexOf("\npending_v2_07_attempt24_proposal:")
    : state.length,
);
assert(currentAttempt32.includes(authorityPath), "STATE_AUTHORITY_PATH");
const stateAuthorized = hasAll(currentAttempt32, [
  `authority_sha256: "${authorityHash}"`,
  `candidate_acceptance_sha256: "${acceptanceHash}"`,
  `maximum_cumulative_finite_spend_usd: ${cap}`,
  "authority_recorded: true",
  "provider_calls_authorized: true",
  "provider_mutations_authorized: true",
  "gpu_use_authorized: true",
  "v2_08_authorized: false",
]);
const stateConsumed = hasAll(currentAttempt32, [
  `authority_sha256: "${authorityHash}"`,
  `candidate_acceptance_sha256: "${acceptanceHash}"`,
  "mode: closed_consumed_attempt32_concurrent_reader_drain_failure",
  "maximum_cumulative_finite_spend_usd: 0",
  "authority_recorded: false",
  "provider_calls_authorized: false",
  "provider_mutations_authorized: false",
  "gpu_use_authorized: false",
  "v2_08_authorized: false",
]);
assert(stateAuthorized || stateConsumed, "STATE_AUTHORITY_LIFECYCLE");
const gateStart = gates.indexOf("GATE_SERVERLESS_MAGE_001:");
assert(gateStart >= 0, "MAGE_GATE_MISSING");
const gate = gates.slice(gateStart);
const gateIdentityBound = hasAll(gate, [
    authorityPath,
    `pending_authority_sha256: "${authorityHash}"`,
    expected.proposal,
    expected.max1,
    expected.max2,
    acceptanceHash,
  ]);
const gateAuthorized =
  gateIdentityBound &&
    gate.includes(`pending_numeric_cap_usd: ${cap}`) &&
    /authority_mode:\s+[^\n]*attempt32[^\n]*(authorized|bounded_mutation)/iu.test(gate) &&
    /provider_calls_authorized:\s+true/u.test(gate) &&
    /gpu_use_authorized:\s+true/u.test(gate);
const gateConsumed =
  hasAll(gate, [
    authorityPath,
    authorityHash,
    expected.proposal,
    expected.max1,
    expected.max2,
    acceptanceHash,
  ]) &&
    gate.includes("pending_numeric_cap_usd: null") &&
    (gate.includes("authority_mode: attempt32_consumed_closed") ||
      gate.includes(
        "authority_mode: attempt33_provider_free_awaiting_fresh_exact_approval_and_positive_cap",
      ) ||
      gate.includes("authority_mode: attempt33_bounded_mutation_authorized")) &&
    /provider_calls_authorized:\s+false/u.test(gate) &&
    /gpu_use_authorized:\s+false/u.test(gate);
const gateSuccessorAuthorized =
  hasAll(gate, [authorityPath, authorityHash, expected.proposal, expected.max1, expected.max2]) &&
  gate.includes("authority_mode: attempt33_bounded_mutation_authorized") &&
  gate.includes("pending_numeric_cap_usd: 4") &&
  /provider_calls_authorized:\s+true/u.test(gate) &&
  /gpu_use_authorized:\s+true/u.test(gate);
const gateSuperseded =
  (gate.includes("authority_mode: no_live_authority_attempt34_provider_free_candidate") ||
    gate.includes("authority_mode: exact_attempt34_single_use_authority_active") ||
    gate.includes("authority_mode: no_live_authority_attempt35_provider_free_candidate") ||
    gate.includes("authority_mode: exact_attempt35_single_use_authority_active")) &&
  gate.includes("failed-attempt-33.json") &&
  gate.includes("attempt33-cleanup-observation.json") &&
  /provider_calls_authorized:\s+false/u.test(gate) &&
  /gpu_use_authorized:\s+false/u.test(gate);
const gateAttempt34Authorized =
  gate.includes("authority_mode: exact_attempt34_single_use_authority_active") &&
  gate.includes("pending_numeric_cap_usd: 4") &&
  gate.includes("sha256:3157147f85ecea86b6d01ce489dbfff2dc0d7bc51a833749d96a9cecd99314ff") &&
  /provider_calls_authorized:\s+true/u.test(gate) &&
  /gpu_use_authorized:\s+true/u.test(gate);
const gateAttempt35Authorized =
  gate.includes("authority_mode: exact_attempt35_single_use_authority_active") &&
  gate.includes("pending_numeric_cap_usd: 4") &&
  gate.includes("sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37") &&
  /provider_calls_authorized:\s+true/u.test(gate) &&
  /gpu_use_authorized:\s+true/u.test(gate);
assert(
  gateAuthorized ||
    gateConsumed ||
    gateSuccessorAuthorized ||
    gateSuperseded ||
    gateAttempt34Authorized ||
    gateAttempt35Authorized,
  "GATE_AUTHORITY_LIFECYCLE",
);
for (const [label, text] of Object.entries({ task, start })) {
  assert(hasAll(text, [expected.proposal, expected.max1, expected.max2, acceptanceHash, authorityHash]), `${label.toUpperCase()}_POINTERS`);
}
assert(
  hasAll(activation, [expected.proposal, authorityHash]) &&
    (activation.includes(expected.control) ||
      activation.includes("bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37") ||
      activation.includes("96f5e16cf03be7e31049478ce7f6b0c134a8108c")) &&
    (new RegExp(`V207_APPROVED_FINITE_CAP_USD\\s*=\\s*${cap}\\b`).test(activation) ||
      activation.includes(`V207_APPROVED_FINITE_CAP_USD: number | null = ${cap}`) ||
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null")),
  "ACTIVATION_AUTHORITY_LIFECYCLE",
);
assert(hasAll(activationTest, [expected.proposal, authorityHash, String(cap)]), "ACTIVATION_TEST_BINDING");

const forbiddenLeakage = /https?:\/\/|Bearer\s+[A-Za-z0-9._-]{10,}|-----BEGIN|\bsk-[A-Za-z0-9]|\bAKIA[0-9A-Z]{16}\b/iu;
assert(!forbiddenLeakage.test(authorityBytes.toString("utf8")), "AUTHORITY_SECRET_OR_URL_LEAK");

process.stdout.write(
  `V2-07 Attempt32 authority validation PASS (authority ${authorityHash}; proposal ${expected.proposal}; acceptance ${acceptanceHash}; cap $${cap})\n`,
);
