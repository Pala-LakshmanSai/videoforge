import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate",
);
const candidatePath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate";
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
};
const expected = {
  proposal: "sha256:11203e32aff804dd9f31c674cd3411c8a0efb2cdca7057e891543f30377f5e57",
  authority: "sha256:a9d68f4125f58429699fe52e90ae238b72f0835b4627f9246be86b10e759352b",
  acceptance: "sha256:d38096058821aa2d2eb76216960b1e6ceabee725328b55c82e47ce0828e74259",
  max1: "sha256:26387b6f18d354af2ec9f034a3bbdb0645fcd50abe932f49278c16f36b8e4b66",
  max2: "sha256:6c8093e0292d53c5288904bcedb36b5f26a4f98c1109a16c7a9be0e9ddbf870f",
  control: "5aa2ccae639052fb61312a3b5a830402c275a2f8",
  source: "4249cafd4a5525b5723d0811f16496fb0e949653",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:d37242d8413b1a5e52c2434b0ff12a04093ec5fdfacaed72faeb86fa2cbc67f2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT39_AUTHORITY_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const includes = (value, needle, code) => assert(value.includes(needle), `${code}_${needle}`);

assert(existsSync(paths.authority), "AUTHORITY_MISSING");
for (const [name, hash] of Object.entries({
  proposal: expected.proposal,
  authority: expected.authority,
  acceptance: expected.acceptance,
  max1: expected.max1,
  max2: expected.max2,
})) assert(sha(paths[name]) === hash, `${name.toUpperCase()}_HASH`);

const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const authority = json(paths.authority);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
assert(proposal.attempt === 39 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "PROPOSAL_SCOPE");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.publication === false && proposal.gpu_use === false && proposal.spend_usd === 0, "PROPOSAL_IMMUTABLE_SCOPE");
assert(authority.schema_version === "videoforge.v2-07-attempt39-fresh-cap-rollback-retention-authority/v1" && authority.attempt === 39 && authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_SCOPE");
assert(authority.proposal?.path === "combined-live-proposal.json" && authority.proposal.sha256 === expected.proposal, "AUTHORITY_PROPOSAL");
assert(authority.approval?.exact_proposal_approved === true && authority.approval.flashboot_true_accepted === true && authority.approval.low_or_better_eu_ro_1_availability_approved === true && authority.approval.minimum_approved_availability === "LOW" && authority.approval.observed_availability_at_proposal === "HIGH" && authority.approval.maximum_cumulative_finite_spend_usd === 4 && authority.approval.fresh_numeric_cap === true && authority.approval.historical_cap_reused === false && authority.approval.prior_authority_reused === false && authority.approval.single_use === true && authority.approval.consumed === false, "AUTHORITY_APPROVAL");
assert(authority.lineage?.control_source_commit === expected.control && authority.lineage.image_source_commit === expected.source && authority.lineage.image === expected.image && authority.lineage.model === expected.model && authority.lineage.model_manifest_sha256 === expected.modelManifest && authority.lineage.volume_id_sha256 === expected.volume && authority.lineage.volume_size_gb === 50 && authority.lineage.volume_region === "EU-RO-1" && authority.lineage.volume_mount === "/runpod-volume" && authority.lineage.model_root === "/runpod-volume/mage-model" && authority.lineage.volume_write_policy === "APPLICATION_READ_ONLY" && authority.lineage.initial_config_sha256 === expected.max1 && authority.lineage.concurrent_reader_config_sha256 === expected.max2, "AUTHORITY_LINEAGE");
assert(authority.runtime_contract?.offline_sealed_manifest_verification === true && authority.runtime_contract.real_initialization_warmup === true && authority.runtime_contract.application_read_only_model_files === true && authority.runtime_contract.durable_per_unit_resume === true && authority.runtime_contract.accepted_units_never_regenerated === true && authority.runtime_contract.runtime_download_or_quantization === false && authority.runtime_contract.cache_escape_forbidden === true && authority.runtime_contract.fresh_cap_is_incremental_over_baseline === true && authority.runtime_contract.downward_or_invalid_billing_read_fails_closed === true && authority.runtime_contract.rollback_anchor_must_be_in_newest_seven_of_bounded_ten === true, "AUTHORITY_RUNTIME");
assert(authority.authorized_operations?.proposal_sha256 === expected.proposal && authority.authorized_operations.all_and_only_listed_operations_authorized === true && authority.authorized_operations.publication_or_tag_mutation_authorized === false && authority.authorized_operations.retained_volume_mutation_authorized === false && authority.authorized_operations.model_download_preparation_or_quantization_authorized === false && authority.authorized_operations.gpu_or_region_fallback_authorized === false && authority.authorized_operations.v2_08_authorized === false, "AUTHORITY_OPERATIONS");
assert(authority.execution_boundary?.image_republication_authorized === false && authority.execution_boundary.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary.cloudflare_mutation_authorized_pending_execution === true && authority.execution_boundary.gpu_use_authorized_pending_execution === true && authority.execution_boundary.provider_calls_completed === false && authority.execution_boundary.external_spend_usd === 0 && authority.execution_boundary.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary.retained_volume_mutation_authorized === false && authority.execution_boundary.v2_08_authorized === false, "AUTHORITY_BOUNDARY");
assert(acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" && acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate.authority_recorded === true && acceptance.candidate.authority_path === "approved-authority.json" && acceptance.candidate.authority_sha256 === expected.authority && acceptance.candidate.maximum_cumulative_finite_spend_usd === 4 && acceptance.provider_boundary?.provider_calls === true && acceptance.provider_boundary.provider_mutations === true && acceptance.provider_boundary.authority_active === true && acceptance.provider_boundary.cap_usd === 4 && acceptance.provider_boundary.gpu_use === false && acceptance.provider_boundary.external_spend_usd === 0 && acceptance.provider_boundary.authority_file_present === true, "ACCEPTANCE_BINDING");
assert(max1.workers_min === 0 && max1.workers_max === 1 && max1.flashboot === true && max1.flex_only === true && max1.compute_type === "GPU" && max1.region === "EU-RO-1" && max1.network_volume_id_sha256 === expected.volume && max1.image === expected.image, "MAX1_BINDING");
assert(max2.workers_min === 0 && max2.workers_max === 2 && max2.flashboot === true && max2.flex_only === true && max2.compute_type === "GPU" && max2.region === "EU-RO-1" && max2.network_volume_id_sha256 === expected.volume && max2.image === expected.image, "MAX2_BINDING");

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
const activation = text(paths.activation);
includes(state, candidatePath, "STATE_CANDIDATE");
includes(state, expected.proposal, "STATE_PROPOSAL");
includes(state, expected.acceptance, "STATE_ACCEPTANCE");
includes(state, expected.authority, "STATE_AUTHORITY");
includes(state, "pending_authority: evidence/acceptance/VF-10-07/2026-08-23-attempt39-fresh-cap-rollback-retention-candidate/approved-authority.json", "STATE_AUTHORITY_PATH");
includes(state, "maximum_external_spend_usd: 4", "STATE_CAP");
includes(state, "provider_calls_authorized: true", "STATE_CALLS");
includes(gates, expected.authority, "GATES_AUTHORITY");
includes(gates, "pending_numeric_cap_usd: 4", "GATES_CAP");
includes(gates, "authority_mode: attempt39_bounded_mutation_authorized", "GATES_MODE");
includes(start, expected.authority, "START_AUTHORITY");
includes(start, "user approved it", "START_APPROVAL");
includes(task, expected.authority, "TASK_AUTHORITY");
includes(task, "fresh maximum cumulative finite spend of `$4`", "TASK_CAP");
includes(activation, expected.proposal, "ACTIVATION_PROPOSAL");
includes(activation, expected.control, "ACTIVATION_CONTROL");
includes(activation, expected.authority, "ACTIVATION_AUTHORITY");

console.log("V2-07 Attempt39 exact authority validation PASS (proposal immutable; authority bound; $4 fresh cap; no provider/GPU/spend yet)");
