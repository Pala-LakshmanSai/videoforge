import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const candidateRoot = path.join(
  repoRoot,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-template-identity-requalification-candidate",
);

const files = {
  proposal: path.join(candidateRoot, "combined-live-proposal.json"),
  max1: path.join(candidateRoot, "staged-config-max1.json"),
  max2: path.join(candidateRoot, "staged-config-max2.json"),
  candidateAuthority: path.join(candidateRoot, "approved-authority.json"),
  failedAttempt16: path.join(
    repoRoot,
    "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-16.json",
  ),
  priorAuthority: path.join(
    repoRoot,
    "project-context/evidence/acceptance/VF-10-07/2026-08-20-flashboot-true-requalification-candidate/approved-authority.json",
  ),
  activation: path.join(repoRoot, "apps/web/src/server/providers/v207-activation-authority.ts"),
  control: path.join(repoRoot, "apps/web/src/server/providers/runpod-control.ts"),
  orchestrator: path.join(repoRoot, "apps/web/src/server/providers/v207-live-orchestrator.ts"),
  currentState: path.join(repoRoot, "project-context/CURRENT_STATE.yaml"),
  gates: path.join(repoRoot, "project-context/GATES.yaml"),
  task: path.join(repoRoot, "project-context/tasks/VF-10-07.md"),
};

const expected = {
  proposal:
    "sha256:6bc0cef713615f5bdd47b85a5903249644f514f7666956941d5435288d6bd99c",
  max1: "sha256:d8c4da38c2f5d4516b7eb59cbfc69acdeb6834fcde9d934aa3141a4df89f3d44",
  max2: "sha256:70f36a5b5140b0c3e1063a775ab0cb5030d7024931a1f8fa57bbabb962a6208b",
  attempt16:
    "sha256:44d40abaf2b0f6142372e2e575ebf50a5268bde996c5945cbfc2442fa1546c2d",
  priorAuthority:
    "sha256:4deb86bd503eb51e452ce7b59a9a2214faa050ebe72daf63128bd97d9728e998",
  candidateAuthority:
    "sha256:7f36db5a22aa3c1b347d45e75199d3e758fdcdc5b4aff788e68e6e9875ee0462",
  currentProposal:
    "sha256:2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be",
  closedProposal:
    "sha256:2338ff8d596284408080c94970d0c2a5e8a8ae58f62b92d590e880e72079d605",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  controlSource: "8a5153ac6e5fb3ad32230e70ade9f854a2e922a5",
  imageConfig:
    "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer:
    "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageManifest:
    "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  candidatePath:
    "evidence/acceptance/VF-10-07/2026-08-20-template-identity-requalification-candidate/combined-live-proposal.json",
  attemptPath: "evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-16.json",
  closedAuthorityPath:
    "evidence/acceptance/VF-10-07/2026-08-20-flashboot-true-requalification-candidate/approved-authority.json",
  candidateAuthorityPath:
    "evidence/acceptance/VF-10-07/2026-08-20-template-identity-requalification-candidate/approved-authority.json",
};

const fail = (label) => {
  throw new Error(`V207_TEMPLATE_IDENTITY_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const sha256 = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const validDigest = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);

const readBytes = (file, label) => {
  try {
    return readFileSync(file);
  } catch {
    fail(`missing_${label}`);
  }
};
const readText = (file, label) => readBytes(file, label).toString("utf8");
const readJson = (file, label) => {
  try {
    return JSON.parse(readText(file, label));
  } catch {
    fail(`json_${label}`);
  }
};

const proposalBytes = readBytes(files.proposal, "proposal");
const max1Bytes = readBytes(files.max1, "max1");
const max2Bytes = readBytes(files.max2, "max2");
const attempt16Bytes = readBytes(files.failedAttempt16, "attempt16");
const priorAuthorityBytes = readBytes(files.priorAuthority, "prior_authority");
const candidateAuthorityBytes = readBytes(files.candidateAuthority, "candidate_authority");
const proposal = readJson(files.proposal, "proposal");
const max1 = readJson(files.max1, "max1");
const max2 = readJson(files.max2, "max2");
const attempt16 = readJson(files.failedAttempt16, "attempt16");
const priorAuthority = readJson(files.priorAuthority, "prior_authority");
const candidateAuthority = readJson(files.candidateAuthority, "candidate_authority");

assert(sha256(proposalBytes) === expected.proposal, "proposal_bytes");
assert(sha256(max1Bytes) === expected.max1, "max1_bytes");
assert(sha256(max2Bytes) === expected.max2, "max2_bytes");
assert(sha256(attempt16Bytes) === expected.attempt16, "attempt16_bytes");
assert(sha256(priorAuthorityBytes) === expected.priorAuthority, "prior_authority_bytes");
assert(sha256(candidateAuthorityBytes) === expected.candidateAuthority, "candidate_authority_bytes");

assert(proposal.schema_version === "videoforge.v2-07-template-identity-requalification-combined-live-proposal/v1", "proposal_schema");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "proposal_identity");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "proposal_pending");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "proposal_null_cap");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "proposal_fresh_cap");
assert(proposal.user_approval?.exact_proposal_approved === false, "proposal_not_approved");
assert(proposal.lineage?.final_image === expected.image, "proposal_image");
assert(proposal.lineage?.image_manifest_sha256 === expected.imageManifest, "proposal_manifest");
assert(proposal.lineage?.image_config_sha256 === expected.imageConfig, "proposal_config");
assert(proposal.lineage?.image_layer_sha256 === expected.imageLayer, "proposal_layer");
assert(proposal.lineage?.image_source_commit === expected.imageSource, "proposal_image_source");
assert(proposal.lineage?.control_source_commit === expected.controlSource, "proposal_control_source");
assert(proposal.lineage?.volume_id_sha256 === expected.volume, "proposal_volume");
assert(proposal.lineage?.volume_size_gb === 50, "proposal_volume_size");
assert(proposal.lineage?.volume_region === "EU-RO-1", "proposal_volume_region");
assert(proposal.lineage?.volume_mount === "/runpod-volume", "proposal_volume_mount");
assert(proposal.lineage?.model_root === "/runpod-volume/mage-model", "proposal_model_root");
assert(proposal.lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "proposal_volume_policy");
assert(proposal.lineage?.failed_attempt_evidence === "../2026-08-20-live-qualification/failed-attempt-16.json", "proposal_attempt_path");
assert(proposal.lineage?.failed_attempt_evidence_sha256 === expected.attempt16, "proposal_attempt_hash");
assert(proposal.lineage?.prior_proposal_sha256 === expected.closedProposal, "proposal_prior_closed");
assert(proposal.lineage?.prior_authority_sha256 === expected.priorAuthority, "proposal_prior_authority");
assert(proposal.lineage?.prior_authority_state === "CLOSED_EXACT_RETRY_CONSUMED_DO_NOT_REUSE", "proposal_prior_state");
assert(proposal.lineage?.image_publication_state === "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION", "proposal_no_republication");
assert(proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "proposal_rate_null_cap");
assert(proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true, "proposal_rate_cap_required");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "proposal_retention_rate");
assert(proposal.rates_cost_and_retention?.retained_volume_charge_is_existing_and_outside_finite_cap === true, "proposal_retention_boundary");
assert(proposal.last_observed_provider_truth?.provider_mutations_for_this_proposal === 0, "proposal_provider_mutations");
assert(proposal.last_observed_provider_truth?.external_spend_for_this_proposal_usd === 0, "proposal_provider_spend");
assert(proposal.last_observed_provider_truth?.rtx4090_eu_ro_1_availability === "LOW", "proposal_availability");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "proposal_v208_forbidden");
assert(proposal.forbidden?.includes("provider mutation GPU use or spend before fresh exact approval and numeric cap"), "proposal_preapproval_boundary");

const expectedBindingMethod =
  "POST_TEMPLATE_ENVIRONMENT_THEN_PATCH_FULL_ENDPOINT_CONFIG_THEN_GET_EFFECTIVE_READBACK_BEFORE_DISPATCH";
const expectedRoute = {
  hard_deadline_seconds: 120,
  probe_interval_seconds: 2,
  required_consecutive_exact_fingerprints: 16,
  minimum_stability_window_seconds: 30,
  mismatch_or_probe_error_after_first_match_fails_closed: true,
};

for (const [label, stage, workersMax] of [
  ["max1", max1, 1],
  ["max2", max2, 2],
]) {
  assert(stage.schema_version === "videoforge.v2-07-staged-endpoint-definition/v4", `${label}_schema`);
  assert(stage.stage === (workersMax === 1 ? "initial_qualification" : "bounded_concurrent_reader_proof_only"), `${label}_stage`);
  assert(stage.region === "EU-RO-1" && stage.image === expected.image, `${label}_identity`);
  assert(stage.image_source_commit === expected.imageSource, `${label}_image_source`);
  assert(stage.control_source_commit === expected.controlSource, `${label}_control_source`);
  assert(stage.network_volume_id_sha256 === expected.volume, `${label}_volume`);
  assert(stage.network_volume_size_gb === 50 && stage.network_volume_region === "EU-RO-1", `${label}_volume_identity`);
  assert(stage.network_volume_mount === "/runpod-volume" && stage.model_root === "/runpod-volume/mage-model", `${label}_mount`);
  assert(stage.volume_write_policy === "APPLICATION_READ_ONLY", `${label}_volume_policy`);
  assert(JSON.stringify(stage.gpu_type_ids) === '["NVIDIA GeForce RTX 4090"]', `${label}_gpu`);
  assert((workersMax === 1 ? stage.gpu_count : stage.gpu_count_per_worker) === 1, `${label}_gpu_count`);
  assert(stage.compute_type === "GPU" && stage.flex_only === true, `${label}_flex_gpu`);
  assert(stage.workers_min === 0 && stage.workers_max === workersMax, `${label}_workers`);
  assert(stage.scaler_type === "REQUEST_COUNT" && stage.scaler_value === 1, `${label}_scaler`);
  assert(stage.handler_concurrency === 1, `${label}_concurrency`);
  assert(stage.idle_timeout_seconds === 5 && stage.init_timeout_seconds === 800, `${label}_init_policy`);
  assert(stage.execution_timeout_seconds === 2400 && stage.request_authority_ttl_seconds === 7200, `${label}_timeouts`);
  assert(stage.container_disk_gb === 120 && stage.flashboot === true, `${label}_runtime`);
  assert(stage.cuda_minimum === "13.0" && JSON.stringify(stage.cuda_allowed) === '["13.0"]', `${label}_cuda`);
  assert(JSON.stringify(stage.offline_environment) === '{"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","DIFFUSERS_OFFLINE":"1"}', `${label}_offline`);
  assert(stage.endpoint_identity_binding?.method === expectedBindingMethod, `${label}_binding_method`);
  assert(stage.endpoint_identity_binding?.environment_key === "VIDEOFORGE_MAGE_ENDPOINT_ID_HASH", `${label}_binding_key`);
  assert(stage.endpoint_identity_binding?.value === "sha256(raw allocated endpoint id)", `${label}_binding_value`);
  assert(stage.endpoint_identity_binding?.raw_endpoint_id_persisted === false, `${label}_raw_endpoint`);
  assert(stage.endpoint_identity_binding?.template_update_response_must_match === true, `${label}_template_response`);
  assert(stage.endpoint_identity_binding?.endpoint_patch_must_exclude_environment === true, `${label}_env_free_patch`);
  assert(stage.endpoint_identity_binding?.endpoint_patch_response_and_get_readback_must_match === true, `${label}_readback`);
  assert(stage.endpoint_identity_binding?.configuration_or_environment_drift_fails_closed === true, `${label}_drift_fence`);
  for (const [key, value] of Object.entries(expectedRoute)) {
    assert(stage.cloudflare_route_restoration?.[key] === value, `${label}_route_${key}`);
  }
}

assert(Array.isArray(proposal.staged_endpoint_configs) && proposal.staged_endpoint_configs.length === 2, "proposal_stage_count");
for (const [index, [stage, definitionDigest, workersMax]] of [
  [max1, expected.max1, 1],
  [max2, expected.max2, 2],
].entries()) {
  const proposalStage = proposal.staged_endpoint_configs[index];
  assert(proposalStage.definition_path === (workersMax === 1 ? "staged-config-max1.json" : "staged-config-max2.json"), `proposal_stage_${index}_path`);
  assert(proposalStage.definition_sha256 === definitionDigest, `proposal_stage_${index}_hash`);
  assert(proposalStage.workers_min === 0 && proposalStage.workers_max === workersMax, `proposal_stage_${index}_workers`);
  assert(proposalStage.flashboot === true && proposalStage.compute_type === "GPU" && proposalStage.flex_only === true, `proposal_stage_${index}_runtime`);
  assert(proposalStage.endpoint_identity_policy.includes("template") && proposalStage.endpoint_identity_policy.includes("without env") && proposalStage.endpoint_identity_policy.includes("readback"), `proposal_stage_${index}_binding`);
  assert(proposalStage.runtime_hash_policy.includes("persist") && proposalStage.runtime_hash_policy.includes("before"), `proposal_stage_${index}_runtime_hash`);
}

const operations = proposal.proposed_operations_in_order;
assert(Array.isArray(operations), "proposal_operations_shape");
const updateIndex = operations.indexOf("update_exact_private_template_environment_with_allocated_endpoint_identity_hash");
const patchIndex = operations.indexOf("patch_full_exact_endpoint_configuration_without_environment_field");
const readbackIndex = operations.indexOf("get_endpoint_and_require_exact_effective_environment_identity_flashboot_true_and_configuration_readback");
assert(updateIndex >= 0 && patchIndex > updateIndex && readbackIndex > patchIndex, "proposal_binding_order");
assert(operations.includes("delete_ephemeral_signer_secret_rollback_exact_worker_version_and_require_16_exact_route_fingerprints_over_30_seconds_within_120_seconds"), "proposal_route_operation");
assert(proposal.cleanup_rollback_and_stop_conditions?.success.includes("30 seconds") && proposal.cleanup_rollback_and_stop_conditions.success.includes("120-second"), "proposal_success_route_window");
assert(proposal.cleanup_rollback_and_stop_conditions?.failure.includes("30 seconds") && proposal.cleanup_rollback_and_stop_conditions.failure.includes("120-second"), "proposal_failure_route_window");

assert(candidateAuthority.schema_version === "videoforge.v2-07-template-identity-requalification-authority/v1", "authority_schema");
assert(candidateAuthority.checkpoint === "V2-07" && candidateAuthority.task_id === "VF-10-07", "authority_identity");
assert(candidateAuthority.proposal?.sha256 === expected.proposal, "authority_proposal");
assert(candidateAuthority.approval?.exact_proposal_approved === true, "authority_approved");
assert(candidateAuthority.approval?.flashboot_true_accepted === true, "authority_flashboot");
assert(candidateAuthority.approval?.low_eu_ro_1_availability_approved === true, "authority_low_availability");
assert(candidateAuthority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");
assert(candidateAuthority.approval?.fresh_numeric_cap === true && candidateAuthority.approval?.historical_cap_reused === false, "authority_fresh_cap");
assert(candidateAuthority.lineage?.final_image === expected.image, "authority_image");
assert(candidateAuthority.lineage?.image_source_commit === expected.imageSource, "authority_image_source");
assert(candidateAuthority.lineage?.control_source_commit === expected.controlSource, "authority_control_source");
assert(candidateAuthority.lineage?.initial_config_sha256 === expected.max1, "authority_max1");
assert(candidateAuthority.lineage?.concurrent_reader_config_sha256 === expected.max2, "authority_max2");
assert(candidateAuthority.lineage?.volume_id_sha256 === expected.volume, "authority_volume");
assert(candidateAuthority.lineage?.prior_proposal_sha256 === expected.closedProposal, "authority_prior_proposal");
assert(candidateAuthority.lineage?.prior_authority_sha256 === expected.priorAuthority, "authority_prior_authority");
assert(JSON.stringify(candidateAuthority.authorized_operations) === JSON.stringify(operations), "authority_operations");
assert(candidateAuthority.retention?.retain_both_volumes_all_outcomes === true && candidateAuthority.retention?.volume_mutation_authorized === false, "authority_retention");
assert(candidateAuthority.execution_boundary?.runpod_mutation_authorized_pending_execution === true, "authority_runpod");
assert(candidateAuthority.execution_boundary?.gpu_use_authorized_pending_execution === true, "authority_gpu");
assert(candidateAuthority.execution_boundary?.image_republication_authorized === false, "authority_no_republication");
assert(candidateAuthority.execution_boundary?.v2_08_authorized === false, "authority_v208");
assert(candidateAuthority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING", "authority_status");

assert(attempt16.attempt === 16, "attempt_number");
assert(attempt16.authority_proposal_sha256 === expected.closedProposal, "attempt_closed_proposal");
assert(attempt16.approved_authority?.sha256 === expected.priorAuthority, "attempt_prior_authority");
assert(attempt16.authority_status === "CLOSED_EXACT_RETRY_CONSUMED_DO_NOT_REUSE", "attempt_authority_closed");
assert(attempt16.result === "NOT_QUALIFIED_ENDPOINT_IDENTITY_BINDING_MUTATION_FAILED_AUTHORITY_CLOSED", "attempt_result");
assert(attempt16.stop_reason?.endpoint_identity_bound === false && attempt16.stop_reason?.job_dispatch_reached === false, "attempt_no_dispatch");
assert(attempt16.stop_reason?.batch_count === 0 && attempt16.stop_reason?.completed_output_count === 0, "attempt_no_outputs");
assert(attempt16.authority_closure?.retry_opened_by_attempt_15 === 1 && attempt16.authority_closure?.retry_consumed_by_attempt_16 === 1, "attempt_retry_consumed");
assert(attempt16.authority_closure?.fresh_proposal_required === true && attempt16.authority_closure?.scope_reuse_forbidden === true, "attempt_fresh_scope");
assert(attempt16.runpod_cleanup?.independent_read_only_reconciliation === "CONFIRMED_ABSENT", "attempt_cleanup");
assert(attempt16.cloudflare_cleanup?.route_restoration === "CROSS_WINDOW_FINGERPRINT_UNSTABLE_STOPPED", "attempt_route_unstable");
assert(attempt16.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && attempt16.qualification_boundaries?.v2_08_authorized === false, "attempt_gate_boundary");

assert(priorAuthority.schema_version === "videoforge.v2-07-flashboot-true-requalification-authority/v1", "prior_authority_schema");
assert(priorAuthority.proposal?.sha256 === expected.closedProposal, "prior_authority_proposal");
assert(priorAuthority.approval?.maximum_cumulative_finite_spend_usd === 2, "prior_authority_cap");
assert(priorAuthority.approval?.exact_proposal_approved === true, "prior_authority_approved_record");
assert(priorAuthority.execution_boundary?.v2_08_authorized === false, "prior_authority_v208");

const control = readText(files.control, "control");
const bindStart = control.indexOf("async bindV207EndpointIdentity(");
const bindEnd = control.indexOf("  async createNetworkVolume(", bindStart);
assert(bindStart >= 0 && bindEnd > bindStart, "control_bind_function");
const bind = control.slice(bindStart, bindEnd);
const templateUpdateIndex = bind.indexOf("await this.updateV207TemplateEnvironment(templateId, expectedEnvironment);");
const endpointPatchIndex = bind.indexOf('this.mutate("PATCH", `/endpoints/${endpointId}`');
const endpointReadbackIndex = bind.indexOf("this.read(`/endpoints/${endpointId}`)");
assert(templateUpdateIndex >= 0 && endpointPatchIndex > templateUpdateIndex && endpointReadbackIndex > endpointPatchIndex, "control_binding_order");
const requestStart = bind.indexOf("const request = {");
const requestEnd = bind.indexOf("} as const;", requestStart);
assert(requestStart >= 0 && requestEnd > requestStart, "control_endpoint_request");
assert(!/\benv\s*:/u.test(bind.slice(requestStart, requestEnd)), "control_endpoint_patch_env_leak");
assert(bind.includes("v207EndpointConfigMatches(responseValue, expected)"), "control_patch_config_readback");
assert(bind.includes("v207EndpointBindingMatches(readbackValue, expected)"), "control_effective_env_readback");
const helperStart = control.indexOf("private async updateV207TemplateEnvironment(");
const helperEnd = control.indexOf("  async inventory(", helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, "control_template_helper");
const helper = control.slice(helperStart, helperEnd);
assert(helper.includes('"POST"') && helper.includes("/templates/${templateId}/update"), "control_template_update_surface");
assert(helper.includes("canonicalizeJson({ env: environment })"), "control_template_environment_payload");
assert(helper.includes("exactEnvironmentMatches(value.env, environment)"), "control_template_environment_readback");

const orchestrator = readText(files.orchestrator, "orchestrator");
assert(orchestrator.includes("const RESTORATION_PROPAGATION_DELAY_MS = 2_000;"), "route_probe_interval");
assert(orchestrator.includes("const RESTORATION_PROPAGATION_WINDOW_MS = 120_000;"), "route_deadline");
assert(orchestrator.includes("const RESTORATION_REQUIRED_CONSECUTIVE_MATCHES = 16;"), "route_probe_count");
assert(orchestrator.includes("V207_ROUTE_RESTORATION_UNCONFIRMED"), "route_fail_closed");
assert(orchestrator.includes("Once the captured fingerprint has appeared"), "route_post_match_probe_fence");
assert(orchestrator.includes("A matching probe followed by a different status/code"), "route_mismatch_fence");

const activation = readText(files.activation, "activation");
assert(activation.includes(`V207_PENDING_PROPOSAL_SHA256 =\n  "${expected.currentProposal}"`), "activation_current_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4;"), "activation_current_cap");
assert(activation.includes('throw new Error("V207_FRESH_AUTHORITY_REQUIRED")'), "activation_null_cap_guard");
assert(!activation.includes(expected.proposal) && !activation.includes(expected.candidateAuthority), "activation_closed_authority_leak");

const topLevelBlock = (source, key) => {
  const startMatch = source.match(new RegExp(`^${key}[^\\n]*\\n`, "m"));
  if (!startMatch || startMatch.index === undefined) fail(`context_missing_${key}`);
  const start = startMatch.index;
  const bodyStart = start + startMatch[0].length;
  const nextTopLevel = source.slice(bodyStart).search(/^\S/m);
  return source.slice(start, nextTopLevel < 0 ? source.length : bodyStart + nextTopLevel);
};

const currentState = readText(files.currentState, "current_state");
const providerAuthority = topLevelBlock(currentState, "provider_authority:");
const recommendedTask = topLevelBlock(currentState, "recommended_next_task:");
const auditEvidence = topLevelBlock(currentState, "audit_evidence:");
assert(providerAuthority.includes("mode: paid"), "state_authority_paid");
assert(providerAuthority.includes("cap_usd: 4"), "state_authority_cap");
assert(currentState.includes(`v2_07_action: execute_exact_approved_patch_schema_requalification_proposal`), "state_action");
assert(currentState.includes(`v2_07_proposal_sha256: "${expected.currentProposal}"`), "state_current_proposal_hash");
assert(currentState.includes("v2_07_authority: evidence/acceptance/VF-10-07/2026-08-21-patch-schema-requalification-candidate/approved-authority.json"), "state_current_authority");
assert(currentState.includes(`v2_07_latest_closed_authority: ${expected.candidateAuthorityPath}`), "state_latest_closed_authority_path");
assert(currentState.includes("failed-attempt-17.json"), "state_attempt17_path");
assert(currentState.includes("provider_calls_authorized: true") && currentState.includes("maximum_external_spend_usd: 4"), "state_provider_boundary");
assert(currentState.includes("gpu_use_authorized: true") && currentState.includes("remote_or_cloud_mutations_authorized: true"), "state_gpu_mutation_boundary");
assert(recommendedTask.includes(`goal: "Execute exact approved proposal ${expected.currentProposal}`), "state_recommended_goal");
assert(recommendedTask.includes("task_stage: bounded_mutation"), "state_recommended_stage");
assert(recommendedTask.includes("current_goal_authority: approved_proposal_sha256_2752b61dfe4481eaa15ef349f859d91650160971a828d7d19af2638f7c8715be_cap_usd_4"), "state_recommended_authority");
assert(auditEvidence.includes(`v2_07_current_proposal_sha256: "${expected.currentProposal}"`), "state_audit_current_proposal_hash");
assert(auditEvidence.includes("v2_07_current_approved_authority: evidence/acceptance/VF-10-07/2026-08-21-patch-schema-requalification-candidate/approved-authority.json"), "state_audit_current_authority");
assert(auditEvidence.includes(`v2_07_latest_closed_authority: ${expected.candidateAuthorityPath}`), "state_audit_latest_closed_authority");
assert(auditEvidence.includes(`v2_07_latest_closed_authority_sha256: "${expected.candidateAuthority}"`), "state_audit_latest_closed_authority_hash");

const gates = readText(files.gates, "gates");
const mageGateStart = gates.indexOf("  GATE_SERVERLESS_MAGE_001:");
const mageGateEnd = gates.indexOf("\n  GATE_", mageGateStart + 1);
assert(mageGateStart >= 0 && mageGateEnd > mageGateStart, "gate_mage_block");
const mageGate = gates.slice(mageGateStart, mageGateEnd);
assert(mageGate.includes("failed-attempt-17.json"), "gate_attempt_path");
assert(mageGate.includes(expected.currentProposal.slice("sha256:".length)), "gate_current_proposal_hash");
assert(mageGate.includes("approved_flashboot_true_low_eu_ro_1_fresh_cap_4_pre_execution"), "gate_authority_boundary");

const task = readText(files.task, "task");
const taskHeader = task.slice(0, task.indexOf("\n## Goal"));
const repairSectionStart = task.indexOf("## Provider-free Attempt 16 repair and fresh proposal");
assert(repairSectionStart >= 0, "task_repair_section");
const repairSection = task.slice(repairSectionStart);
assert(taskHeader.includes("closed and non-transferable") && taskHeader.includes("is approved with FlashBoot=true"), "task_current_authority");
assert(taskHeader.includes(expected.currentProposal), "task_current_proposal_hash");
assert(taskHeader.includes("No V2-08"), "task_v208_boundary");
assert(repairSection.includes("update the exact private template environment"), "task_template_update");
assert(repairSection.includes("without `env`"), "task_env_free_patch");
assert(repairSection.includes("16 consecutive exact route fingerprints"), "task_route_probes");
assert(repairSection.includes("30-second stability window"), "task_route_window");
assert(repairSection.includes("120-second cleanup deadline"), "task_route_deadline");
assert(repairSection.includes(expected.max1) && repairSection.includes(expected.max2), "task_stage_hashes");
assert(repairSection.includes(expected.proposal) && repairSection.includes(expected.candidatePath), "task_candidate_ref");
assert(repairSection.includes("Fresh template-identity requalification authority"), "task_authority_section");
assert(repairSection.includes(expected.candidateAuthorityPath), "task_authority_path");
assert(repairSection.includes(expected.candidateAuthority), "task_authority_hash");

// Negative invariants protect this validator from silently accepting the predecessor's shape.
assert(!validDigest(`${expected.proposal}0`), "negative_digest_length");
assert(proposal.user_approval.maximum_cumulative_finite_spend_usd === null, "negative_non_null_cap");
assert(proposal.user_approval.exact_proposal_approved === false, "negative_approved_proposal");
assert(proposal.lineage.prior_authority_state.includes("DO_NOT_REUSE"), "negative_authority_reuse");
assert(existsSync(files.candidateAuthority), "negative_missing_candidate_authority");

process.stdout.write(
  `V2-07 historical template identity authority validation PASS (${expected.proposal}; authority ${expected.candidateAuthority}; cap USD 4 closed)\n`,
);
