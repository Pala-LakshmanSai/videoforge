import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate");
const expected = {
  proposal: "sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e",
  acceptance: "sha256:ba830728d81fbe31739e6aa73c16bb06ddb6ede95adf605f990c42e2540861cf",
  authority: "sha256:812899db3d2225224ea231112d2eba150ffbbd254148e71f94c81a44de32cadf",
  max1: "sha256:e6f3d746959b3a5633fd9b7d6035a0dca44cee9f886b1c045e9d55b6dc1e86f0",
  max2: "sha256:1a5ba973d3d97b76efa7ffb0a6f5cfa9427fb830e7fbfc8831659ea910f8e9d5",
  control: "6632c4508a1f4127491a598d52157dece41a0560",
  priorProposal: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  priorAuthority: "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37",
  priorClosure: "sha256:d0278822d001fe2639d47920f6923c565882bdbbf6ff11c174b30e72aba6d6fa",
  priorCleanup: "sha256:ab3c5d668c7d2817bd0a9b3e40dbeab6bd3623ae92e9439292d1d32662ba57e1",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT37_PROPOSAL_${code}`); };
const assert = (value, code) => { if (!value) fail(code); };
const bytes = (path) => readFileSync(resolve(dir, path));
const json = (path) => JSON.parse(String(bytes(path)));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

assert(sha("combined-live-proposal.json") === expected.proposal, "PROPOSAL_HASH");
assert(sha("acceptance.json") === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha("approved-authority.json") === expected.authority, "AUTHORITY_HASH");
assert(sha("staged-config-max1.json") === expected.max1, "MAX1_HASH");
assert(sha("staged-config-max2.json") === expected.max2, "MAX2_HASH");
const proposal = json("combined-live-proposal.json");
const acceptance = json("acceptance.json");
const authority = json("approved-authority.json");
const configs = [json("staged-config-max1.json"), json("staged-config-max2.json")];
assert(proposal.attempt === 37 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "BOUNDARY");
assert(proposal.lineage.control_source_commit === expected.control && proposal.lineage.prior_proposal_sha256 === expected.priorProposal && proposal.lineage.prior_authority_sha256 === expected.priorAuthority && proposal.lineage.prior_closure_evidence_sha256 === expected.priorClosure && proposal.lineage.prior_cleanup_evidence_sha256 === expected.priorCleanup, "LINEAGE");
assert(proposal.lineage.model === "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot" && proposal.lineage.volume_mount === "/runpod-volume" && proposal.lineage.volume_write_policy === "APPLICATION_READ_ONLY", "MODEL_VOLUME");
assert(proposal.cleanup_terminal_reader_promotion_repair?.same_owned_job_id_required === true && proposal.cleanup_terminal_reader_promotion_repair?.terminal_statuses_only === true && proposal.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true && proposal.cleanup_terminal_reader_promotion_repair?.no_retry_of_run === true, "PRIOR_CLEANUP_REPAIR");
const recovery = proposal.terminal_reader_result_recovery;
assert(recovery?.repair_commit === expected.control && recovery?.exact_dispatch_order_job_tuple_required === true && recovery?.single_bounded_recovery_phase === true && recovery?.status_reads_only === true && recovery?.run_redispatch_forbidden === true && recovery?.completed_results_return_to_existing_full_application_verifier === true && recovery?.output_bytes_durable_readbacks_and_v3_receipts_still_required === true && recovery?.nonterminal_failed_cancelled_timed_out_mismatched_or_malformed_result_fails_closed === true && recovery?.owned_nonterminal_jobs_cancelled_before_failure === true, "RECOVERY_REPAIR");
assert(proposal.staged_endpoint_configs[0].definition_sha256 === expected.max1 && proposal.staged_endpoint_configs[1].definition_sha256 === expected.max2, "CONFIG_HASHES");
for (const [index, config] of configs.entries()) {
  assert(config.control_source_commit === expected.control && config.workers_min === 0 && config.workers_max === index + 1 && config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true, `CONFIG_${index}`);
  assert(config.network_volume_mount === "/runpod-volume" && config.volume_write_policy === "APPLICATION_READ_ONLY" && config.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true && config.terminal_reader_result_recovery?.repair_commit === expected.control && config.terminal_reader_result_recovery?.exact_reader_job_ids_required === 2 && config.terminal_reader_result_recovery?.run_redispatch_forbidden === true, `CONFIG_SAFETY_${index}`);
}
assert(acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" && acceptance.candidate.proposal_sha256 === expected.proposal && acceptance.candidate.authority_recorded === true && acceptance.candidate.authority_path === "approved-authority.json" && acceptance.candidate.authority_sha256 === expected.authority && acceptance.candidate.maximum_cumulative_finite_spend_usd === 4 && acceptance.provider_boundary.authority_active === true && acceptance.provider_boundary.cap_usd === 4 && acceptance.provider_boundary.external_spend_usd === 0, "ACCEPTANCE");
assert(authority.schema_version === "videoforge.v2-07-attempt37-terminal-reader-result-recovery-authority/v1" && authority.attempt === 37 && authority.authority_mode === "bounded_mutation" && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && authority.proposal?.sha256 === expected.proposal, "AUTHORITY_SCOPE");
assert(authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_or_better_eu_ro_1_availability_approved === true && authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.approval?.fresh_numeric_cap === true && authority.approval?.prior_authority_reused === false && authority.approval?.consumed === false, "AUTHORITY_APPROVAL");
assert(authority.lineage?.control_source_commit === expected.control && authority.lineage?.initial_config_sha256 === expected.max1 && authority.lineage?.concurrent_reader_config_sha256 === expected.max2 && authority.lineage?.prior_proposal_sha256 === expected.priorProposal && authority.lineage?.prior_authority_sha256 === expected.priorAuthority && authority.lineage?.prior_closure_sha256 === expected.priorClosure && authority.lineage?.prior_cleanup_sha256 === expected.priorCleanup, "AUTHORITY_LINEAGE");
assert(authority.lineage?.model === proposal.lineage.model && authority.lineage?.model_manifest_sha256 === proposal.lineage.model_manifest_sha256 && authority.lineage?.image === proposal.lineage.final_image && authority.lineage?.volume_id_sha256 === proposal.lineage.volume_id_sha256 && authority.lineage?.volume_mount === "/runpod-volume" && authority.lineage?.volume_region === "EU-RO-1" && authority.lineage?.volume_write_policy === "APPLICATION_READ_ONLY", "AUTHORITY_IDENTITY");
assert(authority.runtime_contract?.exact_two_reader_post_timeout_status_only_recovery === true && authority.runtime_contract?.exact_dispatch_order_job_tuple_required === true && authority.runtime_contract?.reader_redispatch_forbidden === true && authority.runtime_contract?.completed_reader_results_require_full_output_readback_and_v3_receipt_verification === true && authority.runtime_contract?.finalize_retry_attempts === 6 && JSON.stringify(authority.runtime_contract?.finalize_retry_backoff_ms) === JSON.stringify([1000, 2000, 3000, 4000, 5000]), "AUTHORITY_RUNTIME");
assert(authority.authorized_operations?.proposal_sha256 === expected.proposal && authority.authorized_operations?.all_and_only_listed_operations_authorized === true && authority.authorized_operations?.publication_or_tag_mutation_authorized === false && authority.authorized_operations?.retained_volume_mutation_authorized === false && authority.authorized_operations?.model_download_preparation_or_quantization_authorized === false && authority.authorized_operations?.gpu_or_region_fallback_authorized === false && authority.authorized_operations?.v2_08_authorized === false, "AUTHORITY_OPERATIONS");
assert(authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true && authority.execution_boundary?.gpu_use_authorized_pending_execution === true && authority.execution_boundary?.external_spend_usd === 0 && authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary?.retained_volume_mutation_authorized === false && authority.execution_boundary?.v2_08_authorized === false, "AUTHORITY_BOUNDARY");
assert(proposal.read_only_provider_snapshot?.inventory_checked_at === "2026-08-22T18:38:05.635Z" && proposal.read_only_provider_snapshot?.pods === 0 && proposal.read_only_provider_snapshot?.endpoints === 0 && proposal.read_only_provider_snapshot?.private_templates === 0 && proposal.read_only_provider_snapshot?.active_serverless_workers === 0 && proposal.read_only_provider_snapshot?.running_pods === 0 && proposal.read_only_provider_snapshot?.network_volumes === 2, "FRESH_INVENTORY");
assert(proposal.rates_cost_and_retention?.rate_checked_at === "2026-08-22T18:38:24.525Z" && proposal.rates_cost_and_retention?.current_rtx4090_eu_ro_1_availability === "LOW" && proposal.rates_cost_and_retention?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 && proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "FRESH_RATE");
const harnessSource = String(readFileSync(resolve(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts")));
assert(harnessSource.includes("return await this.recoverConcurrentReadersAfterTimeout(jobIds, verify)") && harnessSource.includes("RUNPOD_CONCURRENT_READER_JOB_ID_MISMATCH") && harnessSource.includes("RUNPOD_CONCURRENT_READER_RECOVERY_UNCONFIRMED"), "CONTROL_SOURCE");
const context = ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md", "apps/web/src/server/providers/v207-activation-authority.ts"].map((path) => String(readFileSync(resolve(root, path)))).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.authority, expected.max1, expected.max2, expected.control, expected.priorClosure, "attempt37_bounded_mutation_authorized", "V207_APPROVED_FINITE_CAP_USD: number | null = 4", "V2-08"]) assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
console.log("V2-07 Attempt37 approved proposal and authority validation PASS");
