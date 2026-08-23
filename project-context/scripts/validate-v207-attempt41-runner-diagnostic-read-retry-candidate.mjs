import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt41-runner-diagnostic-read-retry-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  preflight: resolve(candidate, "read-only-preflight.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  control: resolve(root, "apps/web/src/server/providers/runpod-control.ts"),
  orchestrator: resolve(root, "apps/web/src/server/providers/v207-live-orchestrator.ts"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  proposal: "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
  acceptance: "sha256:b32f70dcee108c0eea8b79496183eac9a7b207ce341dd4f75f60a20dd6579f19",
  authority: "sha256:2aec5d4846bfe8d6d1e658af9db7cf354a25611838f725472477b443d6291f9d",
  preflight: "sha256:c9de952bfcf6de4c0fc5247a2d7f542866501f8de24adf75b0f7fed6e2da0318",
  max1: "sha256:879ec4844e01a667ea14d3d5ba47b89b5a77accf99c55cf3f40744a319c6cd3a",
  max2: "sha256:6ec51bd572c6e7377eae857ea811178296b818f2d993dcf587b0a93e2f0115e4",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageSource: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  controlSource: "6a4053f6fdde6e906e10b7cb297d253a7b9af140",
  publication: "sha256:c4e0363b3b37cb0bc0bb0678ce174085669cfe77a504f2af9fdf5c338814cdb7",
  priorProposal: "sha256:56cd650b61a56fb17a9abd602839992990d3a985a952eafc30afa60e82e02ae8",
  priorAuthority: "sha256:5691eb5bb3a9009fd1a010c74b7c04bc47d15c0ce580ff47f6183c105a563736",
  priorClosure: "sha256:a80a70ece72d4ff08eccfa210257e267b41a2f924f061ec8740d589edd22d32b",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT41_CANDIDATE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

for (const name of ["proposal", "acceptance", "authority", "preflight", "max1", "max2"]) {
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const preflight = json(paths.preflight);
const max1 = json(paths.max1);
const max2 = json(paths.max2);

assert(
  proposal.attempt === 41 &&
    proposal.checkpoint === "V2-07" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.publication_required === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "SCOPE",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.fresh_positive_numeric_cap_required === true &&
    proposal.user_approval?.minimum_approved_availability_requested === "LOW-or-better" &&
    proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true,
  "AUTHORITY_BOUNDARY",
);
assert(
  proposal.lineage?.final_image === expected.image &&
    proposal.lineage?.image_source_commit === expected.imageSource &&
    proposal.lineage?.control_source_commit === expected.controlSource &&
    proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.modelManifest &&
    proposal.lineage?.volume_id_sha256 === expected.volume &&
    proposal.lineage?.volume_size_gb === 50 &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.existing_publication_evidence_sha256 === expected.publication &&
    proposal.lineage?.image_publication_state ===
      "PUBLISHED_EXACT_DIGEST_READBACK_ATTEMPT40_NO_REPUBLICATION_REQUIRED",
  "LINEAGE",
);
assert(
  proposal.lineage?.prior_attempt?.attempt === 40 &&
    proposal.lineage?.prior_attempt?.proposal_sha256 === expected.priorProposal &&
    proposal.lineage?.prior_attempt?.authority_sha256 === expected.priorAuthority &&
    proposal.lineage?.prior_attempt?.closure_sha256 === expected.priorClosure &&
    proposal.lineage?.prior_attempt?.authority_consumed === true,
  "PRIOR_ATTEMPT",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2,
  "CONFIG_HASHES",
);
for (const [config, workers, code] of [
  [max1, 1, "MAX1"],
  [max2, 2, "MAX2"],
]) {
  assert(
    config.image === expected.image &&
      config.image_source_commit === expected.imageSource &&
      config.control_source_commit === expected.controlSource &&
      config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.flashboot === true &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.scaler_type === "REQUEST_COUNT" &&
      config.scaler_value === 1 &&
      config.handler_concurrency === 1 &&
      config.idle_timeout_seconds === 5 &&
      config.init_timeout_seconds === 800 &&
      config.execution_timeout_seconds === 2400 &&
      config.request_authority_ttl_seconds === 7200,
    code,
  );
}

assert(
  preflight.attempt === 41 &&
    preflight.checked_at === "2026-08-23T04:20:38.116Z" &&
    preflight.read_only === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.external_spend_usd === 0 &&
    preflight.inventory?.pods === 0 &&
    preflight.inventory?.endpoints === 0 &&
    preflight.inventory?.private_templates === 0 &&
    preflight.inventory?.active_serverless_workers === 0 &&
    preflight.inventory?.running_pods === 0 &&
    preflight.inventory?.retained_volumes?.length === 2,
  "PREFLIGHT_INVENTORY",
);
const volumes = new Map(preflight.inventory.retained_volumes.map((volume) => [volume.purpose, volume]));
assert(
  volumes.get("Mage")?.id_sha256 === expected.volume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1",
  "PREFLIGHT_VOLUMES",
);
assert(
  preflight.selected_gpu?.offering_id === "NVIDIA GeForce RTX 4090" &&
    preflight.selected_gpu?.availability === "HIGH" &&
    preflight.selected_gpu?.secure_reference_rate_usd_per_hour === 0.74 &&
    preflight.serverless_flex_rate?.usd_per_gpu_hour === 1.1 &&
    preflight.network_volume_rate?.usd_per_gb_month === 0.07 &&
    preflight.network_volume_rate?.existing_two_volume_charge_usd_per_month === 7 &&
    preflight.billing?.baseline_endpoint_spend_usd === 1.5246469744015485 &&
    preflight.reconciliation?.billing_final_usd === 1.5246469744015485 &&
    preflight.reconciliation?.incremental_spend_usd === 0 &&
    preflight.reconciliation?.stable_final_reads === 3 &&
    preflight.quota_lookup?.no_quota_claim_inferred === true,
  "PREFLIGHT_RATES_BILLING_QUOTA",
);
assert(
  preflight.reconciliation?.first_reconciliation_invocation === "FAILED_CLOSED_UNCLASSIFIED" &&
    preflight.reconciliation?.first_failure_exact_code_persisted === false &&
    preflight.reconciliation?.second_reconciliation_invocation_succeeded === true &&
    preflight.reconciliation?.bounded_inventory_retry_policy?.operation ===
      "idempotent_inventory_GET_only" &&
    preflight.reconciliation?.bounded_inventory_retry_policy?.only_retryable_error ===
      "RUNPOD_READ_AMBIGUOUS" &&
    preflight.reconciliation?.bounded_inventory_retry_policy?.live_retry_count_observed === null &&
    preflight.reconciliation?.bounded_inventory_retry_policy?.source_and_unit_tests_verified === true &&
    preflight.reconciliation?.bounded_inventory_retry_policy
      ?.mutation_or_auth_or_malformed_response_retry === false &&
    !text(paths.preflight).includes("RUNPOD_READ_AMBIGUOUS_RETRYABLE"),
  "PREFLIGHT_RECONCILIATION_EVIDENCE_HONESTY",
);
assert(
  proposal.read_only_preflight?.evidence_sha256 === expected.preflight &&
    proposal.read_only_preflight?.stable_final_reconciliation
      ?.first_reconciliation_invocation === "FAILED_CLOSED_UNCLASSIFIED" &&
    proposal.read_only_preflight?.stable_final_reconciliation?.first_failure_exact_code_persisted ===
      false &&
    proposal.read_only_preflight?.stable_final_reconciliation
      ?.second_reconciliation_invocation_succeeded === true &&
    proposal.read_only_preflight?.stable_final_reconciliation
      ?.bounded_inventory_retry_policy_source_and_unit_tests_verified === true &&
    proposal.read_only_preflight?.stable_final_reconciliation?.live_retry_count_observed === null &&
    !text(paths.proposal).includes("RUNPOD_READ_AMBIGUOUS_RETRYABLE"),
  "PROPOSAL_RECONCILIATION_EVIDENCE_HONESTY",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.7 &&
    proposal.cost_estimate?.proposed_finite_cap_usd === null &&
    proposal.cost_estimate?.ongoing_volume_charge_separate_from_finite_cap === true &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.gpu_use_authorized_pending_execution === false &&
    proposal.execution_boundary?.authority_file_present === false &&
    proposal.execution_boundary?.v2_08_authorized === false,
  "COST_EXECUTION_BOUNDARY",
);
assert(
  acceptance.attempt === 41 &&
    acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.authority_path === "approved-authority.json" &&
    acceptance.candidate?.authority_sha256 === expected.authority &&
    acceptance.candidate?.authority_recorded === true &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4 &&
    acceptance.candidate?.publication_required === false &&
    acceptance.candidate_lineage?.read_only_preflight_evidence_sha256 === expected.preflight &&
    acceptance.provider_boundary?.provider_calls === true &&
    acceptance.provider_boundary?.provider_mutations === true &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.authority_active === true &&
    acceptance.provider_boundary?.cap_usd === 4 &&
    acceptance.provider_boundary?.authority_file_present === true &&
    acceptance.provider_boundary?.image_republication_forbidden === true,
  "ACCEPTANCE",
);
assert(
  authority.attempt === 41 &&
    authority.checkpoint === "V2-07" &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.single_use === true &&
    authority.approval?.consumed === false &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary?.image_republication_authorized === false &&
    authority.execution_boundary?.retained_volume_mutation_authorized === false &&
    authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY",
);

const control = text(paths.control);
const orchestrator = text(paths.orchestrator);
assert(
  control.includes("DEFAULT_INVENTORY_READ_RETRY_DELAYS_MS") &&
    control.includes('error.code === "RUNPOD_READ_AMBIGUOUS"') &&
    !control.includes("retryMutation"),
  "READ_RETRY_SOURCE",
);
assert(
  orchestrator.includes("extractV207ChildFailureCode") &&
    orchestrator.includes("V207_CHILD_FAILURE_UNCLASSIFIED") &&
    orchestrator.includes("runner.stderr") &&
    !orchestrator.includes("extractV207ChildFailureCode(runner.stdout)"),
  "DIAGNOSTIC_SOURCE",
);
const activation = text(paths.activation);
const state = text(paths.state);
const gates = text(paths.gates);
const closed = state.includes("phase: serverless_v2_v2_07_attempt41_closed_not_qualified");
if (closed) {
  assert(
    activation.includes(expected.proposal) &&
      activation.includes(expected.controlSource) &&
      activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"),
    "ACTIVATION_CLOSED_AUTHORITY",
  );
} else {
  assert(
    activation.includes(expected.proposal) &&
      activation.includes(expected.controlSource) &&
      activation.includes(expected.authority) &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"),
    "ACTIVATION_AUTHORITY",
  );
}
for (const [name, path] of Object.entries({
  state: paths.state,
  gates: paths.gates,
  start: paths.start,
  task: paths.task,
})) {
  const surface = text(path);
  // START_HERE leads with the closed Attempt41 outcome and intentionally does not
  // repeat every consumed candidate handoff hash; the durable state/gate/task
  // surfaces retain those immutable candidate pointers below.
  if (closed && (name === "start" || name === "task")) continue;
  assert(surface.includes(expected.proposal), `${name.toUpperCase()}_PROPOSAL`);
  assert(surface.includes(expected.acceptance), `${name.toUpperCase()}_ACCEPTANCE`);
  assert(surface.includes(expected.preflight), `${name.toUpperCase()}_PREFLIGHT`);
  assert(surface.includes(expected.max1) && surface.includes(expected.max2), `${name.toUpperCase()}_CONFIGS`);
}
if (closed) {
  assert(
    state.includes("provider_calls_authorized: false") &&
      state.includes("gpu_use_authorized: false") &&
      state.includes("maximum_external_spend_usd: 0") &&
      state.includes("current_authority: null") &&
      gates.includes("pending_authority: null") &&
      gates.includes("provider_calls_authorized: false") &&
      gates.includes("gpu_use_authorized: false"),
    "CLOSED_BOUNDARY",
  );
} else {
  assert(
    state.includes("phase: serverless_v2_v2_07_attempt41_approved_pending_execution") &&
      state.includes("provider_calls_authorized: true") &&
      state.includes("gpu_use_authorized: true") &&
      state.includes("maximum_external_spend_usd: 4") &&
      state.includes(expected.authority),
    "STATE_BOUNDARY",
  );
  assert(
    gates.includes("authority_mode: attempt41_bounded_mutation_authorized") &&
      gates.includes(expected.authority) &&
      gates.includes("pending_numeric_cap_usd: 4") &&
      gates.includes("provider_calls_authorized: true") &&
      gates.includes("gpu_use_authorized: true"),
    "GATE_BOUNDARY",
  );
}

console.log(
  `V2-07 Attempt41 authority validation PASS (exact proposal/authority/cap; reused image; ${closed ? "consumed and closed" : "pending bounded execution"})`,
);
