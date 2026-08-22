import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidateRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt34-finalize-503-backoff-candidate");
const expected = Object.freeze({
  proposal: "sha256:83cebe85da4a60862ccf981b72cec9bc8ae6673a3757852d0c63b93c2f38ae12",
  acceptance: "sha256:8c55b0010c87966d887959cf386c2779b2396254a19a3c3e136faf84dbc18a16",
  authority: "sha256:3157147f85ecea86b6d01ce489dbfff2dc0d7bc51a833749d96a9cecd99314ff",
  closure: "sha256:cf207d45228bf2754803ce56187129dde229b0abdbeb1bd834e7e83dad34b980",
  successor: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  max1: "sha256:d31a518831b9a978295047310800a34eaf81ed56dde58eea46918dc581563ca2",
  max2: "sha256:11665ee88f09c6cbe498026cacd8505b0fe02ee7f19ac8b4d3f68aa534f3435c",
  control: "96f5e16cf03be7e31049478ce7f6b0c134a8108c",
  readerDrain: "bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37",
  priorProposal: "sha256:0a417ca023895a02b8ce0e0f2e86b3f3e81b38624819a4abc473695602637925",
  priorAuthority: "sha256:002ee1529b7b2173a51bd7ccedec5bc25bd9945ea8d4f03be02f202c7462f328",
  priorClosure: "sha256:44ce85620744650b48ad4cf7397b1cfa6e2173302c9b35311ff01e7d76aa42d8",
  priorCleanup: "sha256:f2bff0bd293172ea851db26b2c14f8edc3d50074dfc89beccbb7d26e4e93c059",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
});
const paths = Object.freeze({
  proposal: resolve(candidateRoot, "combined-live-proposal.json"),
  acceptance: resolve(candidateRoot, "acceptance.json"),
  authority: resolve(candidateRoot, "approved-authority.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/blocked-attempt-34-capacity-drift.json"),
  max1: resolve(candidateRoot, "staged-config-max1.json"),
  max2: resolve(candidateRoot, "staged-config-max2.json"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
});
const fail = (code) => { throw new Error(`V207_ATTEMPT34_PROPOSAL_INVALID:${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const parse = (bytes, code) => { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(`${code}_JSON`); } };
const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)]));
const bytes = Object.fromEntries(entries);
for (const [name, hash] of Object.entries({ proposal: expected.proposal, acceptance: expected.acceptance, authority: expected.authority, closure: expected.closure, max1: expected.max1, max2: expected.max2 })) assert(sha256(bytes[name]) === hash, `${name.toUpperCase()}_HASH`);
const proposal = parse(bytes.proposal, "PROPOSAL");
const acceptance = parse(bytes.acceptance, "ACCEPTANCE");
const authority = parse(bytes.authority, "AUTHORITY");
const closure = parse(bytes.closure, "CLOSURE");
const max1 = parse(bytes.max1, "MAX1");
const max2 = parse(bytes.max2, "MAX2");
assert(proposal.schema_version === "videoforge.v2-07-finalize-503-backoff-combined-live-proposal/v1" && proposal.attempt === 34 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "SCOPE");
assert(proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval?.flashboot_true_requested === true && proposal.user_approval?.minimum_approved_availability_requested === "MEDIUM" && proposal.user_approval?.observed_availability === "MEDIUM" && proposal.user_approval?.maximum_cumulative_finite_spend_usd === null && proposal.user_approval?.fresh_positive_numeric_cap_required === true, "AUTHORITY_BOUNDARY");
const lineage = proposal.lineage;
assert(lineage?.model === expected.model && lineage?.model_manifest_sha256 === expected.manifest && lineage?.volume_id_sha256 === expected.volume && lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume" && lineage?.model_root === "/runpod-volume/mage-model" && lineage?.volume_write_policy === "APPLICATION_READ_ONLY" && lineage?.final_image === expected.image && lineage?.control_source_commit === expected.control && lineage?.finalize_503_backoff_repair_commit === expected.control && lineage?.max_two_reader_terminal_drain_repair_commit === expected.readerDrain && lineage?.prior_proposal_sha256 === expected.priorProposal && lineage?.prior_authority_sha256 === expected.priorAuthority && lineage?.prior_closure_evidence_sha256 === expected.priorClosure && lineage?.prior_cleanup_evidence_sha256 === expected.priorCleanup, "LINEAGE");
const retry = proposal.finalize_transport_repair;
assert(retry?.commit === expected.control && retry?.retryable_operation_only === "FINALIZE" && retry?.max_attempts === 6 && retry?.request_timeout_seconds === 30 && JSON.stringify(retry?.retry_backoff_ms) === JSON.stringify([1000, 2000, 3000, 4000, 5000]) && retry?.same_reservation_callback_tuple_required === true && retry?.put_retry_forbidden === true && retry?.non_finalize_post_retry_forbidden === true && retry?.provider_body_retained === false && retry?.signed_urls_or_secrets_retained === false, "FINALIZE_BACKOFF");
assert(Array.isArray(proposal.staged_endpoint_configs) && proposal.staged_endpoint_configs.length === 2 && proposal.staged_endpoint_configs[0]?.definition_sha256 === expected.max1 && proposal.staged_endpoint_configs[1]?.definition_sha256 === expected.max2, "STAGED_HASHES");
for (const [name, config, workersMax] of [["MAX1", max1, 1], ["MAX2", max2, 2]]) {
  assert(config.control_source_commit === expected.control && config.image === expected.image && config.network_volume_id_sha256 === expected.volume && config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1" && config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model" && config.volume_write_policy === "APPLICATION_READ_ONLY" && config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" && (config.gpu_count ?? config.gpu_count_per_worker) === 1 && config.compute_type === "GPU" && config.flex_only === true && config.workers_min === 0 && config.workers_max === workersMax && config.flashboot === true && config.output_finalization_transport_policy?.max_attempts === 6 && JSON.stringify(config.output_finalization_transport_policy?.retry_backoff_ms) === JSON.stringify([1000, 2000, 3000, 4000, 5000]) && config.output_finalization_transport_policy?.retryable_operation_only === "FINALIZE" && config.max_two_reader_terminal_drain_repair?.repair_commit === expected.readerDrain, name);
}
const snapshot = proposal.read_only_provider_snapshot;
assert(snapshot?.pods === 0 && snapshot?.endpoints === 0 && snapshot?.private_templates === 0 && snapshot?.active_serverless_workers === 0 && snapshot?.running_pods === 0 && snapshot?.network_volumes === 2 && snapshot?.rtx4090_region === "EU-RO-1" && snapshot?.rtx4090_availability === "MEDIUM" && snapshot?.secure_rtx4090_reference_usd_per_hour === 0.74 && snapshot?.rtx4090_vram_gb === 24 && snapshot?.cumulative_endpoint_spend_usd === 1.1340842194622383, "SNAPSHOT");
const cost = proposal.rates_cost_and_retention;
assert(cost?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 && cost?.existing_two_volume_charge_usd_per_month_total === 7 && cost?.retained_volume_charge_is_existing_and_outside_finite_cap === true && cost?.maximum_cumulative_finite_spend_usd === null && cost?.numeric_cap_must_be_supplied_by_user === true && cost?.estimated_finite_serverless_compute_usd_ceiling === 2.2 && cost?.availability_threshold === "MEDIUM_OR_BETTER", "COST");
assert(acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate?.max1_sha256 === expected.max1 && acceptance.candidate?.max2_sha256 === expected.max2 && acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4 && acceptance.candidate?.authority_path === "approved-authority.json" && acceptance.candidate?.authority_sha256 === expected.authority && acceptance.candidate?.authority_recorded === true && acceptance.provider_boundary?.provider_calls === true && acceptance.provider_boundary?.provider_mutations === true && acceptance.provider_boundary?.gpu_use === true && acceptance.provider_boundary?.external_spend_usd === 0 && acceptance.provider_boundary?.authority_active === true && acceptance.provider_boundary?.cap_usd === 4, "ACCEPTANCE");
assert(authority.schema_version === "videoforge.v2-07-attempt34-finalize-503-backoff-authority/v1" && authority.attempt === 34 && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && authority.proposal?.sha256 === expected.proposal && authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.medium_or_better_eu_ro_1_availability_approved === true && authority.approval?.minimum_approved_availability === "MEDIUM" && authority.approval?.observed_availability_at_proposal === "MEDIUM" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.lineage?.control_source_commit === expected.control && authority.lineage?.initial_config_sha256 === expected.max1 && authority.lineage?.concurrent_reader_config_sha256 === expected.max2 && authority.runtime_contract?.finalize_retry_attempts === 6 && JSON.stringify(authority.runtime_contract?.finalize_retry_backoff_ms) === JSON.stringify([1000, 2000, 3000, 4000, 5000]) && authority.execution_boundary?.retained_volume_mutation_authorized === false && authority.execution_boundary?.v2_08_authorized === false, "AUTHORITY");
assert(closure.result === "NOT_QUALIFIED_PREEXECUTION_CAPACITY_DRIFT" && closure.authority_sha256 === expected.authority && closure.provider_boundary?.runpod_mutations === 0 && closure.provider_boundary?.gpu_jobs === 0 && closure.provider_boundary?.external_spend_usd === 0 && closure.authority_state === "CLOSED_PREEXECUTION_CAPACITY_DRIFT_DO_NOT_REUSE", "CLOSURE");
const activation = bytes.activation.toString("utf8");
for (const value of [expected.successor, expected.control, expected.authority, "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37", "V207_APPROVED_FINITE_CAP_USD: number | null = 4"]) assert(activation.includes(value), `ACTIVATION_${value}`);
const context = [bytes.state, bytes.gates, bytes.task, bytes.start].map((value) => value.toString("utf8")).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.authority, expected.closure, expected.successor, expected.max1, expected.max2, expected.control, "V2-08"]) assert(context.includes(value), `CONTEXT_${value}`);
process.stdout.write("V2-07 Attempt34 pre-execution capacity closure validation PASS (zero mutation/GPU/spend)\n");
